# HyperBricks for Visual Studio Code

HyperBricks language support backed by the language server in the HyperBricks
executable.

| Feature | How to use it | Result |
| --- | --- | --- |
| Highlighting | Open `*.hyperbricks.yaml` and select **HyperBricks YAML** when needed. | Theme-driven YAML scopes for declarations, native types, reserved fields, inheritance, resolvers, paths, and Go-template expressions. |
| Static diagnostics | Edit an owned source, untitled HyperBricks buffer, or selected package file and inspect **Problems**. | Immediate YAML, native-schema, import, inheritance, and configuration feedback from unsaved buffers. |
| Completion and snippets | Type normally or run **Trigger Suggest** in a type, field, `inherit`, resolver, template, or recognized local-path position. | Schema-backed suggestions plus effective dotted `inherit` paths across imports. |
| Hover | Hover a native `type` value or schema-owned field. | Registry descriptions and, for fields, examples when available. Inherited components use their effective native type. |
| Go to Definition | Press F12 or Cmd/Ctrl-click an import, `inherit`, `template.file`, or recognized local resource path. | Opens the effective declaration or actual file, including transitive imports and unsaved buffers. |
| Formatting | Run **Format Document** or enable format-on-save separately. | Safe whole-document formatting that preserves ordered entries, mapping order, comments, scalar styles, and meaning. |
| Module check | Run **HyperBricks: Run Module Check**. | Executes the saved-project Doctor check and writes the complete report to HyperBricks Output. |
| Runtime feedback | Start a development/debug runtime and use automatic discovery or **Connect Runtime Diagnostics**. | Safely mapped runtime Problems, checked-route coverage in the status bar, and the Errors view when advertised. |

The extension deliberately does not carry a second component schema. Semantic
features come from the same parser and schema registry as the configured
HyperBricks executable. The TextMate grammar contains only lexical tokens used
for immediate highlighting before the language server is ready.

Code suggestions here mean IntelliSense completions and snippets. The extension
does not provide AI-generated code or Quick Fixes. Dotted object-path completion
is specific to runtime-valid `inherit` references; ordinary mappings such as a
template's `values` are not inheritance paths.

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

## Install and first use

Use a VSIX and `hyperbricks` executable from the same revision. This extension
is not currently installed from a marketplace.

If you do not already have a VSIX, build one from this directory:

```bash
npm ci
npm run package
```

1. Choose **Extensions: Install from VSIX...**, or run:

   ```bash
   code --install-extension path/to/hyperbricks-vscode-VERSION.vsix
   ```

2. Run **Developer: Reload Window**, open a trusted local HyperBricks workspace,
   and open a `*.hyperbricks.yaml` file.
3. Confirm that the language mode is **HyperBricks YAML**. If the status bar says
   **select module**, configure the owner explicitly. Use **HyperBricks: Show
   Output** to verify the selected module and package profile.
4. Leave `hyperbricks.module` empty for automatic selection. Configure
   `hyperbricks.executable` only when the matching executable is not available as
   `hyperbricks` on `PATH` or a checkout-specific build should be used.
5. Use **Problems** for live buffer feedback and **HyperBricks: Run Module
   Check** for the complete saved-project report. Start the module in development
   or debug mode when runtime feedback is needed.

## Settings

| Setting | Default | Change it when |
| --- | --- | --- |
| `hyperbricks.executable` | `hyperbricks` | The matching executable is not on `PATH`, or the workspace should use a checkout-specific build. |
| `hyperbricks.module` | empty (automatic) | Automatic ownership cannot identify the intended module, or another module must be selected explicitly. |
| `hyperbricks.config` | `package.hyperbricks.yaml` | The selected module uses a differently named package profile. |
| `hyperbricks.runtimeDiagnostics` | `auto` | Runtime feedback must report unavailability (`on`) or must not connect automatically (`off`). |
| `hyperbricks.runtimeUrl` | empty | The extension should use an explicit HTTP(S) runtime origin instead of local discovery. |
| `hyperbricks.trace.server` | `off` | You need `messages` or `verbose` protocol tracing. |

Automatic module selection walks from the active HyperBricks file toward its
workspace root and chooses the nearest directory containing the configured
package file. Switching between modules in one repository restarts and scopes
the language client to the newly selected package. If no safe owning package is
found, the status bar asks for an explicit `hyperbricks.module`; the extension
does not analyze the source against an unrelated fallback module.

Detailed module-selection, runtime URL and authentication rules, multi-root
behavior, diagnostic lifecycles, and troubleshooting live in the
canonical `docs/VSCODE.md` guide from the same HyperBricks revision.

## Commands

Open the Command Palette and run:

| Command | Use it when | Result or availability |
| --- | --- | --- |
| **HyperBricks: Restart Language Server** | Recovering from a server failure or manually reloading source intelligence. | Restarts the client with the current project settings. |
| **HyperBricks: Connect Runtime Diagnostics** | Requesting a manual connection to a development or debug runtime. | Attempts the connection; the configured or discovered runtime must also be reachable, compatible, and authorized. |
| **HyperBricks: Disconnect Runtime Diagnostics** | Temporarily stopping runtime feedback. | Leaves all static language features active. |
| **HyperBricks: Run Module Check** | Checking the complete saved module and package profile. | Runs `hyperbricks doctor` and writes its full report to HyperBricks Output. |
| **HyperBricks: Open Runtime Errors** | Inspecting rendered failures in the browser. | Opens the view when the connected runtime advertises it; otherwise explains why it is unavailable. |
| **HyperBricks: Show Output** | Diagnosing executable, module, runtime, or protocol problems. | Opens the HyperBricks output channel. |

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

The contract tests validate the extension manifest, language registration,
protocol identifiers, commands, and settings. A tokenizer test also loads the
TextMate grammar and verifies that representative HyperBricks tokens receive
their intended scopes throughout a document. Compiling additionally type-checks
and bundles the TypeScript client.
