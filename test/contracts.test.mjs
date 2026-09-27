import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));

async function readJSON(relativePath) {
  const text = await readFile(path.join(extensionRoot, relativePath), "utf8");
  return JSON.parse(text);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} must have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`${name} must have a complete body`);
}

test("manifest registers the HyperBricks language and grammar", async () => {
  const manifest = await readJSON("package.json");
  const [language] = manifest.contributes.languages;
  const [grammar] = manifest.contributes.grammars;

  assert.equal(manifest.main, "./out/extension.js");
  assert.equal(language.id, "hyperbricks");
  assert.deepEqual(language.extensions, [".hyperbricks.yaml"]);
  assert.equal(language.configuration, "./language-configuration.json");
  assert.equal(grammar.language, "hyperbricks");
  assert.equal(grammar.scopeName, "source.hyperbricks");

  await access(path.join(extensionRoot, language.configuration));
  await access(path.join(extensionRoot, grammar.path));
});

test("manifest contributes and activates every public command", async () => {
  const manifest = await readJSON("package.json");
  const expected = [
    "hyperbricks.restartLanguageServer",
    "hyperbricks.connectRuntimeDiagnostics",
    "hyperbricks.disconnectRuntimeDiagnostics",
    "hyperbricks.runModuleCheck",
    "hyperbricks.openRuntimeErrors",
    "hyperbricks.showOutput"
  ];
  const commands = manifest.contributes.commands.map(({ command }) => command);

  assert.deepEqual(commands, expected);
  for (const command of expected) {
    assert.ok(manifest.activationEvents.includes(`onCommand:${command}`), `${command} must activate the extension`);
  }
  assert.ok(manifest.activationEvents.includes("onLanguage:hyperbricks"));
});

test("manifest exposes the protocol initialization settings", async () => {
  const manifest = await readJSON("package.json");
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties["hyperbricks.executable"].default, "hyperbricks");
  assert.equal(properties["hyperbricks.module"].default, "default");
  assert.equal(properties["hyperbricks.config"].default, "package.hyperbricks.yaml");
  assert.deepEqual(properties["hyperbricks.runtimeDiagnostics"].enum, ["auto", "on", "off"]);
  assert.equal(properties["hyperbricks.runtimeUrl"].default, "");
  assert.deepEqual(properties["hyperbricks.trace.server"].enum, ["off", "messages", "verbose"]);
});

test("runtime URL validation sends only safe origins and blocks unsafe connections", async () => {
  const source = await readFile(path.join(extensionRoot, "src/extension.ts"), "utf8");
  const validatorSource = extractFunction(source, "validateRuntimeUrlSetting");
  const validateRuntimeUrlSetting = Function(`"use strict"; return (${validatorSource});`)();

  const credentialedUrl = "https://user:secret@example.test/path?token=x#y";
  const blocked = validateRuntimeUrlSetting(credentialedUrl);
  assert.deepEqual(blocked, { origin: "", connectionBlocked: true });

  const blockedInitialization = {
    runtimeDiagnostics: blocked.connectionBlocked ? "off" : "on",
    runtimeUrl: blocked.origin
  };
  assert.deepEqual(blockedInitialization, { runtimeDiagnostics: "off", runtimeUrl: "" });
  for (const secret of [credentialedUrl, "user", "secret", "token=x"]) {
    assert.equal(JSON.stringify(blockedInitialization).includes(secret), false);
  }

  assert.deepEqual(
    validateRuntimeUrlSetting("https://example.test/path?token=x#y"),
    { origin: "https://example.test", connectionBlocked: false }
  );
  assert.deepEqual(validateRuntimeUrlSetting(""), { origin: "", connectionBlocked: false });
  for (const invalid of ["not a URL", "ftp://example.test/path", "https://user@example.test/"]) {
    assert.deepEqual(
      validateRuntimeUrlSetting(invalid),
      { origin: "", connectionBlocked: true },
      invalid
    );
  }

  assert.doesNotMatch(validatorSource, /\b(?:console|output)\./);
  assert.doesNotMatch(source.replace(validatorSource, ""), /\braw\b/);

  const requestSource = extractFunction(source, "requestRuntimeState");
  const blockIndex = requestSource.indexOf('verb === "connect" && runtimeUrlConnectionBlocked');
  const sendIndex = requestSource.indexOf("active.sendRequest");
  assert.ok(blockIndex >= 0 && blockIndex < sendIndex, "unsafe Connect requests must stop before sendRequest");
  assert.match(requestSource, /configured HyperBricks runtime URL cannot be used/);
});

test("client pins protocol v1 and the agreed runtime methods", async () => {
  const source = await readFile(path.join(extensionRoot, "src/extension.ts"), "utf8");

  assert.match(source, /const PROTOCOL_VERSION = 1;/);
  assert.match(source, /hyperbricksProtocolVersion/);
  assert.match(source, /hyperbricks\/runtime\/connect/);
  assert.match(source, /hyperbricks\/runtime\/disconnect/);
  assert.match(source, /hyperbricks\/runtime\/status/);
  assert.match(source, /args: \["language-server", "--stdio"\]/);
  assert.match(source, /protocolVersion: PROTOCOL_VERSION/);
  assert.match(
    source,
    /runtimeDiagnostics: settings\.runtimeUrl\.connectionBlocked \? "off" : settings\.runtimeDiagnostics/
  );
  assert.match(source, /runtimeUrl: settings\.runtimeUrl\.origin/);
  assert.doesNotMatch(source, /configurationSection/);
  assert.match(source, /dirtyDocuments: vscode\.workspace\.textDocuments/);
  assert.match(source, /document\.isDirty/);
  assert.match(source, /uncheckedRoutes\?: string\[\]/);
  assert.match(source, /new vscode\.RelativePattern\(folder, "\*\*\/\*\.hyperbricks\.yaml"\)/);
  assert.match(source, /const ownsDocument = \(uri: vscode\.Uri\): boolean/);
  for (const middleware of [
    "didOpen",
    "didChange",
    "didSave",
    "didClose",
    "provideCompletionItem",
    "provideHover",
    "provideDocumentFormattingEdits"
  ]) {
    assert.match(source, new RegExp(`\\b${middleware}:`), `${middleware} must enforce active-folder ownership`);
  }
  assert.match(source, /runtimeErrorsUrl\(runtimeStatus\)/);
  assert.doesNotMatch(source, /RUNTIME_ERRORS_PATH/);
  assert.match(source, /` · \$\{checked\}\/\$\{total\} routes`/);
  for (const field of [
    "connected",
    "generation",
    "errorCount",
    "checkedRoutes",
    "totalRoutes",
    "uncheckedRoutes",
    "evictedContexts",
    "unmappedIssues",
    "lastError",
    "nextRetryMs",
    "runtimeUrl",
    "errorsUrl"
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`), `runtime status must accept ${field}`);
  }
  assert.match(source, /runtime \$\{errorCount === 1 \? "issue" : "issues"\}/);
  assert.match(source, /Runtime issue: \$\{issue\}/);
  assert.match(source, /evicted; runtime coverage may be incomplete/);
  assert.match(source, /lastLoggedUnmappedIssues/);
  assert.match(source, /lastLoggedEvictedContexts/);
  assert.ok(
    source.indexOf("candidate.onNotification(") < source.indexOf("await candidate.start()"),
    "runtime status handler must be registered before automatic runtime startup can publish"
  );
});

test("TextMate grammar augments YAML with HyperBricks lexical scopes", async () => {
  const grammar = await readJSON("syntaxes/hyperbricks.tmLanguage.json");
  assert.equal(grammar.scopeName, "source.hyperbricks");
  assert.ok(grammar.patterns.some(({ include }) => include === "source.yaml"));

  const repository = grammar.repository;
  assert.match(repository["invalid-runtime-keys"].match, /@type\|@order/);
  assert.match(repository["component-types"].match, /hypermedia/);
  assert.match(repository["component-types"].match, /api_fragment_render/);
  const componentTypePattern = new RegExp(repository["component-types"].match);
  for (const source of [
    "  - type: hypermedia",
    "  - type: <HYPERMEDIA>",
    "  - type: '<JAVASCRIPT>'",
    '  - type: "<JSON>" # registered alias'
  ]) {
    assert.match(source, componentTypePattern, `component type must be highlighted: ${source}`);
  }
  for (const source of ["  - type: <NOT_REGISTERED>", "  - type: html-ish"]) {
    assert.doesNotMatch(source, componentTypePattern, `unknown component type must not receive a native scope: ${source}`);
  }
  assert.match(repository["resolver-keys"].match, /var\|env\|config\|path\|file\|format\|args/);
  assert.match(repository["path-bases"].match, /module_root/);

  for (const pattern of Object.values(repository)) {
    for (const property of ["match", "begin", "end"]) {
      if (pattern[property] !== undefined) {
        assert.doesNotThrow(() => new RegExp(pattern[property]), `${property} must be a valid regular expression`);
      }
    }
  }
});

test("language configuration supports YAML editing without changing ordering", async () => {
  const configuration = await readJSON("language-configuration.json");
  assert.equal(configuration.comments.lineComment, "#");
  assert.deepEqual(configuration.brackets, [
    ["{", "}"],
    ["[", "]"]
  ]);
  assert.equal(configuration.folding.offSide, true);
  assert.equal("onEnterRules" in configuration, false, "the extension must not insert or reorder DSL entries");
});
