import * as vscode from 'vscode';
import type { AnalysisStore } from './store';

const EXPLANATION_SCHEME = 'issues-tracker-explanation';

/** Renders an analysis as a read-only Markdown document for the built-in preview. */
export class ExplanationProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: AnalysisStore) {
    this.subscription = store.onDidChange(() => {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === EXPLANATION_SCHEME) this.emitter.fire(doc.uri);
      }
    });
  }

  static uriFor(key: string, number: number): vscode.Uri {
    return vscode.Uri.from({ scheme: EXPLANATION_SCHEME, path: `/issue-${number}.md`, query: encodeURIComponent(key) });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const state = this.store.get(decodeURIComponent(uri.query));
    if (state?.status !== 'done') return 'This analysis is no longer available.';

    const { issue, run } = state;
    const { result } = run;
    const meta = [
      `[Open on GitHub](${issue.url})`,
      `${result.confidence} confidence`,
      run.costUsd !== undefined ? `$${run.costUsd.toFixed(2)}` : undefined,
      `${Math.round(run.durationMs / 1000)}s`,
      `${run.turns} turns`,
    ].filter(Boolean);

    const lines = [
      `# #${issue.number} ${issue.title}`,
      '',
      meta.join(' · '),
      '',
      '## Summary',
      '',
      result.summary,
      '',
      '## Explanation',
      '',
      result.explanation,
    ];
    if (result.locations.length) {
      lines.push('', '## Where to look', '');
      for (const l of result.locations) lines.push(`- \`${l.file}:${l.startLine}-${l.endLine}\`: ${l.reason}`);
    }
    if (result.edits.length) {
      lines.push('', '## Pending proposed edits', '');
      for (const e of result.edits) lines.push(`- \`${e.file}\`: ${e.description}`);
    }
    return lines.join('\n');
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

export { EXPLANATION_SCHEME };
