import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import oniguruma from "vscode-oniguruma";
import textmate from "vscode-textmate";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

async function loadHyperBricksGrammar() {
  const grammarPath = path.join(extensionRoot, "syntaxes/hyperbricks.tmLanguage.json");
  const hyperBricksGrammar = JSON.parse(await readFile(grammarPath, "utf8"));
  const fixtureRoot = path.join(extensionRoot, "test/fixtures/vscode-yaml");
  const grammars = new Map([[hyperBricksGrammar.scopeName, hyperBricksGrammar]]);
  for (const file of await readdir(fixtureRoot)) {
    if (!file.endsWith(".tmLanguage.json")) continue;
    const grammar = JSON.parse(await readFile(path.join(fixtureRoot, file), "utf8"));
    grammars.set(grammar.scopeName, grammar);
  }
  const wasm = await readFile(require.resolve("vscode-oniguruma/release/onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (source) => new oniguruma.OnigString(source)
    }),
    loadGrammar: async (scopeName) => {
      assert.ok(grammars.has(scopeName), `missing real YAML grammar dependency: ${scopeName}`);
      return grammars.get(scopeName);
    }
  });
  return registry.loadGrammar(hyperBricksGrammar.scopeName);
}

async function tokenize(source) {
  const grammar = await loadHyperBricksGrammar();
  let ruleStack = textmate.INITIAL;
  return source.map((line) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    return result.tokens.map(({ startIndex, endIndex, scopes }) => ({
      text: line.slice(startIndex, endIndex),
      startIndex,
      endIndex,
      scopes
    }));
  });
}

function scopesAt(source, tokenized, lineNumber, text, occurrence = 0) {
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) index = source[lineNumber].indexOf(text, index + 1);
  assert.ok(index >= 0, `missing ${JSON.stringify(text)} on source line ${lineNumber + 1}`);
  const tokens = tokenized[lineNumber].filter(({ startIndex, endIndex }) => startIndex <= index && endIndex > index);
  assert.equal(tokens.length, 1, `expected one token at ${index}: ${JSON.stringify(tokenized[lineNumber])}`);
  return tokens[0].scopes;
}

function hasScope(source, tokenized, line, text, scope, occurrence = 0) {
  const scopes = scopesAt(source, tokenized, line, text, occurrence);
  assert.ok(scopes.some((value) => value === scope || value.startsWith(`${scope}.`)),
    `${JSON.stringify(text)} on line ${line + 1}: expected ${scope}, got ${JSON.stringify(scopes)}`);
}

function lacksScope(source, tokenized, line, text, scope, occurrence = 0) {
  const scopes = scopesAt(source, tokenized, line, text, occurrence);
  assert.ok(!scopes.some((value) => value === scope || value.startsWith(`${scope}.`)),
    `${JSON.stringify(text)} on line ${line + 1}: unexpected ${scope} in ${JSON.stringify(scopes)}`);
}

test("comments terminate every YAML scalar style and survive nested resolver mappings", async () => {
  const source = [
    "# document comment",
    "imports:",
    "  - partials/site.hyperbricks.yaml # import comment",
    "mydoc:",
    "  - type: text # type comment",
    "  - value: ok # plain comment",
    "  - value: 'it''s # literal' # single quote comment",
    '  - value: "escaped \\" # literal" # double quote comment',
    "  - file: docs/readme.md # path comment",
    "  - value: {file: {base: resources, path: docs/readme.md}} # resolver comment",
    "  - value: {format: '%s # literal', args: [{var: name}, {env: NAME}]} # list comment",
    "# after the component",
    "next:",
    "  - inherit: mydoc # inherited comment"
  ];
  const tokenized = await tokenize(source);
  for (const [line, comment] of [
    [0, "# document"], [2, "# import"], [4, "# type"], [5, "# plain"],
    [6, "# single"], [7, "# double"], [8, "# path"], [9, "# resolver"],
    [10, "# list"], [11, "# after"], [13, "# inherited"]
  ]) {
    hasScope(source, tokenized, line, comment, "comment.line.number-sign.yaml");
    lacksScope(source, tokenized, line, comment, "string");
  }
  for (const line of [6, 7, 10]) {
    hasScope(source, tokenized, line, "# literal", "string");
    lacksScope(source, tokenized, line, "# literal", "comment");
  }
  hasScope(source, tokenized, 9, "file:", "entity.name.tag.yaml");
  hasScope(source, tokenized, 9, "path:", "entity.name.tag.yaml");
  hasScope(source, tokenized, 9, "docs/readme.md", "string.unquoted.plain.in.yaml");
  hasScope(source, tokenized, 9, "}", "punctuation.definition.mapping.end.yaml", 0);
  hasScope(source, tokenized, 9, "}", "punctuation.definition.mapping.end.yaml", 1);
  for (const line of [9, 10]) {
    for (const token of tokenized[line]) {
      assert.ok(!token.scopes.some((scope) => scope.startsWith("invalid.illegal")), JSON.stringify(token));
    }
  }
  hasScope(source, tokenized, 12, "next", "entity.name.tag.component.hyperbricks");
});

test("YAML quoting and block scalar indentation protect literal content from DSL rules", async () => {
  const source = [
    "document:",
    "  - type: template",
    "  - inline: |- # header comment",
    "      # this is literal content",
    "      - type: html",
    "      - inherit: example",
    "      value: {file: {base: resources, path: docs/example.md}}",
    "      {{ .title | upper }}",
    "  # back in YAML",
    "  - values:",
    "      hash: docs/readme.md#section",
    "      text: '- inherit: example # literal'",
    "      folded: >-",
    "        # folded text",
    "        - type: text",
    "      after: ready # mapping comment",
    "other:",
    "  - type: text"
  ];
  const tokenized = await tokenize(source);
  hasScope(source, tokenized, 2, "# header", "comment.line.number-sign.yaml");
  for (const [line, text] of [[3, "# this"], [4, "type"], [5, "inherit"], [6, "file"], [13, "# folded"], [14, "type"]]) {
    hasScope(source, tokenized, line, text, "string.unquoted.block.yaml");
    lacksScope(source, tokenized, line, text, "keyword.control");
    lacksScope(source, tokenized, line, text, "comment");
    lacksScope(source, tokenized, line, text, "entity.name.tag");
  }
  hasScope(source, tokenized, 7, ".title", "variable.other.template.hyperbricks");
  hasScope(source, tokenized, 8, "# back", "comment.line.number-sign.yaml");
  hasScope(source, tokenized, 10, "#section", "string.unquoted.plain.out.yaml");
  lacksScope(source, tokenized, 10, "#section", "comment");
  hasScope(source, tokenized, 11, "inherit", "string.quoted.single.yaml");
  lacksScope(source, tokenized, 11, "inherit", "keyword.control");
  hasScope(source, tokenized, 15, "# mapping", "comment.line.number-sign.yaml");
  hasScope(source, tokenized, 17, "type", "keyword.control.type.hyperbricks");
});

test("HyperBricks lexical styling stays inside real YAML keys and values", async () => {
  const source = [
    "imports:",
    "  - partials/site.hyperbricks.yaml",
    "page:",
    "  - inherit: base_page",
    "  - title: Welcome",
    "  - response:",
    "      headers:",
    "        Cache-Control: no-store",
    "  - body:",
    "      - type: '<TEMPLATE>'",
    "      - template: {file: shell.html}",
    "      - values:",
    "          type: ordinary data",
    "          inherit: ordinary data",
    "  - nocache: true",
    "  - index: 10",
    "  - custom:",
    "      - type: not_registered",
    "  - hyphenated:",
    "      - type: html-ish"
  ];
  const tokenized = await tokenize(source);
  hasScope(source, tokenized, 0, "imports", "keyword.control.hyperbricks");
  hasScope(source, tokenized, 2, "page", "entity.name.tag.component.hyperbricks");
  hasScope(source, tokenized, 3, "inherit", "keyword.control.inherit.hyperbricks");
  hasScope(source, tokenized, 3, "base_page", "entity.other.inherited-class.hyperbricks");
  hasScope(source, tokenized, 4, "title", "support.type.property-name.hyperbricks");
  for (const [line, text] of [[6, "headers"], [7, "Cache-Control"], [12, "type"], [13, "inherit"]]) {
    hasScope(source, tokenized, line, text, "entity.name.tag.yaml");
    lacksScope(source, tokenized, line, text, "keyword.control");
    lacksScope(source, tokenized, line, text, "support.type.property-name.hyperbricks");
  }
  hasScope(source, tokenized, 9, "type", "keyword.control.type.hyperbricks");
  hasScope(source, tokenized, 9, "<TEMPLATE>", "support.type.component.hyperbricks");
  hasScope(source, tokenized, 14, "true", "constant.language.boolean.yaml");
  hasScope(source, tokenized, 15, "10", "constant.numeric.integer.decimal.yaml");
  lacksScope(source, tokenized, 17, "not_registered", "support.type.component.hyperbricks");
  lacksScope(source, tokenized, 19, "html-ish", "support.type.component.hyperbricks");
});

test("editing incomplete values never colors subsequent YAML comments as template or scalar content", async () => {
  const source = [
    "mydoc:",
    "  - type: text",
    "  - value: ok # accepted",
    "  - value {file: {base: resources, path: docs/llms.md}} # missing colon",
    "# comments after an incomplete component entry",
    "other:",
    "  - type: template",
    "  - inline: '{{ .title' # incomplete template expression",
    "# comments after an incomplete template expression",
    "  - values:",
    "      title: Hello"
  ];
  const tokenized = await tokenize(source);
  for (const [line, comment] of [[2, "# accepted"], [3, "# missing"], [4, "# comments"], [7, "# incomplete"], [8, "# comments"]]) {
    hasScope(source, tokenized, line, comment, "comment.line.number-sign.yaml");
    lacksScope(source, tokenized, line, comment, "string");
    lacksScope(source, tokenized, line, comment, "meta.template.expression.hyperbricks");
  }
  hasScope(source, tokenized, 10, "title", "entity.name.tag.yaml");
});

test("multiline flow resolvers retain YAML delimiters and comments", async () => {
  const source = [
    "document:",
    "  - type: text",
    "  - value: {",
    "      format: '%s %s', # format comment",
    "      args: [",
    "        {file: {base: resources, # base comment",
    "                path: 'docs/readme.md#literal'}},",
    "        {env: {name: TITLE, default: 'Untitled # literal'}}",
    "      ] # sequence comment",
    "    } # mapping comment",
    "# after flow",
    "after:",
    "  - type: text"
  ];
  const tokenized = await tokenize(source);
  for (const [line, comment] of [[3, "# format"], [5, "# base"], [8, "# sequence"], [9, "# mapping"], [10, "# after"]]) {
    hasScope(source, tokenized, line, comment, "comment.line.number-sign.yaml");
    lacksScope(source, tokenized, line, comment, "string");
  }
  hasScope(source, tokenized, 6, "#literal", "string.quoted.single.yaml");
  hasScope(source, tokenized, 7, "# literal", "string.quoted.single.yaml");
  hasScope(source, tokenized, 8, "]", "punctuation.definition.sequence.end.yaml");
  hasScope(source, tokenized, 9, "}", "punctuation.definition.mapping.end.yaml");
  hasScope(source, tokenized, 12, "text", "support.type.component.hyperbricks");
});

test("template expressions stay bounded by their containing YAML scalar", async () => {
  const source = [
    "page:",
    "  - type: template",
    "  - inline: '{{ .title }}' # single quoted template",
    '  - inline: "{{ .title }}" # double quoted template',
    "  - inline: '{{ .title' # unfinished, even when a comment has }}",
    '  - inline: "{{ .title" # unfinished, even when a comment has }}',
    "  - inline: |2- # explicit indentation",
    "      {{ .title",
    "      # literal block text",
    "  # outside the unclosed template in the block",
    "  - values:",
    "      title: Home"
  ];
  const tokenized = await tokenize(source);
  for (const line of [2, 3]) hasScope(source, tokenized, line, ".title", "variable.other.template.hyperbricks");
  for (const [line, text] of [[2, "# single"], [3, "# double"], [4, "# unfinished"], [5, "# unfinished"], [6, "# explicit"], [9, "# outside"]]) {
    hasScope(source, tokenized, line, text, "comment.line.number-sign.yaml");
    lacksScope(source, tokenized, line, text, "meta.template.expression.hyperbricks");
  }
  hasScope(source, tokenized, 8, "# literal", "string.unquoted.block.yaml");
  lacksScope(source, tokenized, 8, "# literal", "comment");
  hasScope(source, tokenized, 11, "title", "entity.name.tag.yaml");
});
