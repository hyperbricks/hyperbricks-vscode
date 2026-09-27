import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import oniguruma from "vscode-oniguruma";
import textmate from "vscode-textmate";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

const yamlEmbeddedGrammar = {
  scopeName: "source.yaml.embedded",
  patterns: [
    {
      begin: '"',
      end: '"',
      name: "string.quoted.double.yaml"
    },
    {
      begin: "'",
      end: "'",
      name: "string.quoted.single.yaml"
    },
    {
      match: "(?<=^|[\\s:])(?:true|false|null|~)(?=\\s*(?:#.*)?$)",
      name: "constant.language.yaml"
    },
    {
      match: "(?<=^|[\\s:])[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?=\\s*(?:#.*)?$)",
      name: "constant.numeric.yaml"
    },
    {
      match: "[^\\s#][^#]*?(?=\\s*(?:#.*)?$)",
      name: "string.unquoted.plain.out.yaml"
    },
    {
      match: "#.*$",
      name: "comment.line.number-sign.yaml"
    }
  ]
};

const yamlCoreGrammar = {
  scopeName: "source.yaml.1.2",
  patterns: [],
  repository: {
    "flow-node": {
      patterns: [
        {
          begin: '"',
          end: '"',
          name: "string.quoted.double.yaml"
        },
        {
          begin: "'",
          end: "'",
          name: "string.quoted.single.yaml"
        },
        {
          match: "(?:true|false|null|~)",
          name: "constant.language.yaml"
        },
        {
          match: "[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)",
          name: "constant.numeric.yaml"
        },
        {
          match: "[^,{}\\[\\]#]+",
          name: "string.unquoted.plain.in.yaml"
        },
        {
          match: "#.*$",
          name: "comment.line.number-sign.yaml"
        }
      ]
    }
  }
};

async function loadHyperBricksGrammar() {
  const grammarPath = path.join(extensionRoot, "syntaxes/hyperbricks.tmLanguage.json");
  const hyperBricksGrammar = JSON.parse(await readFile(grammarPath, "utf8"));
  const wasm = await readFile(require.resolve("vscode-oniguruma/release/onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (source) => new oniguruma.OnigString(source)
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName === hyperBricksGrammar.scopeName) {
        return hyperBricksGrammar;
      }
      if (scopeName === yamlEmbeddedGrammar.scopeName) {
        return yamlEmbeddedGrammar;
      }
      if (scopeName === yamlCoreGrammar.scopeName) {
        return yamlCoreGrammar;
      }
      return null;
    }
  });

  return registry.loadGrammar(hyperBricksGrammar.scopeName);
}

function tokensByText(line, tokens) {
  return tokens.map(({ startIndex, endIndex, scopes }) => ({
    text: line.slice(startIndex, endIndex),
    scopes
  }));
}

function assertTokenScope(lines, lineNumber, tokenText, expectedScope) {
  const token = lines[lineNumber].find(({ text }) => text === tokenText);
  assert.ok(token, `token ${JSON.stringify(tokenText)} missing on line ${lineNumber + 1}: ${JSON.stringify(lines[lineNumber])}`);
  assert.ok(
    token.scopes.includes(expectedScope),
    `${JSON.stringify(tokenText)} scopes ${JSON.stringify(token.scopes)} must include ${expectedScope}`
  );
}

function assertEveryTokenScope(lines, lineNumber, tokenText, expectedScope) {
  const tokens = lines[lineNumber].filter(({ text }) => text === tokenText);
  assert.notEqual(tokens.length, 0, `token ${JSON.stringify(tokenText)} missing on line ${lineNumber + 1}`);
  for (const token of tokens) {
    assert.ok(
      token.scopes.includes(expectedScope),
      `${JSON.stringify(tokenText)} scopes ${JSON.stringify(token.scopes)} must include ${expectedScope}`
    );
  }
}

function assertTokenLacksScope(lines, lineNumber, tokenText, unexpectedScope) {
  const token = lines[lineNumber].find(({ text }) => text === tokenText);
  assert.ok(token, `token ${JSON.stringify(tokenText)} missing on line ${lineNumber + 1}: ${JSON.stringify(lines[lineNumber])}`);
  assert.equal(
    token.scopes.includes(unexpectedScope),
    false,
    `${JSON.stringify(tokenText)} scopes ${JSON.stringify(token.scopes)} must not include ${unexpectedScope}`
  );
}

test("TextMate tokenizer emits visible HyperBricks scopes throughout a YAML document", async () => {
  const grammar = await loadHyperBricksGrammar();
  assert.ok(grammar, "HyperBricks grammar must load");

  const source = [
    "imports:",
    "  - partials/site.hyperbricks.yaml",
    "# routes use inherited page components",
    "todo_home:",
    "  - inherit: todo_page",
    "  - route: index",
    "  - index: 10",
    "  - nocache: true",
    "  - body:",
    "      - type: template",
    "      - template:",
    "          file: shell.html",
    "          base: resources",
    "          source: {base: templates, path: pages/home.html}",
    "          nested: {file: {base: resources, path: docs/a.txt}}",
    "          sources: [{base: resources, path: docs/a.txt}, {file: {base: templates, path: b.html}}]",
    "after_flow:",
    "  - response:",
    "      headers:",
    "        Cache-Control: no-store"
  ];
  const tokenized = [];
  let ruleStack = textmate.INITIAL;

  for (const line of source) {
    const result = grammar.tokenizeLine(line, ruleStack);
    tokenized.push(tokensByText(line, result.tokens));
    ruleStack = result.ruleStack;
  }

  assertTokenScope(tokenized, 0, "imports", "keyword.control.hyperbricks");
  assertTokenScope(tokenized, 1, "partials/site.hyperbricks.yaml", "string.unquoted.path.hyperbricks");
  assertTokenScope(tokenized, 2, "# routes use inherited page components", "comment.line.number-sign.yaml");
  assertTokenScope(tokenized, 3, "todo_home", "entity.name.tag.yaml");
  assertTokenScope(tokenized, 3, "todo_home", "entity.name.tag.component.hyperbricks");
  assertTokenLacksScope(tokenized, 3, "todo_home", "entity.name.type.component.hyperbricks");
  assertTokenScope(tokenized, 4, "inherit", "keyword.control.inherit.hyperbricks");
  assertTokenScope(tokenized, 4, "todo_page", "entity.other.inherited-class.hyperbricks");
  assertTokenScope(tokenized, 5, "route", "entity.name.tag.yaml");
  assertTokenScope(tokenized, 5, "route", "entity.name.tag.field.hyperbricks");
  assertTokenLacksScope(tokenized, 5, "route", "variable.other.member.field.hyperbricks");
  assertTokenScope(tokenized, 6, "10", "constant.numeric.yaml");
  assertTokenScope(tokenized, 7, "true", "constant.language.yaml");
  assertTokenScope(tokenized, 8, "body", "entity.name.tag.yaml");
  assertTokenScope(tokenized, 8, "body", "entity.name.tag.field.hyperbricks");
  assertTokenScope(tokenized, 9, "type", "keyword.control.type.hyperbricks");
  assertTokenScope(tokenized, 9, "template", "support.type.component.hyperbricks");
  assertTokenScope(tokenized, 11, "file", "entity.name.tag.yaml");
  assertTokenScope(tokenized, 11, "file", "entity.name.tag.path.hyperbricks");
  assertTokenScope(tokenized, 11, "shell.html", "string.unquoted.path.hyperbricks");
  assertTokenScope(tokenized, 12, "base", "entity.name.tag.yaml");
  assertTokenScope(tokenized, 12, "base", "entity.name.tag.resolver.hyperbricks");
  assertTokenScope(tokenized, 12, "resources", "support.constant.path-base.hyperbricks");
  assertTokenScope(tokenized, 13, "base", "entity.name.tag.resolver.hyperbricks");
  assertTokenScope(tokenized, 13, "templates", "support.constant.path-base.hyperbricks");
  assertTokenScope(tokenized, 13, "path", "entity.name.tag.resolver.hyperbricks");
  assertTokenScope(tokenized, 14, "file", "entity.name.tag.resolver.hyperbricks");
  assertTokenScope(tokenized, 14, "base", "entity.name.tag.resolver.hyperbricks");
  assertTokenScope(tokenized, 14, "resources", "support.constant.path-base.hyperbricks");
  assertTokenScope(tokenized, 14, "path", "entity.name.tag.resolver.hyperbricks");
  assertEveryTokenScope(tokenized, 15, "base", "entity.name.tag.resolver.hyperbricks");
  assertEveryTokenScope(tokenized, 15, "path", "entity.name.tag.resolver.hyperbricks");
  assertTokenScope(tokenized, 15, "file", "entity.name.tag.resolver.hyperbricks");
  assertTokenScope(tokenized, 15, "resources", "support.constant.path-base.hyperbricks");
  assertTokenScope(tokenized, 15, "templates", "support.constant.path-base.hyperbricks");
  assertTokenScope(tokenized, 16, "after_flow", "entity.name.tag.yaml");
  assertTokenScope(tokenized, 16, "after_flow", "entity.name.tag.component.hyperbricks");
  for (const [line, key] of [
    [17, "response"],
    [18, "headers"],
    [19, "Cache-Control"]
  ]) {
    assertTokenScope(tokenized, line, key, "entity.name.tag.yaml");
    assertTokenScope(tokenized, line, key, "entity.name.tag.field.hyperbricks");
    assertTokenLacksScope(tokenized, line, key, "variable.other.member.field.hyperbricks");
  }
  assertTokenScope(tokenized, 19, "no-store", "string.unquoted.plain.out.yaml");
  assert.equal(ruleStack.depth, 1, "nested flow scopes must return to the document root");
});
