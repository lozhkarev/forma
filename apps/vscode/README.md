# forma-vscode — spike

A VS Code extension spike: render a `.md` file as a Notion-style WYSIWYG editor
(the Forma TipTap stack) while the plain Markdown file stays the source of truth.

The point of this spike is to prove the **hardest part** — a stable, low-churn
round-trip between the ProseMirror document and the underlying `TextDocument`.
Everything else (graph, chat, board as webviews) is cheap once this holds.

## What it does

- Registers a `CustomTextEditorProvider` for `*.md` with `priority: "option"`,
  so it never hijacks Markdown — you opt in per file.
- Webview hosts React + TipTap + `tiptap-markdown` (same serializer as the web app).
- Leading YAML frontmatter is split off and preserved verbatim; only the body is
  edited and re-serialized.
- Bidirectional sync with echo guards: webview edits write back via `WorkspaceEdit`;
  external edits (git, another editor, an agent) push back into the webview.

## Run it

```bash
npm install              # from the repo root (workspaces)
npm run build -w forma-vscode
```

Then open this folder (`apps/vscode`) in VS Code and press **F5** (“Run Forma
Extension”). In the Extension Development Host:

1. Open any `.md` file.
2. Command Palette → **“Forma: Open Markdown as Notion-style editor”**
   (or right-click the tab → *Reopen Editor With…* → *Forma (Notion-style)*).

Edit in the rich view; save (`⌘S`) writes plain Markdown back to disk. Edit the
same file in a normal text editor (split right, *Reopen With… Text Editor*) and
watch changes flow both ways.

## Known spike limitations

- `tiptap-markdown` normalizes Markdown (bullet style, emphasis, spacing), so the
  first real edit may reformat untouched lines — this is the round-trip cost to
  evaluate here, not a bug.
- No wiki-link autocomplete / slash menu / backlinks yet (those are server- or
  data-coupled in the web app); easy follow-ups.
- `dev`/HMR is not wired — rebuild (`npm run build -w forma-vscode`) and reload
  the Extension Development Host window.
