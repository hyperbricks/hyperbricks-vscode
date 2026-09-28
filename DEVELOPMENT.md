# Developing the HyperBricks VS Code extension

This document is for contributors working on the extension. For installation,
settings, commands, and troubleshooting, see the [user guide](README.md).

## Requirements

- Go, for building the matching HyperBricks executable
- Node.js and npm, for the extension toolchain
- Visual Studio Code 1.95 or newer

The extension uses editor protocol version 1 and rejects an incompatible
language server during initialization. Use a HyperBricks checkout that supports
the protocol version under development.

## Set up the checkouts

Clone the runtime and extension repositories beside each other, then build a
development executable into the extension's ignored `.dev` directory:

```bash
git clone https://github.com/hyperbricks/hyperbricks.git
git clone https://github.com/hyperbricks/hyperbricks-vscode.git
cd hyperbricks
go build -o ../hyperbricks-vscode/.dev/hyperbricks ./cmd/hyperbricks
```

Install extension dependencies and run the complete extension check:

```bash
cd ../hyperbricks-vscode
npm ci
npm run check
```

Configure the development workspace to use the absolute path of the executable:

```json
"hyperbricks.executable": "/absolute/path/to/hyperbricks-vscode/.dev/hyperbricks"
```

The `.dev` directory is ignored and keeps the runtime build outside both
repositories' tracked files.

## Run the Extension Development Host

Open the extension repository as the VS Code workspace and press **F5**. The
tracked launch configuration runs the compile task before starting the
Extension Development Host.

For iterative TypeScript work, run:

```bash
npm run watch
```

Reload the development host after a rebuilt bundle or manifest change. When a
change also affects the language server, rebuild the HyperBricks executable and
restart the client with **HyperBricks: Restart Language Server**.

## Architecture boundaries

The extension is a client of the language server in the HyperBricks executable.
It does not maintain a second component schema. Native types, fields,
validation, formatting, completion, hover, navigation, and runtime diagnostics
come from the runtime parser and schema registry.

The extension starts:

```text
hyperbricks language-server --stdio
```

The process uses LSP 3.17 framing. Standard output is reserved for JSON-RPC;
process logs and protocol diagnostics belong on standard error or in the
HyperBricks output channel.

The client sends the selected module and package profile during initialization.
The server keeps unsaved documents in an in-memory overlay, so diagnostics,
completion, hover, and navigation can follow the active buffer.

Highlighting has two layers:

- the TextMate grammar extends the complete VS Code YAML grammar for immediate
  lexical highlighting;
- semantic tokens from the language server add schema-aware distinctions.

The extension publishes standard semantic token kinds and does not hardcode a
color palette. Visible colors remain owned by the active VS Code theme.

## Checks

| Command | Purpose |
| --- | --- |
| `npm test` | Run manifest, protocol, module-selection, Smart Enter, and grammar-tokenization tests. |
| `npm run typecheck` | Type-check the TypeScript client without emitting output. |
| `npm run bundle` | Bundle the extension client with esbuild. |
| `npm run compile` | Type-check and bundle. |
| `npm run check` | Run the tests and compile the extension. |

The contract tests cover the extension manifest, language registration,
protocol identifiers, commands, settings, and runtime URL validation. Grammar
tests load the complete vendored VS Code YAML grammar and verify emitted scopes;
they do not test the colors of a particular theme.

## Build a VSIX

From the extension repository root, run:

```bash
npm run package
```

This compiles the extension and creates a versioned VSIX in the same directory.
The VSIX is a local build artifact, is not part of the HyperBricks runtime
archive, and must not be committed. Publishing the extension is a separate
release action.
