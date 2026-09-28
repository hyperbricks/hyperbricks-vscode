# HyperBricks for Visual Studio Code

The HyperBricks extension adds language support for `*.hyperbricks.yaml` files.
It uses the language server built into the HyperBricks executable, so the
extension and executable must come from the same HyperBricks revision.

The extension is not currently distributed through a marketplace. Install it
from a VSIX supplied with, or built from, the matching HyperBricks source.

## What you get

| Feature | How to use it |
| --- | --- |
| Highlighting | Open a `*.hyperbricks.yaml` file and confirm the language mode is **HyperBricks YAML**. |
| Static diagnostics | Edit a source or package file and inspect the **Problems** panel. |
| Completion | Type `- ` for component entries, `: ` for values, or press **Control+Space**. |
| Hover | Hover a native type, schema field, resolver, or resolver option. |
| Go to Definition | Press F12 or Cmd/Ctrl-click imports, inheritance targets, variables, configuration paths, templates, or local resources. |
| Formatting | Run **Format Document** or enable format-on-save. |
| Module check | Run **HyperBricks: Run Module Check** for the complete saved-project Doctor report. |
| Runtime feedback | Start the module in development or debug mode and connect runtime diagnostics. |

The extension does not carry a separate component schema. Validation,
completion, hover, navigation, formatting, and semantic highlighting use the
parser and schema registry from the configured HyperBricks executable.

## Requirements

- Visual Studio Code 1.95 or newer
- A trusted, local workspace
- A matching HyperBricks executable that provides:

  ```text
  hyperbricks language-server --stdio
  ```

The extension requires HyperBricks editor protocol version 1. It reports a
clear compatibility error instead of starting against another protocol version.

## Install and start

1. Obtain a VSIX and HyperBricks executable from the same revision.
2. Install the VSIX with **Extensions: Install from VSIX...**, or run:

   ```bash
   code --install-extension path/to/hyperbricks-vscode-VERSION.vsix
   ```

3. Run **Developer: Reload Window**.
4. Open a trusted HyperBricks workspace and a `*.hyperbricks.yaml` file.
5. Confirm that the language mode is **HyperBricks YAML**.
6. Open **HyperBricks: Show Output** to confirm the selected executable, module,
   and package profile.

When `hyperbricks` is not on `PATH`, set `hyperbricks.executable` to its absolute
path. Building the extension or executable from source is documented in
[DEVELOPMENT.md](DEVELOPMENT.md).

## Module selection

With `hyperbricks.module` left empty, the extension walks up from the active
HyperBricks file and selects the nearest directory containing the configured
package file. If no safe owner is found, the status bar asks you to select a
module instead of analyzing the file against an unrelated project.

Set `hyperbricks.module` only when automatic ownership cannot find the intended
module. Changing the executable, module, or package profile restarts the
language server with one consistent project snapshot.

One client follows one active workspace folder. In a multi-root window,
activating a HyperBricks file in another folder moves the client to that folder.
Use separate VS Code windows when two modules need simultaneous language-server
sessions.

## Editing behavior

Completion follows the YAML structure at the cursor. It suggests native
component types, effective fields and children, resolver forms and options,
reachable inheritance paths, source variables, configuration paths, and known
local files. Ordinary application data does not receive invented component
fields, and protocol version 1 does not provide schemas owned only by plugins.

The formatter uses two-space indentation while preserving component order,
mapping order, comments, scalar styles, and parsed meaning. It rejects an edit
that would change the YAML data model.

### Smart Enter

Smart Enter is enabled by default. After a completed field, the first Enter
keeps normal indentation. Press Enter again on the empty indented line to leave
a blank separator and move to column 0.

Set `hyperbricks.smartEnter` to `false` for ordinary YAML Enter behavior. Block
scalars, unfinished quotes or flow collections, completion popups, snippets,
selections, and multiple cursors keep their normal behavior.

## Settings

| Setting | Default | Use |
| --- | --- | --- |
| `hyperbricks.executable` | `hyperbricks` | Absolute path or command name of the matching HyperBricks executable. |
| `hyperbricks.module` | empty | Explicit module when automatic ownership cannot identify it. |
| `hyperbricks.config` | `package.hyperbricks.yaml` | Package filename or path relative to the selected module. |
| `hyperbricks.runtimeDiagnostics` | `auto` | Use `on` to report unavailable runtime feedback or `off` to disable automatic connection. |
| `hyperbricks.runtimeUrl` | empty | Explicit HTTP(S) runtime origin; empty uses local discovery. |
| `hyperbricks.trace.server` | `off` | Use `messages` or `verbose` for language-server protocol tracing. |
| `hyperbricks.smartEnter` | `true` | Disable the second-Enter indentation shortcut. |

`runtimeDiagnostics: auto` quietly skips profiles where runtime diagnostics are
unavailable. `on` uses the same connection rules but reports configuration and
availability errors. `off` disables automatic connection; the manual Connect
command remains available.

An explicit runtime URL must use HTTP or HTTPS, include a host, and contain no
username or password. Only its origin is sent to the language server; paths,
queries, and fragments are discarded.

## Commands

Open the Command Palette and run:

| Command | Purpose |
| --- | --- |
| **HyperBricks: Restart Language Server** | Restart static language features with the current project settings. |
| **HyperBricks: Connect Runtime Diagnostics** | Manually connect to an available development or debug runtime. |
| **HyperBricks: Disconnect Runtime Diagnostics** | Stop runtime feedback without disabling static language features. |
| **HyperBricks: Run Module Check** | Run `hyperbricks doctor` against the saved module and package profile. |
| **HyperBricks: Open Runtime Errors** | Open the browser Errors view when the connected runtime advertises it. |
| **HyperBricks: Show Output** | Inspect executable, module, runtime, and protocol information. |

## Runtime feedback

Runtime feedback is available in development and debug mode. It reports render
issues for routes and request variants that have actually run; an empty Problems
list does not prove that every route has been checked. The status bar shows
checked-route coverage.

Runtime diagnostics describe saved source loaded by the running process. Save a
dirty document and allow the watcher to reload before using runtime output to
judge the edit. Static diagnostics continue to follow the unsaved buffer.

Automatic credential use is restricted to loopback addresses and `localhost`.
Protocol version 1 does not accept remote credentials from the extension, so a
protected remote runtime will normally remain disconnected. Never place runtime
credentials in workspace settings or URLs.

The browser Errors view is available only when the connected runtime advertises
it. JSON runtime diagnostics do not require that view to be enabled.

## Troubleshooting

### The language server does not start

Run the configured executable directly:

```bash
hyperbricks language-server --help
```

Then open **HyperBricks: Show Output**. A development checkout may be newer than
the executable found on `PATH`; use a matching executable and VSIX.

### The wrong module is selected

Leave `hyperbricks.module` empty when the source lives below its owning package
file. Otherwise set the module explicitly and run **HyperBricks: Restart
Language Server**. Imports, templates, and resource completion remain confined
to the selected module.

### A file has no highlighting

Set the language mode to **HyperBricks YAML**. If only basic YAML colors appear,
enable semantic highlighting and restart the language server. After replacing a
VSIX, run **Developer: Reload Window** so VS Code reloads its manifest and
grammar.

### Suggestions appear only after Control+Space

Automatic suggestions require a supported YAML position such as a component
entry after `- ` or a value after `: `. Comments, literal blocks, and ordinary
data lists do not request component fields.

### Runtime feedback is disconnected

Confirm that the selected module is running in development or debug mode and
that its URL, port, and developer-interface credentials are correct. A `401`
means credentials were rejected; a `503` means complete developer credentials
are unavailable; live mode deliberately returns `404`.

For the underlying runtime diagnostic lifecycle, see
[HyperBricks troubleshooting](../../docs/TROUBLESHOOTING.md#find-the-reported-error)
and the [CLI render-diagnostics reference](../../docs/HYPERBRICKS_CLI.md#render-diagnostics).
