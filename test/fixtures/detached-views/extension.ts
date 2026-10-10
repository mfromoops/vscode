/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.window.registerTreeDataProvider<vscode.TreeItem>('detachedFixture.tree', {
		getTreeItem: element => element,
		getChildren: () => [new vscode.TreeItem('One live extension tree')]
	}));
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('detachedFixture.webview', {
		resolveWebviewView(view) {
			view.webview.options = { enableScripts: true };
			view.webview.html = `<!doctype html><html><body>
				<label>Draft <input id="draft" aria-label="Fixture draft"></label>
				<script>
					const vscode = acquireVsCodeApi();
					const input = document.getElementById('draft');
					input.value = vscode.getState()?.draft || '';
					input.addEventListener('input', () => vscode.setState({ draft: input.value }));
				</script></body></html>`;
		}
	}));
}
