import { realpathSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MODULE = "default";
const DEFAULT_CONFIG = "package.hyperbricks.yaml";

export interface ModuleSelectionInput {
  workspacePath?: string;
  documentPath?: string;
  configuredModule?: string;
  configuredConfig?: string;
}

export interface ModuleSelection {
  module: string;
  moduleRoot?: string;
  automatic: boolean;
  warning?: string;
}

export function moduleSelectionIdentity(selection: ModuleSelection, configuredConfig: string): string {
  const status = selection.warning === undefined ? "resolved" : "fallback";
  const mode = selection.automatic ? "automatic" : "explicit";
  const config = configuredConfig.trim() || DEFAULT_CONFIG;
  return [status, mode, selection.module, selection.moduleRoot ?? "", config].join("\u0000");
}

type IsFile = (candidate: string) => boolean;

// resolveModuleSelection keeps explicit settings authoritative. In automatic
// mode it walks only from the active document towards its workspace root and
// selects the nearest directory that owns the configured package file.
export function resolveModuleSelection(
  input: ModuleSelectionInput,
  isFile: IsFile = regularFile
): ModuleSelection {
  const workspacePath = cleanPath(input.workspacePath);
  const configuredModule = input.configuredModule?.trim() ?? "";
  if (configuredModule !== "") {
    return {
      module: configuredModule,
      moduleRoot:
        workspacePath === undefined
          ? undefined
          : resolveModuleRoot(workspacePath, configuredModule),
      automatic: false
    };
  }

  if (workspacePath === undefined) {
    return fallbackSelection(undefined, "Automatic module selection requires an open workspace folder.");
  }
  const resolvedWorkspace = resolveExistingPath(workspacePath);
  if (resolvedWorkspace === undefined) {
    return fallbackSelection(
      workspacePath,
      "Automatic module selection could not resolve the active workspace. Set hyperbricks.module explicitly."
    );
  }

  const config = input.configuredConfig?.trim() || DEFAULT_CONFIG;
  if (!isSafeRelativePath(config)) {
    return fallbackSelection(
      workspacePath,
      "Automatic module selection requires a package configuration path inside the module. Set hyperbricks.module explicitly for this configuration."
    );
  }

  const documentPath = cleanPath(input.documentPath);
  if (documentPath === undefined || !pathIsWithin(workspacePath, documentPath)) {
    return fallbackSelection(
      workspacePath,
      `No active HyperBricks file inside the workspace could be used to find ${config}. Set hyperbricks.module explicitly.`
    );
  }
  const resolvedDocument = resolveExistingPath(documentPath);
  if (resolvedDocument === undefined || !pathIsWithin(resolvedWorkspace, resolvedDocument)) {
    return fallbackSelection(
      workspacePath,
      "The active HyperBricks file resolves outside its workspace and cannot be used for automatic module selection. Set hyperbricks.module explicitly."
    );
  }

  let candidate = path.dirname(documentPath);
  while (pathIsWithin(workspacePath, candidate)) {
    const configPath = path.resolve(candidate, config);
    if (pathIsWithin(candidate, configPath) && isFile(configPath)) {
      const resolvedCandidate = resolveExistingPath(candidate);
      const resolvedConfig = resolveExistingPath(configPath);
      if (
        resolvedCandidate !== undefined &&
        resolvedConfig !== undefined &&
        pathIsWithin(resolvedWorkspace, resolvedCandidate) &&
        pathIsWithin(resolvedCandidate, resolvedDocument) &&
        pathIsWithin(resolvedCandidate, resolvedConfig)
      ) {
        const relative = path.relative(workspacePath, candidate);
        return {
          module: relative === "" ? "." : relative,
          moduleRoot: candidate,
          automatic: true
        };
      }
    }
    if (samePath(candidate, workspacePath)) {
      break;
    }
    const parent = path.dirname(candidate);
    if (samePath(parent, candidate)) {
      break;
    }
    candidate = parent;
  }

  return fallbackSelection(
    workspacePath,
    `No ${config} was found between the active HyperBricks file and its workspace root. Set hyperbricks.module explicitly.`
  );
}

export function resolveModuleRoot(workspacePath: string, module: string): string {
  const workspace = path.resolve(workspacePath);
  const selected = module.trim();
  if (path.isAbsolute(selected)) {
    return path.normalize(selected);
  }
  if (selected === "." || selected === ".." || /[\\/]/.test(selected)) {
    return path.resolve(workspace, selected);
  }
  return path.join(workspace, "modules", selected);
}

export function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function fallbackSelection(workspacePath: string | undefined, warning: string): ModuleSelection {
  return {
    module: DEFAULT_MODULE,
    moduleRoot:
      workspacePath === undefined ? undefined : resolveModuleRoot(workspacePath, DEFAULT_MODULE),
    automatic: true,
    warning
  };
}

function regularFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveExistingPath(candidate: string): string | undefined {
  try {
    return path.resolve(realpathSync(candidate));
  } catch {
    return undefined;
  }
}

function isSafeRelativePath(candidate: string): boolean {
  if (candidate === "" || path.isAbsolute(candidate)) {
    return false;
  }
  const normalized = path.normalize(candidate);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

function cleanPath(candidate: string | undefined): string | undefined {
  const cleaned = candidate?.trim();
  return cleaned === undefined || cleaned === "" ? undefined : path.resolve(cleaned);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
