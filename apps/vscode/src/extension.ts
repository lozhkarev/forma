import * as vscode from 'vscode';
import { FormaEditorProvider } from './formaEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(FormaEditorProvider.register(context));

  // "Open as Notion-style editor" — opens the active (or given) .md in our editor.
  context.subscriptions.push(
    vscode.commands.registerCommand('forma.openWith', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showInformationMessage('Open a Markdown file first.');
        return;
      }
      void vscode.commands.executeCommand('vscode.openWith', target, FormaEditorProvider.viewType);
    }),
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}
