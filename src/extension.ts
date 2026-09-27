import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as vscode from "vscode";
import {
  LanguageClient,
  State,
  type LanguageClientOptions,
  type ServerOptions
} from "vscode-languageclient/node";
import {
  moduleSelectionIdentity,
  pathIsWithin,
  resolveModuleSelection
} from "./module-selection";

const PROTOCOL_VERSION = 1;
const LANGUAGE_ID = "hyperbricks-yaml";
const RUNTIME_CONNECT_METHOD = "hyperbricks/runtime/connect";
const RUNTIME_DISCONNECT_METHOD = "hyperbricks/runtime/disconnect";
const RUNTIME_STATUS_NOTIFICATION = "hyperbricks/runtime/status";

type RuntimeDiagnosticsMode = "auto" | "on" | "off";
type ServerPhase = "stopped" | "starting" | "ready" | "incompatible" | "error";

interface ExtensionSettings {
  executable: string;
  module: string;
  moduleRoot?: string;
  moduleSelectionWarning?: string;
  moduleSelectionIdentity: string;
  config: string;
  runtimeDiagnostics: RuntimeDiagnosticsMode;
  runtimeUrl: RuntimeUrlSetting;
}

interface RuntimeUrlSetting {
  origin: string;
  connectionBlocked: boolean;
}

interface RuntimeStatus {
  connected: boolean;
  generation?: number;
  errorCount?: number;
  checkedRoutes?: number;
  totalRoutes?: number;
  uncheckedRoutes?: string[];
  evictedContexts?: number;
  unmappedIssues?: string[];
  lastError?: string;
  nextRetryMs?: number;
  runtimeUrl?: string;
  errorsUrl?: string;
}

interface HyperBricksInitializeResult {
  capabilities?: {
    experimental?: {
      hyperbricksProtocolVersion?: unknown;
    };
  };
}

let client: LanguageClient | undefined;
let clientStateSubscription: vscode.Disposable | undefined;
let runtimeStatusSubscription: vscode.Disposable | undefined;
let sourceWatcher: vscode.FileSystemWatcher | undefined;
let output: vscode.LogOutputChannel;
let status: vscode.StatusBarItem;
let runtimeStatus: RuntimeStatus | undefined;
let lastLoggedRuntimeError = "";
let lastLoggedUnmappedIssues = "";
let lastLoggedEvictedContexts = 0;
let serverPhase: ServerPhase = "stopped";
let lifecycle = Promise.resolve();
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let activeProjectKey = "";
let doctorProcess: ChildProcessWithoutNullStreams | undefined;
let runtimeUrlConnectionBlocked = false;
let moduleSelectionWarning = "";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("HyperBricks", { log: true });
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
  status.name = "HyperBricks";
  status.command = "hyperbricks.showOutput";
  status.show();

  context.subscriptions.push(
    output,
    status,
    vscode.commands.registerCommand("hyperbricks.restartLanguageServer", async () => {
      output.info("Restarting the HyperBricks language server on request.");
      await queueRestart();
    }),
    vscode.commands.registerCommand("hyperbricks.connectRuntimeDiagnostics", async () => {
      await requestRuntimeState(RUNTIME_CONNECT_METHOD, "connect");
    }),
    vscode.commands.registerCommand("hyperbricks.disconnectRuntimeDiagnostics", async () => {
      await requestRuntimeState(RUNTIME_DISCONNECT_METHOD, "disconnect");
    }),
    vscode.commands.registerCommand("hyperbricks.runModuleCheck", runModuleCheck),
    vscode.commands.registerCommand("hyperbricks.openRuntimeErrors", openRuntimeErrors),
    vscode.commands.registerCommand("hyperbricks.showOutput", () => output.show(true)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      const restartKeys = [
        "hyperbricks.executable",
        "hyperbricks.module",
        "hyperbricks.config",
        "hyperbricks.runtimeDiagnostics",
        "hyperbricks.runtimeUrl"
      ];
      if (restartKeys.some((key) => event.affectsConfiguration(key))) {
        if (event.affectsConfiguration("hyperbricks.runtimeUrl")) {
          runtimeUrlConnectionBlocked = readRuntimeUrlSetting(
            selectedWorkspaceFolder()?.uri
          ).connectionBlocked;
        }
        scheduleRestart();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId !== LANGUAGE_ID) {
        return;
      }
      const nextProject = selectProject(editor);
      if (nextProject.key !== activeProjectKey) {
        runtimeUrlConnectionBlocked = readRuntimeUrlSetting(
          nextProject.folder?.uri
        ).connectionBlocked;
        scheduleRestart();
      }
    })
  );

  updateStatus();
  await queueRestart();
}

export async function deactivate(): Promise<void> {
  if (restartTimer !== undefined) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }
  if (doctorProcess !== undefined) {
    doctorProcess.kill();
    doctorProcess = undefined;
  }
  await stopLanguageClient();
}

function queueRestart(): Promise<void> {
  lifecycle = lifecycle
    .then(async () => {
      await stopLanguageClient();
      await startLanguageClient();
    })
    .catch((error: unknown) => {
      serverPhase = "error";
      updateStatus(errorMessage(error));
      output.error(`Language-server restart failed: ${errorMessage(error)}`);
    });
  return lifecycle;
}

function scheduleRestart(): void {
  if (restartTimer !== undefined) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void queueRestart();
  }, 250);
}

async function startLanguageClient(): Promise<void> {
  const project = selectProject(vscode.window.activeTextEditor);
  const { folder, settings } = project;
  activeProjectKey = project.key;
  moduleSelectionWarning = settings.moduleSelectionWarning ?? "";
  if (moduleSelectionWarning !== "") {
    output.warn(moduleSelectionWarning);
  }
  runtimeUrlConnectionBlocked = settings.runtimeUrl.connectionBlocked;
  runtimeStatus = undefined;
  lastLoggedRuntimeError = "";
  lastLoggedUnmappedIssues = "";
  lastLoggedEvictedContexts = 0;
  serverPhase = "starting";
  updateStatus();

  const serverOptions: ServerOptions = {
    command: settings.executable,
    args: ["language-server", "--stdio"],
    options: folder === undefined ? undefined : { cwd: folder.uri.fsPath }
  };

  const sourcePattern =
    settings.moduleRoot !== undefined
      ? new vscode.RelativePattern(settings.moduleRoot, "**/*.hyperbricks.yaml")
      : folder === undefined
      ? "**/*.hyperbricks.yaml"
      : new vscode.RelativePattern(folder, "**/*.hyperbricks.yaml");
  sourceWatcher = vscode.workspace.createFileSystemWatcher(sourcePattern);
  const ownsDocument = (uri: vscode.Uri): boolean => {
    if (uri.scheme === "untitled") {
      return true;
    }
    if (uri.scheme !== "file") {
      return false;
    }
    if (settings.moduleSelectionWarning !== undefined) {
      return false;
    }
    if (settings.moduleRoot !== undefined) {
      return pathIsWithin(settings.moduleRoot, uri.fsPath);
    }
    return folder === undefined || workspaceFolderFor(uri)?.uri.toString() === folder.uri.toString();
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: LANGUAGE_ID, scheme: "file" },
      { language: LANGUAGE_ID, scheme: "untitled" }
    ],
    workspaceFolder: folder,
    initializationOptions: {
      protocolVersion: PROTOCOL_VERSION,
      module: settings.module,
      config: settings.config,
      runtimeDiagnostics:
        settings.runtimeUrl.connectionBlocked || settings.moduleSelectionWarning !== undefined
          ? "off"
          : settings.runtimeDiagnostics,
      runtimeUrl: settings.runtimeUrl.origin,
      dirtyDocuments: vscode.workspace.textDocuments
        .filter(
          (document) =>
            document.languageId === LANGUAGE_ID &&
            document.isDirty &&
            ownsDocument(document.uri)
        )
        .map((document) => document.uri.toString())
    },
    synchronize: {
      fileEvents: sourceWatcher
    },
    middleware: {
      didOpen: (document, next) =>
        ownsDocument(document.uri) ? next(document) : Promise.resolve(),
      didChange: (event, next) =>
        ownsDocument(event.document.uri) ? next(event) : Promise.resolve(),
      didSave: (document, next) =>
        ownsDocument(document.uri) ? next(document) : Promise.resolve(),
      didClose: (document, next) =>
        ownsDocument(document.uri) ? next(document) : Promise.resolve(),
      provideCompletionItem: (document, position, context, token, next) =>
        ownsDocument(document.uri) ? next(document, position, context, token) : null,
      provideHover: (document, position, token, next) =>
        ownsDocument(document.uri) ? next(document, position, token) : null,
      provideDefinition: (document, position, token, next) =>
        ownsDocument(document.uri) ? next(document, position, token) : null,
      provideDocumentSemanticTokens: (document, token, next) =>
        ownsDocument(document.uri) ? next(document, token) : null,
      provideDocumentFormattingEdits: (document, options, token, next) =>
        ownsDocument(document.uri) ? next(document, options, token) : []
    },
    outputChannel: output,
    diagnosticCollectionName: "HyperBricks"
  };

  const candidate = new LanguageClient(
    "hyperbricks",
    "HyperBricks Language Server",
    serverOptions,
    clientOptions
  );
  client = candidate;
  clientStateSubscription = candidate.onDidChangeState((event) => {
    if (client !== candidate) {
      return;
    }
    if (event.newState === State.Starting) {
      serverPhase = "starting";
    } else if (event.newState === State.Running) {
      serverPhase = "ready";
    } else if (serverPhase !== "incompatible" && serverPhase !== "error") {
      serverPhase = "stopped";
    }
    updateStatus();
  });
  // Register before initialize completes so an automatic runtime connection
  // cannot publish its first status before the extension is listening.
  runtimeStatusSubscription = candidate.onNotification(
    RUNTIME_STATUS_NOTIFICATION,
    (notification: RuntimeStatus) => {
      acceptRuntimeStatus(notification);
    }
  );

  try {
    await candidate.start();
  } catch (error: unknown) {
    if (client === candidate) {
      client = undefined;
    }
    serverPhase = "error";
    const message = `Could not start ${settings.executable} language-server --stdio: ${errorMessage(error)}`;
    output.error(message);
    updateStatus(message);
    void vscode.window.showErrorMessage(message, "Show Output").then((choice) => {
      if (choice === "Show Output") {
        output.show(true);
      }
    });
    return;
  }

  const initializeResult = (candidate as unknown as {
    initializeResult?: HyperBricksInitializeResult;
  }).initializeResult;
  const advertisedVersion =
    initializeResult?.capabilities?.experimental?.hyperbricksProtocolVersion;
  if (advertisedVersion !== PROTOCOL_VERSION) {
    const received = advertisedVersion === undefined ? "not advertised" : JSON.stringify(advertisedVersion);
    const message =
      `Incompatible HyperBricks language server: the extension requires protocol ` +
      `${PROTOCOL_VERSION}, but the server reported ${received}. Update the extension or HyperBricks executable.`;
    output.error(message);
    await candidate.stop().catch((error: unknown) => {
      output.warn(`Could not stop the incompatible language server cleanly: ${errorMessage(error)}`);
    });
    if (client === candidate) {
      client = undefined;
    }
    clientStateSubscription?.dispose();
    clientStateSubscription = undefined;
    sourceWatcher?.dispose();
    sourceWatcher = undefined;
    serverPhase = "incompatible";
    updateStatus(message);
    void vscode.window.showErrorMessage(message, "Show Output").then((choice) => {
      if (choice === "Show Output") {
        output.show(true);
      }
    });
    return;
  }

  serverPhase = "ready";
  updateStatus();
  output.info(
    `HyperBricks language server ready (protocol ${PROTOCOL_VERSION}, module ${settings.module}${settings.moduleSelectionWarning === undefined ? "" : " fallback"}, config ${settings.config}).`
  );
}

async function stopLanguageClient(): Promise<void> {
  runtimeStatusSubscription?.dispose();
  runtimeStatusSubscription = undefined;
  clientStateSubscription?.dispose();
  clientStateSubscription = undefined;
  sourceWatcher?.dispose();
  sourceWatcher = undefined;
  runtimeStatus = undefined;
  lastLoggedRuntimeError = "";
  lastLoggedUnmappedIssues = "";
  lastLoggedEvictedContexts = 0;

  const active = client;
  client = undefined;
  if (active !== undefined) {
    await active.stop().catch((error: unknown) => {
      output.warn(`Could not stop the HyperBricks language server cleanly: ${errorMessage(error)}`);
    });
  }
  if (serverPhase !== "incompatible" && serverPhase !== "error") {
    serverPhase = "stopped";
    updateStatus();
  }
}

async function requestRuntimeState(method: string, verb: "connect" | "disconnect"): Promise<void> {
  if (verb === "connect" && moduleSelectionWarning !== "") {
    void vscode.window.showWarningMessage(moduleSelectionWarning);
    return;
  }
  if (verb === "connect" && runtimeUrlConnectionBlocked) {
    void vscode.window.showWarningMessage(
      "The configured HyperBricks runtime URL cannot be used. Set an http or https URL without embedded credentials, or clear it to use local discovery."
    );
    return;
  }

  const active = client;
  if (active === undefined || serverPhase !== "ready") {
    void vscode.window.showWarningMessage(
      "The HyperBricks language server is not ready. Restart it before changing the runtime connection."
    );
    return;
  }

  try {
    const result = await active.sendRequest<RuntimeStatus | null>(method);
    if (result !== null && typeof result === "object") {
      acceptRuntimeStatus(result);
    }
    output.info(`Requested the language server to ${verb} runtime diagnostics.`);
  } catch (error: unknown) {
    if (isMethodNotFound(error)) {
      const message =
        `This HyperBricks language server does not support the runtime ${verb} command. ` +
        "Update the configured HyperBricks executable.";
      output.warn(message);
      void vscode.window.showWarningMessage(message);
      return;
    }
    const message = `Could not ${verb} runtime diagnostics: ${errorMessage(error)}`;
    output.error(message);
    void vscode.window.showErrorMessage(message, "Show Output").then((choice) => {
      if (choice === "Show Output") {
        output.show(true);
      }
    });
  }
}

function acceptRuntimeStatus(next: RuntimeStatus): void {
  const unmappedIssues = cleanRuntimeIssueSummaries(next.unmappedIssues);
  runtimeStatus = { ...next, unmappedIssues };
  const nextError = cleanString(next.lastError) ?? "";
  if (nextError !== "" && nextError !== lastLoggedRuntimeError) {
    output.warn(`Runtime diagnostics unavailable: ${nextError}`);
  } else if (nextError === "" && lastLoggedRuntimeError !== "" && next.connected) {
    output.info("Runtime diagnostics connected.");
  }
  lastLoggedRuntimeError = nextError;

  const unmappedFingerprint = JSON.stringify(unmappedIssues);
  if (unmappedFingerprint !== lastLoggedUnmappedIssues) {
    if (unmappedIssues.length > 0) {
      output.warn(
        `${unmappedIssues.length} runtime ${unmappedIssues.length === 1 ? "issue has" : "issues have"} no safe workspace source location:`
      );
      for (const issue of unmappedIssues) {
        output.warn(`Runtime issue: ${issue}`);
      }
    } else if (lastLoggedUnmappedIssues !== "" && next.connected) {
      output.info("All current runtime issues have workspace source locations.");
    }
    lastLoggedUnmappedIssues = unmappedFingerprint;
  }

  const evictedContexts = nonnegativeInteger(next.evictedContexts) ?? 0;
  if (evictedContexts > 0 && evictedContexts !== lastLoggedEvictedContexts) {
    output.warn(
      `Runtime diagnostic coverage is incomplete: ${evictedContexts} request ${evictedContexts === 1 ? "context was" : "contexts were"} evicted from the current snapshot.`
    );
  }
  lastLoggedEvictedContexts = evictedContexts;
  updateStatus();
}

async function runModuleCheck(): Promise<void> {
  if (doctorProcess !== undefined) {
    output.show(true);
    void vscode.window.showInformationMessage("A HyperBricks module check is already running.");
    return;
  }

  const { folder, settings } = selectProject(vscode.window.activeTextEditor);
  if (settings.moduleSelectionWarning !== undefined) {
    output.warn(settings.moduleSelectionWarning);
    void vscode.window.showWarningMessage(settings.moduleSelectionWarning);
    return;
  }
  const args = ["doctor", "--module", settings.module, "--config", settings.config];
  output.info(`Running HyperBricks Doctor for module ${settings.module} (${settings.config}).`);
  output.show(true);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `HyperBricks: checking ${settings.module}`,
      cancellable: true
    },
    (_progress, cancellation) =>
      new Promise<void>((resolve) => {
        let settled = false;
        let cancelled = false;
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          doctorProcess = undefined;
          resolve();
        };

        const child = spawn(settings.executable, args, {
          cwd: folder?.uri.fsPath,
          env: process.env,
          windowsHide: true
        });
        doctorProcess = child;
        child.stdout.on("data", (chunk: Buffer) => output.append(chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => output.append(chunk.toString("utf8")));
        child.on("error", (error) => {
          const message = `Could not run HyperBricks Doctor: ${error.message}`;
          output.error(message);
          void vscode.window.showErrorMessage(message);
          finish();
        });
        child.on("close", (code, signal) => {
          if (settled) {
            return;
          }
          if (cancelled) {
            output.info("HyperBricks module check cancelled.");
          } else if (code === 0) {
            output.info("HyperBricks module check completed without failing checks.");
            void vscode.window.showInformationMessage("HyperBricks module check completed.");
          } else {
            const detail = signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
            output.warn(`HyperBricks module check did not pass (${detail}).`);
            void vscode.window.showWarningMessage(
              "HyperBricks module check reported problems. See the HyperBricks output for details."
            );
          }
          finish();
        });
        cancellation.onCancellationRequested(() => {
          cancelled = true;
          child.kill();
        });
      })
  );
}

async function openRuntimeErrors(): Promise<void> {
  const candidate = runtimeErrorsUrl(runtimeStatus);
  if (candidate === undefined) {
    const choice = await vscode.window.showInformationMessage(
      runtimeStatus === undefined
        ? "No connected HyperBricks runtime has advertised an Errors view. Connect runtime diagnostics first."
        : "The connected HyperBricks runtime did not advertise an Errors view. Enable the development dashboard to use that browser interface.",
      "Show Output"
    );
    if (choice === "Show Output") {
      output.show(true);
    }
    return;
  }

  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(candidate, true);
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`The HyperBricks runtime URL is invalid: ${errorMessage(error)}`);
    return;
  }
  if (uri.scheme !== "http" && uri.scheme !== "https") {
    void vscode.window.showErrorMessage("The HyperBricks runtime URL must use http or https.");
    return;
  }
  await vscode.env.openExternal(uri);
}

function runtimeErrorsUrl(notification: RuntimeStatus | undefined): string | undefined {
  const base = cleanString(notification?.runtimeUrl);
  const direct = cleanString(notification?.errorsUrl);
  if (direct !== undefined) {
    try {
      return new URL(direct, base === undefined ? undefined : ensureTrailingSlash(base)).toString();
    } catch {
      return undefined;
    }
  }
  // The dashboard owns this browser route. A missing errorsUrl is an explicit
  // signal that the selected runtime did not enable it.
  return undefined;
}

function updateStatus(detail?: string): void {
  status.command = "hyperbricks.showOutput";
  if (serverPhase === "starting") {
    status.text = "$(sync~spin) HyperBricks";
    status.tooltip = detail ?? "Starting the HyperBricks language server";
    return;
  }
  if (serverPhase === "incompatible") {
    status.text = "$(warning) HyperBricks: incompatible";
    status.tooltip = detail ?? "The extension and language server protocol versions do not match";
    return;
  }
  if (serverPhase === "error") {
    status.text = "$(error) HyperBricks: server error";
    status.tooltip = detail ?? "The HyperBricks language server failed";
    return;
  }
  if (serverPhase !== "ready") {
    status.text = "$(circle-slash) HyperBricks";
    status.tooltip = detail ?? "HyperBricks language server stopped";
    return;
  }

  if (moduleSelectionWarning !== "") {
    status.text = "$(warning) HyperBricks: select module";
    status.tooltip = moduleSelectionWarning;
    return;
  }

  const errorCount = finiteNumber(runtimeStatus?.errorCount);
  const checked = finiteNumber(runtimeStatus?.checkedRoutes);
  const total = finiteNumber(runtimeStatus?.totalRoutes);
  const runtimeConnected = runtimeStatus?.connected === true;
  const runtimeErrorsAvailable = cleanString(runtimeStatus?.errorsUrl) !== undefined;
  if (runtimeConnected && errorCount !== undefined && errorCount > 0) {
    const coverage =
      checked !== undefined && total !== undefined ? ` · ${checked}/${total} routes` : "";
    status.text = `$(warning) HyperBricks: ${errorCount} runtime ${errorCount === 1 ? "issue" : "issues"}${coverage}`;
    status.tooltip = runtimeStatusTooltip(
      "Runtime diagnostics reported issues; route coverage remains visible because unchecked routes have no runtime result"
    );
    if (runtimeErrorsAvailable) {
      status.command = "hyperbricks.openRuntimeErrors";
    }
    return;
  }
  if (runtimeConnected && checked !== undefined && total !== undefined) {
    status.text = `$(check) HyperBricks: ${checked}/${total} routes`;
    status.tooltip = runtimeStatusTooltip("Runtime diagnostics connected; not every route may have been exercised");
    if (runtimeErrorsAvailable) {
      status.command = "hyperbricks.openRuntimeErrors";
    }
    return;
  }
  if (runtimeConnected) {
    status.text = "$(plug) HyperBricks: runtime connected";
    status.tooltip = runtimeStatusTooltip("Runtime diagnostics connected");
    if (runtimeErrorsAvailable) {
      status.command = "hyperbricks.openRuntimeErrors";
    }
    return;
  }
  const lastRuntimeError = cleanString(runtimeStatus?.lastError);
  if (lastRuntimeError !== undefined) {
    status.text = "$(warning) HyperBricks: runtime unavailable";
    status.tooltip = runtimeStatusTooltip(lastRuntimeError);
    return;
  }
  status.text = "$(check) HyperBricks";
  status.tooltip =
    runtimeStatus === undefined
      ? "HyperBricks language server ready"
      : runtimeStatusTooltip("HyperBricks language server ready");
}

function readSettings(resource?: vscode.Uri, document?: vscode.Uri): ExtensionSettings {
  const configuration = vscode.workspace.getConfiguration("hyperbricks", resource);
  const configuredMode = configuration.get<string>("runtimeDiagnostics", "auto");
  const runtimeDiagnostics: RuntimeDiagnosticsMode =
    configuredMode === "on" || configuredMode === "off" ? configuredMode : "auto";
  const config = cleanString(configuration.get<string>("config")) ?? "package.hyperbricks.yaml";
  const moduleSelection = resolveModuleSelection({
    workspacePath: resource?.scheme === "file" ? resource.fsPath : undefined,
    documentPath: document?.scheme === "file" ? document.fsPath : undefined,
    configuredModule: cleanString(configuration.get<string>("module")) ?? "",
    configuredConfig: config
  });
  return {
    executable: cleanString(configuration.get<string>("executable")) ?? "hyperbricks",
    module: moduleSelection.module,
    moduleRoot: moduleSelection.moduleRoot,
    moduleSelectionWarning: moduleSelection.warning,
    moduleSelectionIdentity: moduleSelectionIdentity(moduleSelection, config),
    config,
    runtimeDiagnostics,
    runtimeUrl: validateRuntimeUrlSetting(configuration.get<string>("runtimeUrl", ""))
  };
}

function readRuntimeUrlSetting(resource?: vscode.Uri): RuntimeUrlSetting {
  const configuration = vscode.workspace.getConfiguration("hyperbricks", resource);
  return validateRuntimeUrlSetting(configuration.get<string>("runtimeUrl", ""));
}

function validateRuntimeUrlSetting(raw = "") {
  const configured = raw.trim();
  if (configured === "") {
    return { origin: "", connectionBlocked: false };
  }

  try {
    const parsed = new URL(configured);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.host === "" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return { origin: "", connectionBlocked: true };
    }
    return { origin: parsed.origin, connectionBlocked: false };
  } catch {
    return { origin: "", connectionBlocked: true };
  }
}

function selectedWorkspaceFolder(active = vscode.window.activeTextEditor): vscode.WorkspaceFolder | undefined {
  if (active?.document.languageId === LANGUAGE_ID) {
    const folder = workspaceFolderFor(active.document.uri);
    if (folder !== undefined) {
      return folder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

function workspaceFolderFor(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return uri.scheme === "file" ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
}

function selectProject(active: vscode.TextEditor | undefined): {
  folder: vscode.WorkspaceFolder | undefined;
  settings: ExtensionSettings;
  key: string;
} {
  const folder = selectedWorkspaceFolder(active);
  const document =
    active?.document.languageId === LANGUAGE_ID ? active.document.uri : undefined;
  const settings = readSettings(folder?.uri, document);
  return {
    folder,
    settings,
    key: `${folder?.uri.toString() ?? ""}\u0000${settings.moduleSelectionIdentity}`
  };
}

function cleanString(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonnegativeInteger(value: number | undefined): number | undefined {
  const number = finiteNumber(value);
  return number === undefined || number < 0 ? undefined : Math.trunc(number);
}

function cleanRuntimeIssueSummaries(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const unique = new Set<string>();
  for (const candidate of values) {
    if (typeof candidate !== "string") {
      continue;
    }
    let summary = candidate
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/https?:\/\/[^\s<>"']+/gi, sanitizeRuntimeStatusUrl)
      .replace(
        /\b(authorization)\s*[:=]\s*(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1=[redacted]"
      )
      .replace(
        /\b(password|passwd|token|secret|api[-_]?key|access[-_]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1=[redacted]"
      )
      .replace(/\b(bearer|basic)\s+[a-z0-9+/._~=-]+/gi, "$1 [redacted]")
      .replace(/(^|[\s("'=])\\\\[^\\\s:;,)\]}]+\\[^\\\s:;,)\]}]+(?:\\[^\\\s:;,)\]}]+)*/gi, "$1[path]")
      .replace(/(^|[\s("'=])[a-z]:\\(?:[^\\\s:;,)\]}]+\\)+[^\\\s:;,)\]}]+/gi, "$1[path]")
      .replace(/(^|[\s("'=])(?:\/[^/\s:;,)\]}]+){2,}/g, "$1[path]")
      .replace(/\s+/g, " ")
      .trim();
    if (summary.length > 512) {
      summary = `${summary.slice(0, 511)}…`;
    }
    if (summary !== "") {
      unique.add(summary);
    }
  }
  return [...unique].sort();
}

function sanitizeRuntimeStatusUrl(value: string): string {
  const trimmed = value.replace(/[.,;:!?)\]}]+$/g, "");
  const suffix = value.slice(trimmed.length);
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.toString()}${suffix}`;
  } catch {
    return `[redacted URL]${suffix}`;
  }
}

function runtimeStatusTooltip(summary: string): string {
  const details = [summary];
  const unmappedIssues = cleanRuntimeIssueSummaries(runtimeStatus?.unmappedIssues);
  if (unmappedIssues.length > 0) {
    details.push(
      `${unmappedIssues.length} runtime ${unmappedIssues.length === 1 ? "issue has" : "issues have"} no safe workspace source location.`
    );
    for (const issue of unmappedIssues.slice(0, 3)) {
      details.push(`• ${issue}`);
    }
    if (unmappedIssues.length > 3) {
      details.push(`• ${unmappedIssues.length - 3} more in HyperBricks output`);
    }
  }
  const evictedContexts = nonnegativeInteger(runtimeStatus?.evictedContexts) ?? 0;
  if (evictedContexts > 0) {
    details.push(
      `${evictedContexts} request ${evictedContexts === 1 ? "context was" : "contexts were"} evicted; runtime coverage may be incomplete.`
    );
  }
  return details.join("\n");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isMethodNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === -32601;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown error";
}
