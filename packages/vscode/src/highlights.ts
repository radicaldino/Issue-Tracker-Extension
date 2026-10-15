import * as vscode from 'vscode';
import { normalizePath } from '@issues-tracker/core';
import type { AnalysisStore } from './store';

/**
 * Marks the active analysis's code locations in open editors (line highlight +
 * overview ruler) and adds CodeLens above them and above proposed edits.
 */
export class LocationHighlights implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly store: AnalysisStore,
    private readonly root: string,
  ) {
    this.subscriptions = [
      store.onDidChange(() => {
        this.decorate();
        this.emitter.fire();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()),
    ];
    this.decorate();
  }

  private decorate(): void {
    const active = this.store.active;
    for (const editor of vscode.window.visibleTextEditors) {
      const file = this.relative(editor.document);
      const decorations =
        active?.status === 'done' && file
          ? active.run.result.locations
              .filter((loc) => loc.file === file)
              .map((loc) => ({
                range: lineRange(editor.document, loc.startLine, loc.endLine),
                hoverMessage: new vscode.MarkdownString(`**#${active.issue.number}** `).appendText(loc.reason),
              }))
          : [];
      editor.setDecorations(this.decoration, decorations);
    }
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const active = this.store.active;
    const file = this.relative(document);
    if (active?.status !== 'done' || !file) return [];

    const lenses: vscode.CodeLens[] = [];
    for (const loc of active.run.result.locations.filter((l) => l.file === file)) {
      lenses.push(
        new vscode.CodeLens(lineRange(document, loc.startLine, loc.startLine), {
          title: `$(issues) #${active.issue.number}: ${loc.reason}`,
          command: 'issuesTracker.showExplanation',
        }),
      );
    }

    const edits = active.run.result.edits.filter((e) => e.file === file);
    if (edits.length) {
      // Anchor the review actions at the first edit that still matches the file.
      const text = document.getText();
      const offset = edits.map((e) => text.indexOf(e.search)).find((i) => i >= 0) ?? 0;
      const anchor = new vscode.Range(document.positionAt(offset), document.positionAt(offset));
      const target = { key: active.issue.key, file };
      lenses.push(
        new vscode.CodeLens(anchor, { title: '$(diff) Review proposed change', command: 'issuesTracker.reviewFile', arguments: [target] }),
        new vscode.CodeLens(anchor, { title: '$(check) Accept', command: 'issuesTracker.acceptFile', arguments: [target] }),
        new vscode.CodeLens(anchor, { title: '$(close) Decline', command: 'issuesTracker.declineFile', arguments: [target] }),
      );
    }
    return lenses;
  }

  private relative(document: vscode.TextDocument): string | undefined {
    return document.uri.scheme === 'file' ? normalizePath(document.uri.fsPath, this.root) : undefined;
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.decoration.dispose();
    this.emitter.dispose();
  }
}

/** Range covering 1-based inclusive lines, clamped to the document. */
export function lineRange(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const last = document.lineCount - 1;
  const start = Math.min(Math.max(startLine - 1, 0), last);
  const end = Math.min(Math.max(endLine - 1, start), last);
  return new vscode.Range(start, 0, end, document.lineAt(end).range.end.character);
}
