# HyperBricks for Visual Studio Code

HyperBricks language support backed by the language server in the HyperBricks
executable. The extension provides:

- source and project diagnostics in the Problems panel;
- context-aware component, field, value, path, and inheritance completion;
- hover and whole-document formatting when advertised by the selected language
  server;
- YAML-based TextMate highlighting for HyperBricks component types, reserved
  entries, value resolvers, path bases, and Go-template expressions;
- current runtime-render diagnostics and route coverage in the status bar; and
- an integrated, read-only HyperBricks Doctor command.

The extension deliberately does not carry a second component schema. Semantic
features come from the same parser and schema registry as the configured
HyperBricks executable. The TextMate grammar contains only lexical tokens used
for immediate highlighting before the language server is ready.

## Requirements

Install or build a HyperBricks executable that provides:

```text
hyperbricks language-server --stdio
```

This extension requires HyperBricks editor protocol version 1. It stops the
language-server client and reports a clear error if the executable advertises a
different protocol through its LSP initialize result.

HyperBricks component source files use the `*.hyperbricks.yaml` suffix. The
selected `package.hyperbricks.yaml` uses normal package-configuration data even
though it shares that suffix; the language server selects the correct analysis
mode from the configured package path and source directories.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `hyperbricks.executable` | `hyperbricks` | Executable path used for the language server and Doctor. |
| `hyperbricks.module` | `default` | Module name or directory, with the same selection rules as `doctor -m`. |
| `hyperbricks.config` | `package.hyperbricks.yaml` | Package configuration path relative to the selected module. |
| `hyperbricks.runtimeDiagnostics` | `auto` | `auto`, `on`, or `off` runtime-diagnostic behavior. |
| `hyperbricks.runtimeUrl` | empty | Explicit HTTP(S) runtime base URL; the extension sends only its origin, while an empty value permits local discovery. |
| `hyperbricks.trace.server` | `off` | LSP trace level: `off`, `messages`, or `verbose`. |

In `auto`, the language server connects automatically, using `runtimeUrl` when
set or local discovery otherwise, and quietly skips profiles where diagnostics
are unavailable. `on` uses the same target rules but reports unavailable
profiles and configuration errors. `off` suppresses automatic connection while
leaving the manual Connect command available when the URL setting is empty or
valid. Before the language client starts, an explicit URL must use HTTP or HTTPS,
include a host, and contain no username or password. The extension sends only
the URL origin, discarding any path, query, or fragment. A malformed or
credential-bearing value disables automatic and manual runtime connections
without disabling static language features; clear it to restore local
discovery. Discovery itself is limited to a local development/debug runtime; a
remote URL is never inferred. Local runtime credentials are resolved by
HyperBricks and are not written to extension logs or sent as diagnostic data.
Protocol version 1 does not accept remote credentials; an explicit non-loopback
URL is contacted without reusing the selected module's local account.

Protocol version 1 runs one language-server process for the active HyperBricks
workspace folder. In a multi-root window, activating a HyperBricks document in
another folder restarts the client against that folder before continuing its
module analysis. Separate VS Code windows avoid that brief handoff when two
modules need simultaneous language-server sessions.

## Commands

Open the Command Palette and run:

- **HyperBricks: Restart Language Server**
- **HyperBricks: Connect Runtime Diagnostics**
- **HyperBricks: Disconnect Runtime Diagnostics**
- **HyperBricks: Run Module Check**
- **HyperBricks: Open Runtime Errors** (when the development dashboard is enabled)
- **HyperBricks: Show Output**

The module check runs `hyperbricks doctor --module <module> --config <config>`
as a read-only child process and writes its complete output to the HyperBricks
output channel.

## Local development

From `editors/vscode`:

```bash
npm ci
npm test
npm run compile
```

Open `editors/vscode` as the VS Code workspace and press **F5**. The tracked
launch configuration first runs the compile task and then opens an Extension
Development Host. Use `npm run watch` in a separate terminal for iterative
development, then reload that host after source changes.

To build an installable VSIX:

```bash
npm run package
```

The dependency-free contract tests validate the extension manifest, language
registration, grammar, protocol identifiers, commands, and settings. Compiling
additionally type-checks and bundles the TypeScript client.

## Runtime feedback semantics

Static diagnostics and runtime diagnostics remain separate diagnostic sources.
The status count is the total number of current runtime issues, including
warning and informational severities rather than only errors. An empty runtime-
issue set does not prove the whole application is valid: only routes that have
been requested are covered. When the runtime reports coverage, the status bar
displays `checked/total` routes. If request contexts were evicted from the
runtime snapshot, that gap is called out in the tooltip and output channel.

Runtime issues without a safe workspace source location are not attached to a
fabricated Problems entry. The extension writes their sanitized summaries to
the HyperBricks output channel and repeats up to three in the status tooltip.
The runtime's `__config` marker is attached only to the real selected package
profile when that file exists inside the selected module.

The runtime Errors command opens `/__hyperbricks/errors` only when the connected
runtime advertises that dashboard-owned view. The HyperBricks developer
interface may ask for the module's configured credentials in the browser.
