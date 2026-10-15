import * as path from 'node:path';
import * as vscode from 'vscode';
import { groupEditsByFile, type CodeLocation, type ProposedEdit } from '@issues-tracker/core';
import { fileUri } from './proposed';
import type { AnalysisStore } from './store';

export type AnalysisNode =
  | { kind: 'header' }
  | { kind: 'message'; label: string; icon: string; tooltip?: string }
  | { kind: 'locations'; locations: CodeLocation[] }
  | { kind: 'location'; location: CodeLocation }
  | { kind: 'files'; key: string; byFile: Map<string, ProposedEdit[]> }
  | { kind: 'file'; key: string; file: string; edits: ProposedEdit[] };

/** Shows the selected issue's analysis: summary, relevant locations and proposed per-file changes. */
export class AnalysisView implements vscode.TreeDataProvider<AnalysisNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly store: AnalysisStore,
    private readonly root: string,
  ) {
    this.subscription = store.onDidChange(() => this.emitter.fire());
  }

  getChildren(node?: AnalysisNode): AnalysisNode[] {
    const state = this.store.active;
    if (!state) return [];

    if (!node) {
      switch (state.status) {
        case 'running':
          return [{ kind: 'header' }, { kind: 'message', label: state.progress ?? 'Starting…', icon: 'loading~spin' }];
        case 'error':
          return [
            { kind: 'header' },
            { kind: 'message', label: state.message, icon: 'error', tooltip: state.message },
            { kind: 'message', label: 'Use the sparkle button on the issue to try again.', icon: 'info' },
          ];
        case 'done': {
          const { locations, edits } = state.run.result;
          const children: AnalysisNode[] = [{ kind: 'header' }];
          if (locations.length) children.push({ kind: 'locations', locations });
          if (edits.length) children.push({ kind: 'files', key: state.issue.key, byFile: groupEditsByFile(edits) });
          else children.push({ kind: 'message', label: 'No pending code changes', icon: 'info' });
          return children;
        }
      }
    }

    switch (node.kind) {
      case 'locations':
        return node.locations.map((location) => ({ kind: 'location', location }));
      case 'files':
        return [...node.byFile].map(([file, edits]) => ({ kind: 'file', key: node.key, file, edits }));
      default:
        return [];
    }
  }

  getTreeItem(node: AnalysisNode): vscode.TreeItem {
    const state = this.store.active;
    const None = vscode.TreeItemCollapsibleState.None;
    const Expanded = vscode.TreeItemCollapsibleState.Expanded;

    switch (node.kind) {
      case 'header': {
        const issue = state!.issue;
        const item = new vscode.TreeItem(`#${issue.number} ${issue.title}`, None);
        item.iconPath = new vscode.ThemeIcon('issues');
        item.contextValue = 'header';
        if (state?.status === 'done') {
          const { result, costUsd } = state.run;
          item.description = [`${result.confidence} confidence`, costUsd !== undefined ? `$${costUsd.toFixed(2)}` : '']
            .filter(Boolean)
            .join(' · ');
          item.tooltip = new vscode.MarkdownString().appendText(result.summary);
          item.command = { command: 'issuesTracker.showExplanation', title: 'Show Explanation' };
        }
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(node.label, None);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.tooltip = node.tooltip;
        return item;
      }
      case 'locations': {
        const item = new vscode.TreeItem('Where to look', Expanded);
        item.description = `${node.locations.length}`;
        return item;
      }
      case 'location': {
        const { file, startLine, endLine, reason } = node.location;
        const lines = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
        const item = new vscode.TreeItem(`${path.basename(file)}:${lines}`, None);
        item.description = reason;
        item.tooltip = `${file}:${lines}\n${reason}`;
        item.resourceUri = fileUri(this.root, file);
        item.iconPath = vscode.ThemeIcon.File;
        item.command = { command: 'issuesTracker.revealLocation', title: 'Go to Location', arguments: [node.location] };
        return item;
      }
      case 'files': {
        const item = new vscode.TreeItem('Proposed changes', Expanded);
        item.description = `${node.byFile.size} file${node.byFile.size === 1 ? '' : 's'}`;
        return item;
      }
      case 'file': {
        const item = new vscode.TreeItem(path.basename(node.file), None);
        const dir = path.dirname(node.file);
        item.description = `${dir === '.' ? '' : `${dir} · `}${node.edits.length} edit${node.edits.length === 1 ? '' : 's'}`;
        item.tooltip = node.edits.map((e) => `• ${e.description}`).join('\n');
        item.resourceUri = fileUri(this.root, node.file);
        item.iconPath = vscode.ThemeIcon.File;
        item.contextValue = 'proposedFile';
        item.command = {
          command: 'issuesTracker.reviewFile',
          title: 'Review Proposed Change',
          arguments: [{ key: node.key, file: node.file }],
        };
        return item;
      }
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
