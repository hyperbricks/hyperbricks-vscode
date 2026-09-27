import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/smart-enter.ts", import.meta.url), "utf8");
function load(vscode = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  Function("require", "module", "exports", output)(() => vscode, module, module.exports);
  return module.exports;
}
const { canExitIndentation } = load();
const eligible = (text) => canExitIndentation(text.split(/\r?\n/), text.split(/\r?\n/).at(-1).length);

test("smart Enter exits nested indentation after the user's complete file resolver", () => {
  assert.equal(eligible("llms:\n  - content:\n      - type: text\n      - value: {file: {base: resources, path: docs/llms.md}}\n      "), true);
  assert.equal(eligible("page:\r\n  - title: Done\r\n  "), true);
  for (const value of ["hello # [ignore", "'quoted { value'", '"escaped \\" quote"', "it's fine", "true"]) {
    assert.equal(eligible(`page:\n  - value: ${value}\n  `), true, value);
  }
});

test("smart Enter preserves block scalars including blank lines and indicator variants", () => {
  for (const marker of ["|", ">", "|-", ">+", "|2-", ">+2"]) {
    for (const body of ["", "      hello\n", "      { not YAML\n\n"]) {
      assert.equal(eligible(`page:\n  - value: ${marker} # text\n${body}      `), false, marker);
    }
    assert.equal(eligible(`page:\n  - value: ${marker}\n      text\n  - title: Next\n  `), true);
  }
});

test("smart Enter leaves unfinished flow/quoted content and nonempty lines alone", () => {
  for (const content of ["{file: {base: resources,", "[one,", "'unfinished", '"unfinished', "{path: [one}"]) {
    assert.equal(eligible(`page:\n  - value: ${content}\n    `), false, content);
  }
  assert.equal(eligible("page:\n  - value: {\n      file: {path: docs/test.md}\n    }\n  "), true);
  for (const line of ["", "  - ", "  # comment", "  - value: text"]) {
    assert.equal(eligible(`page:\n${line}`), false);
  }
  assert.equal(canExitIndentation(["page:", "    "], 2), false);
});

test("Enter handler replaces only the empty line and delegates ordinary editing", async () => {
  const calls = [];
  let enabled = true;
  let text = "page:\n  - value: done\n    ";
  const editor = {
    document: {
      languageId: "hyperbricks-yaml", uri: {},
      lineAt: () => ({ text: text.split("\n").at(-1), range: "empty-line-range" }),
      getText: () => text
    },
    selections: [{}], selection: { isEmpty: true, active: { line: 2, character: 4 } },
    edit: async (callback) => { callback({ replace: (range, value) => calls.push(["edit", value, range]) }); return true; }
  };
  const api = {
    window: { activeTextEditor: editor },
    workspace: { getConfiguration: () => ({ get: () => enabled }) },
    commands: { executeCommand: async (...args) => calls.push(args) },
    Range: class {}, EndOfLine: { CRLF: 2 },
    Selection: class { constructor(line, character) { this.active = { line, character }; this.isEmpty = true; } }
  };
  const { smartEnter } = load(api);
  await smartEnter();
  assert.deepEqual(calls.pop(), ["edit", "\n", "empty-line-range"]);
  assert.deepEqual(editor.selection.active, { line: 3, character: 0 });
  editor.selection.active = { line: 2, character: 4 };
  editor.document.eol = 2;
  await smartEnter();
  assert.deepEqual(calls.pop(), ["edit", "\r\n", "empty-line-range"]);
  for (const mode of ["disabled", "selection", "multicursor", "other-language", "block", "content"]) {
    editor.selection.active = { line: 2, character: 4 };
    enabled = mode !== "disabled";
    editor.selection.isEmpty = mode !== "selection";
    editor.selections = mode === "multicursor" ? [{}, {}] : [{}];
    editor.document.languageId = mode === "other-language" ? "yaml" : "hyperbricks-yaml";
    text = mode === "block" ? "page:\n  - value: |\n    " : mode === "content" ? "page:\n  - value: done" : "page:\n  - value: done\n    ";
    await smartEnter();
    assert.deepEqual(calls.pop(), ["type", { text: "\n" }], mode);
  }
});

test("Enter binding is language-scoped, configurable, and does not steal suggestion/snippet Enter", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const binding = manifest.contributes.keybindings.find(item => item.command === "hyperbricks.smartEnter");
  assert.equal(binding.key, "enter");
  for (const guard of ["editorTextFocus", "!editorReadonly", "editorLangId == hyperbricks-yaml", "config.hyperbricks.smartEnter", "!suggestWidgetVisible", "!inlineSuggestionVisible", "!inSnippetMode", "!editorHasMultipleSelections", "!editorHasSelection"]) {
    assert.ok(binding.when.includes(guard), guard);
  }
  assert.equal(manifest.contributes.configuration.properties["hyperbricks.smartEnter"].default, true);
});
