# VS Code YAML tokenizer fixtures

These files are unmodified copies of the YAML grammars bundled with VS Code
1.139.1 (`extensions/yaml/syntaxes/`). Their upstream source is
[RedCMD/YAML-Syntax-Highlighter](https://github.com/RedCMD/YAML-Syntax-Highlighter).
Each JSON file records its exact upstream commit in `version`.

The HyperBricks tokenizer tests load the full grammar dependency graph, including
the real document, mapping, scalar, comment, and flow rules. A simplified YAML
stub cannot reproduce their scanner states and must not replace these fixtures.
The extension itself uses the YAML grammar shipped with the user's VS Code.

To update, copy the complete grammar set from a supported VS Code installation,
preserve the upstream metadata and license, and run `npm run check`.
The fixtures are test-only and excluded from the VSIX.
