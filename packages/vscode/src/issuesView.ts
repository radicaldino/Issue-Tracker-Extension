import * as vscode from 'vscode';
import type { Issue } from '@issues-tracker/core';
import type { AnalysisStore } from './store';

export class IssuesView implements vscode.TreeDataProvider<Issue>, vscode.Disposable {
  private issues: Issue[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: AnalysisStore) {
    this.subscription = store.onDidChange(() => this.emitter.fire());
  }

  setIssues(issues: Issue[]): void {
    this.issues = issues;
    this.emitter.fire();
  }

  getChildren(element?: Issue): Issue[] {
    return element ? [] : this.issues;
  }

  getTreeItem(issue: Issue): vscode.TreeItem {
    const state = this.store.get(issue.key);
    const item = new vscode.TreeItem(`#${issue.number} ${issue.title}`);
    item.id = issue.key;
    item.description = issue.labels.join(', ');
    item.contextValue = `issue.${state?.status ?? 'new'}`;
    item.command = { command: 'issuesTracker.selectIssue', title: 'Show Analysis', arguments: [issue] };

    const tooltip = new vscode.MarkdownString(`**#${issue.number} ${escape(issue.title)}**\n\n`);
    tooltip.appendText(truncate(issue.body, 800) || '(no description)');
    item.tooltip = tooltip;

    switch (state?.status) {
      case 'running':
        item.iconPath = new vscode.ThemeIcon('loading~spin');
        break;
      case 'done':
        item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        break;
      case 'error':
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        break;
      default:
        item.iconPath = new vscode.ThemeIcon('issues');
    }
    return item;
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
