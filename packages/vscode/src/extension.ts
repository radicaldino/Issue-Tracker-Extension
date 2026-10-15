import * as vscode from 'vscode';
import {
  ClaudeCodeProvider,
  GitHubIssueSource,
  findGitHubRepo,
  groupEditsByFile,
  type CodeLocation,
  type Effort,
  type Issue,
  type RepoRef,
} from '@issues-tracker/core';
import { AnalysisView, type AnalysisNode } from './analysisView';
import {
  clearAnthropicApiKey,
  clearGitHubToken,
  getAnthropicApiKey,
  getGitHubToken,
  promptForAnthropicApiKey,
  promptForGitHubToken,
} from './auth';
import { resolveClaudeExecutable } from './claudeExecutable';
import { EXPLANATION_SCHEME, ExplanationProvider } from './explanation';
import { LocationHighlights, lineRange } from './highlights';
import {
  PROPOSED_SCHEME,
  ProposedContentProvider,
  acceptFile,
  closeReviewTabs,
  declineFile,
  fileUri,
  parseProposedUri,
  reviewFile,
  type FileTarget,
} from './proposed';
import { AnalysisStore } from './store';
import { IssuesView } from './issuesView';

type ViewState = 'signedOut' | 'noRepo' | 'empty' | 'ready';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Issues Tracker', { log: true });
  const store = new AnalysisStore(context.workspaceState);
  const issuesView = new IssuesView(store);
  context.subscriptions.push(
    output,
    store,
    issuesView,
    vscode.window.registerTreeDataProvider('issuesTracker.issues', issuesView),
  );

  // v1 works against the first workspace folder.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let repo: RepoRef | undefined;
  let source: GitHubIssueSource | undefined;

  const setViewState = (state: ViewState) => vscode.commands.executeCommand('setContext', 'issuesTracker.state', state);

  async function refresh(interactive = false): Promise<void> {
    repo = root ? await findGitHubRepo(root) : undefined;
    if (!repo) {
      issuesView.setIssues([]);
      await setViewState('noRepo');
      return;
    }
    const token = await getGitHubToken(context.secrets, interactive);
    if (!token) {
      source = undefined;
      issuesView.setIssues([]);
      await setViewState('signedOut');
      return;
    }
    source = new GitHubIssueSource(token);
    const current = repo;
    await vscode.window.withProgress({ location: { viewId: 'issuesTracker.issues' } }, async () => {
      try {
        const issues = await source!.listAssigned(current);
        issuesView.setIssues(issues);
        await setViewState(issues.length ? 'ready' : 'empty');
        output.info(`Loaded ${issues.length} assigned issue(s) from ${current.owner}/${current.repo}`);
      } catch (err) {
        output.error(`Loading issues failed: ${message(err)}`);
        const status = (err as { status?: number }).status;
        if (status === 401) {
          await clearGitHubToken(context.secrets);
          await setViewState('signedOut');
        }
        void vscode.window.showErrorMessage(`Could not load issues from ${current.owner}/${current.repo}: ${message(err)}`);
      }
    });
  }

  if (!root) {
    void setViewState('noRepo');
    return;
  }

  const analysisView = new AnalysisView(store, root);
  const proposedProvider = new ProposedContentProvider(store, root);
  const explanationProvider = new ExplanationProvider(store);
  const highlights = new LocationHighlights(store, root);
  context.subscriptions.push(
    analysisView,
    proposedProvider,
    explanationProvider,
    highlights,
    vscode.window.registerTreeDataProvider('issuesTracker.analysis', analysisView),
    vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, proposedProvider),
    vscode.workspace.registerTextDocumentContentProvider(EXPLANATION_SCHEME, explanationProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, highlights),
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') void refresh();
    }),
  );

  async function analyze(issue: Issue): Promise<void> {
    if (store.get(issue.key)?.status === 'running') return;
    const cwd = root!;
    const config = vscode.workspace.getConfiguration('issuesTracker');
    const executablePath = resolveClaudeExecutable(config.get('claudeExecutablePath', ''));
    const provider = new ClaudeCodeProvider({
      model: config.get('model', 'claude-opus-5'),
      effort: config.get<Effort>('effort', 'high'),
      maxTurns: config.get('maxTurns', 40),
      maxBudgetUsd: config.get('maxBudgetUsd', 2),
      executablePath,
      apiKey: await getAnthropicApiKey(context.secrets),
    });

    await closeReviewTabs({ key: issue.key });
    store.set(issue.key, { status: 'running', issue });
    store.setActive(issue.key);
    output.info(`[#${issue.number}] Analyzing with ${provider.label} (${executablePath ?? 'bundled Claude Code'})`);

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Analyzing #${issue.number}`, cancellable: true },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        try {
          const comments = await source?.getComments(issue).catch((err: unknown) => {
            output.warn(`[#${issue.number}] Could not load comments: ${message(err)}`);
            return [];
          });
          const run = await provider.analyze(issue, {
            cwd,
            comments,
            signal: controller.signal,
            onProgress: (event) => {
              output.info(`[#${issue.number}] ${event.message}`);
              if (event.kind === 'tool') {
                progress.report({ message: event.message });
                store.setProgress(issue.key, event.message);
              }
            },
          });
          store.set(issue.key, { status: 'done', issue, run });
          output.info(
            `[#${issue.number}] Done in ${Math.round(run.durationMs / 1000)}s, ${run.turns} turns` +
              (run.costUsd !== undefined ? `, $${run.costUsd.toFixed(2)}` : ''),
          );

          const first = run.result.locations[0];
          if (first) await revealLocation(first);
          const files = groupEditsByFile(run.result.edits).size;
          const actions = files ? ['Review Changes', 'Show Explanation'] : ['Show Explanation'];
          const choice = await vscode.window.showInformationMessage(`#${issue.number}: ${run.result.summary}`, ...actions);
          if (choice === 'Show Explanation') await showExplanation();
          if (choice === 'Review Changes') {
            await reviewFile(store, cwd, { key: issue.key, file: run.result.edits[0]!.file });
          }
        } catch (err) {
          if (controller.signal.aborted) {
            store.delete(issue.key);
            output.info(`[#${issue.number}] Cancelled`);
            return;
          }
          output.error(`[#${issue.number}] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
          store.set(issue.key, { status: 'error', issue, message: message(err) });
          const choice = await vscode.window.showErrorMessage(`Analysis of #${issue.number} failed: ${message(err)}`, 'Show Log');
          if (choice === 'Show Log') output.show();
        }
      },
    );
  }

  async function revealLocation(location: CodeLocation): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(fileUri(root!, location.file));
    const range = lineRange(doc, location.startLine, location.endLine);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(range.start, range.start), preview: true });
    vscode.window.activeTextEditor?.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async function showExplanation(): Promise<void> {
    const state = store.active;
    if (state?.status !== 'done') return;
    await vscode.commands.executeCommand(
      'markdown.showPreviewToSide',
      ExplanationProvider.uriFor(state.issue.key, state.issue.number),
    );
  }

  /** Commands on proposed files arrive from the tree, the diff editor title, or CodeLens. */
  function toFileTarget(arg: unknown): FileTarget | undefined {
    if (arg instanceof vscode.Uri) return arg.scheme === PROPOSED_SCHEME ? parseProposedUri(arg) : undefined;
    const node = arg as Partial<AnalysisNode & FileTarget> | undefined;
    if (node && 'key' in node && 'file' in node && node.key && node.file) return { key: node.key, file: node.file };
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri?.scheme === PROPOSED_SCHEME ? parseProposedUri(uri) : undefined;
  }

  function pendingFiles(): FileTarget[] {
    const state = store.active;
    if (state?.status !== 'done') return [];
    return [...groupEditsByFile(state.run.result.edits).keys()].map((file) => ({ key: state.issue.key, file }));
  }

  const command = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(`issuesTracker.${id}`, fn));

  command('refresh', () => refresh());
  command('signIn', () => refresh(true));
  command('setGitHubToken', async () => {
    if (await promptForGitHubToken(context.secrets)) await refresh();
  });
  command('setAnthropicApiKey', () => promptForAnthropicApiKey(context.secrets));
  command('clearAnthropicApiKey', () => clearAnthropicApiKey(context.secrets));

  command('selectIssue', async (issue: Issue) => {
    store.setActive(issue.key);
    // Clicking an issue that has never been analyzed starts the analysis.
    if (!store.get(issue.key)) await analyze(issue);
  });
  command('analyze', (issue: Issue) => analyze(issue));
  command('openOnGitHub', (issue: Issue) => vscode.env.openExternal(vscode.Uri.parse(issue.url)));
  command('showExplanation', showExplanation);
  command('revealLocation', revealLocation);

  command('reviewFile', async (arg: unknown) => {
    const target = toFileTarget(arg);
    if (target) await reviewFile(store, root, target);
  });
  command('acceptFile', async (arg: unknown) => {
    const target = toFileTarget(arg);
    if (target) await acceptFile(store, root, target);
  });
  command('declineFile', async (arg: unknown) => {
    const target = toFileTarget(arg);
    if (target) await declineFile(store, target);
  });
  command('acceptAll', async () => {
    for (const target of pendingFiles()) {
      if (!(await acceptFile(store, root, target))) break;
    }
  });
  command('declineAll', async () => {
    const key = store.activeKey;
    if (!key) return;
    await closeReviewTabs({ key });
    store.removeEdits(key);
  });
  command('clearAnalysis', async () => {
    const key = store.activeKey;
    if (!key || store.get(key)?.status === 'running') return;
    await closeReviewTabs({ key });
    store.delete(key);
  });

  void refresh();
}

export function deactivate(): void {}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
