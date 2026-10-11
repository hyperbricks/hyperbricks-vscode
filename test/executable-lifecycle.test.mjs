import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function load(name, dependencies = {}) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  Function("require", "module", "exports", output)(
    (id) => id in dependencies ? dependencies[id] : require(id), module, module.exports
  );
  return module.exports;
}

async function extensionHost(t, installed) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-extension-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.hyperbricks.yaml"), "hyperbricks: {}\n");
  const executable = path.join(root, "go", "bin", process.platform === "win32" ? "hyperbricks.exe" : "hyperbricks");
  if (installed) {
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "", { mode: 0o755 });
  }
  const commands = new Map();
  const launches = [];
  const checks = [];
  const messages = [];
  const log = [];
  const settingsOpened = [];
  const settings = { module: ".", executable: "hyperbricks" };
  const disposable = { dispose() {} };
  const folder = { uri: { scheme: "file", fsPath: root, toString: () => `file://${root}` } };
  const vscode = {
    StatusBarAlignment: { Left: 1 }, ProgressLocation: { Notification: 1 },
    RelativePattern: class {},
    commands: {
      registerCommand(name, callback) { commands.set(name, callback); return disposable; },
      async executeCommand(...args) { settingsOpened.push(args); }
    },
    workspace: {
      workspaceFolders: [folder], textDocuments: [],
      getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
      createFileSystemWatcher: () => disposable,
      onDidChangeConfiguration: () => disposable
    },
    window: {
      createOutputChannel: () => ({ ...disposable, show() {}, info: (s) => log.push(s), warn: (s) => log.push(s), error: (s) => log.push(s) }),
      createStatusBarItem: () => ({ ...disposable, show() {} }),
      onDidChangeActiveTextEditor: () => disposable,
      async showErrorMessage(message) { messages.push(message); return "Open Settings"; },
      async showInformationMessage(message) { messages.push(message); },
      async showWarningMessage(message) { messages.push(message); },
      async withProgress(_options, callback) { return callback({}, { onCancellationRequested: () => disposable }); }
    }
  };
  const discovery = await load("executable");
  const extension = await load("extension", {
    vscode,
    "./smart-enter": { smartEnter() {} },
    "./module-selection": await load("module-selection"),
    "./executable": { resolveExecutable: (configured, options) => discovery.resolveExecutable(configured, { ...options, home: root, env: { PATH: "" } }) },
    "vscode-languageclient/node": {
      State: {},
      LanguageClient: class {
        initializeResult = { capabilities: { experimental: { hyperbricksProtocolVersion: 1 } } };
        constructor(_id, _name, server) { launches.push(server); }
        onDidChangeState() { return disposable; }
        onNotification() { return disposable; }
        async start() {}
        async stop() {}
      }
    },
    "node:child_process": {
      spawn(command, args) {
        checks.push({ command, args });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => child.emit("close", null, "SIGTERM");
        queueMicrotask(() => child.emit("close", 0, null));
        return child;
      }
    }
  });
  t.after(() => extension.deactivate());
  await extension.activate({ subscriptions: [] });
  return { commands, launches, checks, messages, log, executable, settings, settingsOpened };
}

test("language server and Doctor use the same discovered binary outside the editor PATH", async (t) => {
  const host = await extensionHost(t, true);
  assert.equal(host.launches.length, 1);
  assert.equal(host.launches[0].command, host.executable);
  assert.deepEqual(host.launches[0].args, ["language-server", "--stdio"]);
  const runCheck = host.commands.get("hyperbricks.runModuleCheck");
  await Promise.all([runCheck(), runCheck()]);
  assert.equal(host.checks.length, 1, "a second check during discovery must not start another process");
  assert.equal(host.checks[0].command, host.executable);
  assert.deepEqual(host.checks[0].args, ["doctor", "--module", ".", "--config", "package.hyperbricks.yaml"]);
  assert.ok(host.messages.includes("HyperBricks module check completed."));
  assert.ok(host.log.some((message) => message.includes(host.executable)));
});

test("missing executable offers settings and a corrected setting can restart the language server", async (t) => {
  const host = await extensionHost(t, false);
  assert.equal(host.launches.length, 0);
  assert.match(host.messages[0], /executable not found/);
  assert.deepEqual(host.settingsOpened[0], ["workbench.action.openSettings", "hyperbricks.executable"]);
  host.settings.executable = host.executable;
  await mkdir(path.dirname(host.executable), { recursive: true });
  await writeFile(host.executable, "", { mode: 0o755 });
  await host.commands.get("hyperbricks.restartLanguageServer")();
  assert.equal(host.launches.length, 1);
  assert.equal(host.launches[0].command, host.executable);
});
