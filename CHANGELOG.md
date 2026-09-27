# Changelog

## 0.1.0

- Register the HyperBricks YAML language and TextMate grammar.
- Give the language and grammar conflict-free identifiers and verify emitted
  highlighting scopes with the TextMate tokenizer.
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
