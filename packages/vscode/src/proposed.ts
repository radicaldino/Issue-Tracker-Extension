import * as path from 'node:path';
import * as vscode from 'vscode';
import { EditError, applyEdits, minimalReplacement } from '@issues-tracker/core';
import type { AnalysisStore } from './store';

export const PROPOSED_SCHEME = 'issues-tracker-proposed';

/** Identifies one file's proposed change within one issue's analysis. */
export interface FileTarget {
  key: string;
  file: string;
}

export function proposedUri({ key, file }: FileTarget): vscode.Uri {
  return vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: `/${file}`, query: encodeURIComponent(key) });
}

export function parseProposedUri(uri: vscode.Uri): FileTarget {
  return { key: decodeURIComponent(uri.query), file: uri.path.slice(1) };
}

/**
 * Serves "the file as it would look after the proposed edits", computed from
 * the file's current contents (including unsaved changes). This is the right
 * side of the review diff.
 */
export class ProposedContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly store: AnalysisStore,
    private readonly root: string,
  ) {
    this.subscriptions = [
      store.onDidChange(() => this.refreshOpen()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.scheme === 'file') this.refreshOpen();
      }),
    ];
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const target = parseProposedUri(uri);
    const original = await vscode.workspace.openTextDocument(fileUri(this.root, target.file));
    try {
      return applyEdits(original.getText(), this.store.editsFor(target.key, target.file));
    } catch {
      // Show the unmodified file rather than failing to open; accept will report the error.
      return original.getText();
    }
  }

  private refreshOpen(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === PROPOSED_SCHEME) this.emitter.fire(doc.uri);
    }
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}

export function fileUri(root: string, file: string): vscode.Uri {
  return vscode.Uri.file(path.join(root, file));
}

export async function reviewFile(store: AnalysisStore, root: string, target: FileTarget): Promise<void> {
  const original = fileUri(root, target.file);
  const doc = await vscode.workspace.openTextDocument(original);
  try {
    applyEdits(doc.getText(), store.editsFor(target.key, target.file));
  } catch (err) {
    await reportEditError(err, root, target);
    return;
  }
  const state = store.get(target.key);
  const title = `${path.basename(target.file)} ↔ proposed fix${state ? ` for #${state.issue.number}` : ''}`;
  await vscode.commands.executeCommand('vscode.diff', original, proposedUri(target), title, { preview: true });
}

/** Applies one file's proposed edits to the real document. Leaves it unsaved so the user can review or undo. */
export async function acceptFile(store: AnalysisStore, root: string, target: FileTarget): Promise<boolean> {
  const edits = store.editsFor(target.key, target.file);
  if (edits.length === 0) return true;

  const doc = await vscode.workspace.openTextDocument(fileUri(root, target.file));
  const before = doc.getText();
  let after: string;
  try {
    after = applyEdits(before, edits);
  } catch (err) {
    await reportEditError(err, root, target);
    return false;
  }

  const change = minimalReplacement(before, after);
  const range = new vscode.Range(doc.positionAt(change.start), doc.positionAt(change.end));
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(doc.uri, range, change.text);
  if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
    void vscode.window.showErrorMessage(`Could not apply the proposed change to ${target.file}.`);
    return false;
  }

  await closeReviewTabs(target);
  store.removeEdits(target.key, target.file);
  const changed = new vscode.Range(doc.positionAt(change.start), doc.positionAt(change.start + change.text.length));
  await vscode.window.showTextDocument(doc, { selection: changed, preview: false });
  return true;
}

export async function declineFile(store: AnalysisStore, target: FileTarget): Promise<void> {
  await closeReviewTabs(target);
  store.removeEdits(target.key, target.file);
}

/** Closes review diffs for one file, or for every file of the issue when `file` is omitted. */
export async function closeReviewTabs({ key, file }: { key: string; file?: string }): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => {
      if (!(tab.input instanceof vscode.TabInputTextDiff) || tab.input.modified.scheme !== PROPOSED_SCHEME) return false;
      const target = parseProposedUri(tab.input.modified);
      return target.key === key && (file === undefined || target.file === file);
    }),
  );
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

async function reportEditError(err: unknown, root: string, target: FileTarget): Promise<void> {
  if (!(err instanceof EditError)) throw err;
  const choice = await vscode.window.showErrorMessage(
    `Proposed change to ${target.file} no longer applies. ${err.message}`,
    'Open File',
  );
  if (choice === 'Open File') await vscode.commands.executeCommand('vscode.open', fileUri(root, target.file));
}
