# Changelog

## 0.1.0

- Add configurable smart Enter: an indentation-only line exits to column 0,
  preserving normal editing inside multiline strings and unfinished collections.

- Use VS Code's complete YAML grammar for comments, quote escapes, block scalars,
  and nested flow mappings, with HyperBricks styling scoped to real YAML tokens.
  Test against the actual bundled YAML grammars and protect unfinished template
  expressions from consuming subsequent comments.
- Derive completion context from the YAML tree, including nested schema fields,
  inherited child overlays, boolean values, and block/flow resolver options.
- Complete imports, source variable names, selected configuration paths, and
  local resource files; apply explicit scalar edits with valid quoting that
  preserve flow delimiters and comments without duplicating path prefixes.
- Explain resolver keys and options on hover, and navigate variable/configuration
  declarations and static resource or template paths without displaying resolved
  secrets in hover or completion.
- Preserve materializer resolver diagnostics and report a missing colon before
  a flow resolver at the component field that needs it.
- Register the HyperBricks YAML language and TextMate grammar.
- Give the language and grammar conflict-free identifiers and verify emitted
  highlighting scopes with the TextMate tokenizer.
- Add schema-aware semantic highlighting that keeps reserved words prominent,
  lightly distinguishes component fields, and leaves ordinary nested YAML data
  under normal YAML highlighting.
- Trigger value completion after the required YAML `: ` separator and suppress
  suggestions that would preserve malformed no-space values such as `type:hy`.
- Trigger type-aware field and child completion after `- ` at the owning
  component indentation without activating inside ordinary nested data lists.
- Start the protocol-v1 HyperBricks language server over stdio.
- Select the active file's owning module automatically so imported inheritance
  is analyzed correctly from a repository-root workspace.
- Add Go to Definition for imports, inheritance targets, templates, and local
  resource paths, with complete clickable relation ranges and effective
  inherited-child provenance.
- Add context-aware dotted `inherit` completion that follows imported,
  effective component children without treating ordinary `values` mappings as
  inheritance paths.
- Clear corrected static and runtime Problems reliably by publishing the LSP
  replacement empty diagnostic set.
- Add runtime diagnostic controls and status-bar feedback.
- Add commands for server restart, HyperBricks Doctor, runtime Errors, and
  extension output.
