import * as vscode from 'vscode';
import type { AnalysisRun, Issue, ProposedEdit } from '@issues-tracker/core';

export type AnalysisState =
  | { status: 'running'; issue: Issue; progress?: string }
  | { status: 'done'; issue: Issue; run: AnalysisRun }
  | { status: 'error'; issue: Issue; message: string };

export type DoneState = Extract<AnalysisState, { status: 'done' }>;

const MEMENTO_KEY = 'issuesTracker.analyses';

/** Analysis state per issue. Finished analyses survive reloads via workspaceState. */
export class AnalysisStore implements vscode.Disposable {
  private readonly states = new Map<string, AnalysisState>();
  private currentKey: string | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly memento: vscode.Memento) {
    for (const state of memento.get<DoneState[]>(MEMENTO_KEY, [])) {
      this.states.set(state.issue.key, state);
    }
  }

  get(key: string): AnalysisState | undefined {
    return this.states.get(key);
  }

  get activeKey(): string | undefined {
    return this.currentKey;
  }

  get active(): AnalysisState | undefined {
    return this.currentKey ? this.states.get(this.currentKey) : undefined;
  }

  setActive(key: string | undefined): void {
    this.currentKey = key;
    this.changed();
  }

  set(key: string, state: AnalysisState): void {
    this.states.set(key, state);
    this.changed();
  }

  setProgress(key: string, progress: string): void {
    const state = this.states.get(key);
    if (state?.status === 'running') this.set(key, { ...state, progress });
  }

  delete(key: string): void {
    this.states.delete(key);
    if (this.currentKey === key) this.currentKey = undefined;
    this.changed();
  }

  editsFor(key: string, file: string): ProposedEdit[] {
    const state = this.states.get(key);
    return state?.status === 'done' ? state.run.result.edits.filter((e) => e.file === file) : [];
  }

  /** Drops proposed edits for one file, or for every file when `file` is omitted. */
  removeEdits(key: string, file?: string): void {
    const state = this.states.get(key);
    if (state?.status !== 'done') return;
    const edits = file === undefined ? [] : state.run.result.edits.filter((e) => e.file !== file);
    this.set(key, { ...state, run: { ...state.run, result: { ...state.run.result, edits } } });
  }

  private changed(): void {
    const done = [...this.states.values()].filter((s): s is DoneState => s.status === 'done');
    void this.memento.update(MEMENTO_KEY, done);
    const active = this.active;
    void vscode.commands.executeCommand(
      'setContext',
      'issuesTracker.hasProposedEdits',
      active?.status === 'done' && active.run.result.edits.length > 0,
    );
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
