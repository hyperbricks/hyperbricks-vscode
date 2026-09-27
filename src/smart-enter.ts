import * as vscode from "vscode";

// A conservative lexical guard, not a YAML parser: uncertain/incomplete quoted
// or flow content stays with VS Code's normal Enter behavior.
export function canExitIndentation(lines: readonly string[], character: number): boolean {
  const current = lines.at(-1) ?? "";
  if (!/^[ \t]+$/.test(current) || character !== current.length) {
    return false;
  }
  let quote = "";
  const flow: string[] = [];
  let blockIndent: number | undefined;
  for (const line of lines.slice(0, -1)) {
    const indent = line.search(/\S/);
    if (blockIndent !== undefined) {
      if (indent < 0 || indent > blockIndent) {
        continue;
      }
      blockIndent = undefined;
    }
    let syntax = "";
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quote) {
        syntax += " ";
        if (quote === '"' && char === "\\") {
          i++;
        } else if (char === quote) {
          if (quote === "'" && line[i + 1] === "'") {
            i++;
          } else {
            quote = "";
          }
        }
        continue;
      }
      if (char === "#" && (i === 0 || /\s/.test(line.charAt(i - 1)))) {
        break;
      }
      const boundary = i === 0 || /[\s:[{,?\-]/.test(line.charAt(i - 1));
      if ((char === '"' || char === "'") && boundary) {
        quote = char;
        syntax += " ";
      } else {
        syntax += char;
        if ((char === "{" || char === "[") && boundary) {
          flow.push(char === "{" ? "}" : "]");
        } else if (char === "}" || char === "]") {
          if (flow.length && flow.pop() !== char) {
            return false;
          }
        }
      }
    }
    if (!quote && !flow.length && /(?:^|[:?\-])\s*[|>](?:[1-9][+-]?|[+-][1-9]?)?\s*$/.test(syntax)) {
      blockIndent = Math.max(0, indent);
    }
  }
  return !quote && flow.length === 0 && blockIndent === undefined;
}

export async function smartEnter(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === "hyperbricks-yaml" &&
      editor.selections.length === 1 && editor.selection.isEmpty &&
      vscode.workspace.getConfiguration("hyperbricks", editor.document.uri).get<boolean>("smartEnter", true)) {
    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line);
    if (/^[ \t]+$/.test(line.text) && position.character === line.text.length) {
      const lines = editor.document.getText(new vscode.Range(0, 0, position.line, line.text.length)).split(/\r?\n/);
      if (canExitIndentation(lines, position.character)) {
        // Use a literal edit: snippet insertion can adjust whitespace to the
        // surrounding indentation, which is precisely what we are leaving.
        const newline = editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
        const applied = await editor.edit(edit => edit.replace(line.range, newline));
        if (applied) {
          editor.selection = new vscode.Selection(position.line + 1, 0, position.line + 1, 0);
        }
        return;
      }
    }
  }
  await vscode.commands.executeCommand("type", { text: "\n" });
}
