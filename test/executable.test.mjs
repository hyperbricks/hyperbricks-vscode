import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/executable.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
const loaded = { exports: {} };
Function("require", "module", "exports", output)(createRequire(import.meta.url), loaded, loaded.exports);
const { resolveExecutable } = loaded.exports;
const binaryName = process.platform === "win32" ? "hyperbricks.exe" : "hyperbricks";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hyperbricks-executable-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { cwd: root, home: path.join(root, "home"), env: { PATH: "" } };
  const binary = async (directory, name = binaryName, contents = "") => {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, name);
    await writeFile(file, contents, { mode: 0o755 });
    return file;
  };
  return { root, options, binary };
}

test("a GUI editor without Go on PATH finds the default go-install directory", async (t) => {
  const { options, binary } = await fixture(t);
  const installed = await binary(path.join(options.home, "go", "bin"));
  assert.deepEqual(await resolveExecutable("hyperbricks", options), {
    command: installed, source: "default Go bin directory"
  });
});

test("PATH has priority over a second installation in Go's bin directory", async (t) => {
  const { root, options, binary } = await fixture(t);
  const selected = await binary(path.join(root, "path with spaces"));
  await binary(path.join(options.home, "go", "bin"));
  options.env.PATH = path.dirname(selected);
  assert.equal((await resolveExecutable("hyperbricks", options)).command, selected);
});

test("an explicit executable is authoritative, including paths with spaces", async (t) => {
  const { root, options, binary } = await fixture(t);
  await binary(path.join(options.home, "go", "bin"));
  const selected = await binary(path.join(root, "my runtime"));
  assert.equal((await resolveExecutable(selected, options)).command, selected);
  assert.equal((await resolveExecutable(path.join("my runtime", binaryName), options)).command, selected);
  await assert.rejects(resolveExecutable(path.join(root, "missing", binaryName), options), /hyperbricks.executable/);
  await assert.rejects(resolveExecutable("hyperbricks-custom", options), /Cannot find/);
});

test("GOBIN and the first GOPATH entry follow Go installation ownership", async (t) => {
  const { root, options, binary } = await fixture(t);
  const custom = await binary(path.join(root, "custom bin"));
  const workspace = path.join(root, "workspace");
  const workspaceBinary = await binary(path.join(workspace, "bin"));
  await binary(path.join(options.home, "go", "bin"));
  options.env.GOBIN = path.dirname(custom);
  options.env.GOPATH = workspace;
  assert.equal((await resolveExecutable("hyperbricks", options)).command, custom);
  delete options.env.GOBIN;
  options.env.GOPATH = `${workspace}${path.delimiter}${path.join(root, "unused")}`;
  assert.equal((await resolveExecutable("hyperbricks", options)).command, workspaceBinary);
  options.env.GOBIN = path.join(root, "missing bin");
  await assert.rejects(resolveExecutable("hyperbricks", options), /Cannot find/);
  delete options.env.GOBIN;
  options.env.GOPATH = `${path.join(root, "missing workspace")}${path.delimiter}${workspace}`;
  await assert.rejects(resolveExecutable("hyperbricks", options), /Cannot find/);
});

test("go env can supply a persisted GOBIN absent from the editor environment", { skip: process.platform === "win32" }, async (t) => {
  const { root, options, binary } = await fixture(t);
  const installed = await binary(path.join(root, "persisted bin"));
  const goDirectory = path.join(root, "toolchain");
  await binary(goDirectory, "go", `#!/bin/sh\n[ "$GOTOOLCHAIN" = local ] || exit 1\n[ "$GOWORK" = off ] || exit 1\n[ "$1 $2 $3 $4" = 'env -json GOBIN GOPATH' ] || exit 1\ncat <<'ENVJSON'\n${JSON.stringify({ GOBIN: path.dirname(installed), GOPATH: "" })}\nENVJSON\n`);
  // Only an absolute system path is used for the fixture's `cat` command.
  options.env.PATH = `${goDirectory}${path.delimiter}/bin`;
  assert.deepEqual(await resolveExecutable("hyperbricks", options), { command: installed, source: "Go GOBIN" });
});

test("unavailable or invalid Go metadata still allows an inherited installation", { skip: process.platform === "win32" }, async (t) => {
  const { root, options, binary } = await fixture(t);
  const installed = await binary(path.join(options.home, "go", "bin"));
  const goDirectory = path.join(root, "toolchain");
  options.env.PATH = goDirectory;
  for (const script of ["exit 1", "echo not-json"]) {
    await binary(goDirectory, "go", `#!/bin/sh\n${script}\n`);
    assert.equal((await resolveExecutable("hyperbricks", options)).command, installed);
  }
});

test("automatic discovery does not run a project binary through an empty or relative PATH entry", async (t) => {
  const { root, options, binary } = await fixture(t);
  await binary(root);
  options.env.PATH = `${path.delimiter}.${path.delimiter}bin`;
  await assert.rejects(resolveExecutable("hyperbricks", options), /Cannot find/);
});

test("directories and non-executable files produce a useful recovery message", async (t) => {
  const { root, options, binary } = await fixture(t);
  const directory = path.join(root, "path");
  const candidate = path.join(directory, binaryName);
  await mkdir(candidate, { recursive: true });
  options.env.PATH = directory;
  await assert.rejects(resolveExecutable("hyperbricks", options), (error) => {
    assert.match(error.message, /hyperbricks.executable/);
    assert.match(error.message, /fully quit and reopen VS Code/);
    assert.ok(error.message.includes(candidate));
    return true;
  });
  if (process.platform !== "win32") {
    await rm(candidate, { recursive: true });
    await binary(directory);
    await chmod(candidate, 0o644);
    await assert.rejects(resolveExecutable("hyperbricks", options), /Cannot find/);
  }
});
