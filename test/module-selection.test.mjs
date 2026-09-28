import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

async function loadModuleSelection() {
  const source = await readFile(path.join(extensionRoot, "src/module-selection.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: "module-selection.ts"
  }).outputText;
  const module = { exports: {} };
  Function("require", "module", "exports", output)(require, module, module.exports);
  return module.exports;
}

test("automatic module selection finds the package owning a nested source", async () => {
  const { resolveModuleSelection } = await loadModuleSelection();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-module-selection-"));
  const document = path.join(
    workspace,
    "modules",
    "demo",
    "hyperbricks",
    "app.hyperbricks.yaml"
  );
  await mkdir(path.dirname(document), { recursive: true });
  await writeFile(
    path.join(workspace, "modules", "demo", "package.hyperbricks.yaml"),
    "hyperbricks: {}\n"
  );
  await writeFile(document, "page:\n  - type: html\n  - value: ok\n");

  const selection = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: document,
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });

  assert.equal(selection.module, path.join("modules", "demo"));
  assert.equal(selection.moduleRoot, path.join(workspace, "modules", "demo"));
  assert.equal(selection.automatic, true);
  assert.equal(selection.warning, undefined);
});

test("automatic module selection chooses the nearest package and supports a module workspace", async () => {
  const { resolveModuleSelection } = await loadModuleSelection();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-module-selection-"));
  const nestedModule = path.join(workspace, "modules", "nested");
  const nestedSource = path.join(nestedModule, "hyperbricks", "partials", "page.hyperbricks.yaml");
  await mkdir(path.dirname(nestedSource), { recursive: true });
  await writeFile(path.join(workspace, "package.hyperbricks.yaml"), "hyperbricks: {}\n");
  await writeFile(path.join(nestedModule, "package.hyperbricks.yaml"), "hyperbricks: {}\n");
  await writeFile(nestedSource, "page:\n  - type: html\n  - value: ok\n");

  const nested = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: nestedSource,
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });
  assert.equal(nested.module, path.join("modules", "nested"));

  const rootSource = path.join(workspace, "hyperbricks", "page.hyperbricks.yaml");
  await mkdir(path.dirname(rootSource), { recursive: true });
  await writeFile(rootSource, "page:\n  - type: html\n  - value: ok\n");
  const root = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: rootSource,
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });
  assert.equal(root.module, ".");
  assert.equal(root.moduleRoot, workspace);
});

test("explicit module selection stays authoritative and automatic failures are bounded", async () => {
  const { pathIsWithin, resolveModuleSelection } = await loadModuleSelection();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-module-selection-"));
  const document = path.join(workspace, "modules", "other", "hyperbricks", "page.hyperbricks.yaml");
  await mkdir(path.dirname(document), { recursive: true });
  await writeFile(document, "page:\n  - type: html\n  - value: pending\n");

  const explicit = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: document,
    configuredModule: "chosen",
    configuredConfig: "package.hyperbricks.yaml"
  });
  assert.equal(explicit.module, "chosen");
  assert.equal(explicit.moduleRoot, path.join(workspace, "modules", "chosen"));
  assert.equal(explicit.automatic, false);

  const missing = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: document,
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });
  assert.equal(missing.module, "default");
  assert.match(missing.warning, /No package\.hyperbricks\.yaml was found/);

  const escapingConfig = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: document,
    configuredModule: "",
    configuredConfig: "../package.hyperbricks.yaml"
  });
  assert.equal(escapingConfig.module, "default");
  assert.match(escapingConfig.warning, /inside the module/);

  assert.equal(pathIsWithin(workspace, path.join(workspace, "modules", "chosen")), true);
  assert.equal(pathIsWithin(workspace, path.resolve(workspace, "..", "outside")), false);
});

test("automatic module selection rejects source and configuration symlink escapes", async (t) => {
  const { resolveModuleSelection } = await loadModuleSelection();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-module-selection-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-module-outside-"));
  const outsideSource = path.join(outside, "hyperbricks", "page.hyperbricks.yaml");
  await mkdir(path.dirname(outsideSource), { recursive: true });
  await writeFile(path.join(outside, "package.hyperbricks.yaml"), "hyperbricks: {}\n");
  await writeFile(outsideSource, "page:\n  - type: html\n  - value: outside\n");

  const linkedModule = path.join(workspace, "modules", "linked");
  await mkdir(path.dirname(linkedModule), { recursive: true });
  try {
    await symlink(outside, linkedModule, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory symlinks are unavailable: ${error}`);
    return;
  }
  const escapedSource = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: path.join(linkedModule, "hyperbricks", "page.hyperbricks.yaml"),
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });
  assert.equal(escapedSource.module, "default");
  assert.match(escapedSource.warning, /resolves outside its workspace/);

  const localModule = path.join(workspace, "modules", "local");
  const localSource = path.join(localModule, "hyperbricks", "page.hyperbricks.yaml");
  await mkdir(path.dirname(localSource), { recursive: true });
  await writeFile(localSource, "page:\n  - type: html\n  - value: local\n");
  await symlink(path.join(outside, "package.hyperbricks.yaml"), path.join(localModule, "package.hyperbricks.yaml"));
  const escapedConfig = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: localSource,
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });
  assert.equal(escapedConfig.module, "default");
  assert.match(escapedConfig.warning, /No package\.hyperbricks\.yaml was found/);
});

test("project identity changes when a fallback becomes a valid default module", async () => {
  const { moduleSelectionIdentity, resolveModuleSelection } = await loadModuleSelection();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-module-selection-"));
  const moduleRoot = path.join(workspace, "modules", "default");
  const document = path.join(moduleRoot, "hyperbricks", "page.hyperbricks.yaml");
  await mkdir(path.dirname(document), { recursive: true });
  await writeFile(document, "page:\n  - type: html\n  - value: pending\n");

  const fallback = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: document,
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });
  const fallbackIdentity = moduleSelectionIdentity(fallback, "package.hyperbricks.yaml");
  assert.equal(fallback.moduleRoot, moduleRoot);
  assert.match(fallback.warning, /No package\.hyperbricks\.yaml was found/);

  await writeFile(path.join(moduleRoot, "package.hyperbricks.yaml"), "hyperbricks: {}\n");
  const resolved = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: document,
    configuredModule: "",
    configuredConfig: "package.hyperbricks.yaml"
  });
  const resolvedIdentity = moduleSelectionIdentity(resolved, "package.hyperbricks.yaml");
  assert.equal(resolved.moduleRoot, moduleRoot, "the filesystem root intentionally stays the same");
  assert.equal(resolved.warning, undefined);
  assert.notEqual(resolvedIdentity, fallbackIdentity, "fallback-to-resolved must restart the client");

  const explicit = resolveModuleSelection({
    workspacePath: workspace,
    documentPath: document,
    configuredModule: path.join("modules", "default"),
    configuredConfig: "package.hyperbricks.yaml"
  });
  assert.notEqual(
    moduleSelectionIdentity(explicit, "package.hyperbricks.yaml"),
    resolvedIdentity,
    "explicit and automatic ownership remain distinguishable"
  );
});
