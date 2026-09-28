# Changelog

All notable changes to the HyperBricks Visual Studio Code extension are recorded
here.

## 0.1.0

Initial preview release. Install the extension from a VSIX and use it with a
HyperBricks executable from the same revision. The extension requires
HyperBricks editor protocol version 1.

### Language support

- Register `*.hyperbricks.yaml` as **HyperBricks YAML** and start the matching
  HyperBricks language server over stdio.
- Combine VS Code's complete YAML grammar with schema-aware semantic tokens for
  reserved words, component declarations, native types, inheritance targets,
  and component fields while leaving ordinary YAML data unstyled.
- Report YAML, native-schema, required-field, import, inheritance,
  configuration, resource, and resolver diagnostics in the Problems panel.
- Complete native types, effective fields and children, nested schema values,
  booleans, resolvers, imports, variables, configuration paths, local files, and
  dotted inheritance paths from the YAML structure at the cursor.
- Add hover help for native fields and resolvers without exposing resolved
  environment values, configuration values, secrets, or file contents.
- Add Go to Definition for imports, inheritance targets, variables,
  configuration declarations, templates, and safe local resource paths.
- Format complete documents while preserving component order, mapping order,
  comments, scalar styles, and parsed meaning.
- Add configurable Smart Enter behavior for leaving an indented component block
  without changing multiline strings, unfinished collections, snippets, or
  completion interactions.

### Project and runtime integration

- Select the package that owns the active HyperBricks file, support explicit
  module selection, and restart the client when the active project changes.
- Keep unsaved source in the language-server overlay so static feedback,
  completion, hover, and navigation follow the editor buffer.
- Add authenticated development/debug runtime diagnostics, checked-route
  coverage, status-bar feedback, safe source mapping, and reliable clearing of
  corrected static and runtime Problems.
- Add commands to restart the language server, connect or disconnect runtime
  diagnostics, run HyperBricks Doctor, open runtime Errors, and show extension
  output.

### Safety and compatibility

- Use the HyperBricks runtime parser and schema registry as the single source of
  truth instead of shipping a separate component schema in the extension.
- Reject incompatible editor-protocol versions and unsafe runtime URL settings.
- Limit automatic credential use to local loopback runtimes; remote credentials
  are not accepted by protocol version 1.
- Keep navigation and file completion inside the selected module and avoid
  inventing fields for ordinary data or plugin schemas unavailable to the
  protocol.

### Development and documentation

- Add contract, module-selection, Smart Enter, and grammar-tokenization tests,
  including the complete vendored VS Code YAML grammar fixtures.
- Provide the complete extension check through `npm run check`.
- Consolidate installation, settings, commands, runtime feedback, and
  troubleshooting in `README.md`, with contributor setup, architecture, tests,
  and VSIX packaging in `DEVELOPMENT.md`.
