import * as vscode from 'vscode';

/**
 * Renders a `.md` file as a Notion-style WYSIWYG editor in a webview while the
 * plain Markdown file stays the source of truth.
 *
 * Sync model (the crux of the spike):
 *  - host → webview: on open and on external edits, push the full document text.
 *  - webview → host: on user edits, the webview serializes back to Markdown and
 *    sends the full text; the host writes it via a WorkspaceEdit.
 *  - echo guards on both sides (`writingBack` flag + last-sent compare) keep the
 *    write-back from bouncing and resetting the cursor.
 */
export class FormaEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'forma.markdownEditor';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      FormaEditorProvider.viewType,
      new FormaEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webview.html = this.html(webview);

    // True while we apply the webview's own edit, so the resulting change event
    // isn't echoed straight back to the webview.
    let writingBack = false;

    const push = (type: 'init' | 'update') => void webview.postMessage({ type, text: document.getText() });

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (writingBack) return;
      push('update');
    });

    const msgSub = webview.onDidReceiveMessage(async (msg: { type: string; text?: string }) => {
      if (msg.type === 'ready') {
        push('init');
        return;
      }
      if (msg.type === 'edit' && typeof msg.text === 'string') {
        if (msg.text === document.getText()) return;
        writingBack = true;
        try {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
          );
          edit.replace(document.uri, fullRange, msg.text);
          await vscode.workspace.applyEdit(edit);
        } finally {
          writingBack = false;
        }
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      msgSub.dispose();
    });
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${asset('editor.css')}" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${asset('webview.js')}"></script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
