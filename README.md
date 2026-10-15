# Issues Tracker

Go from "issue assigned to me" to "I know where to fix it": a VS Code extension that lists your assigned GitHub issues, runs a read-only Claude agent over the open workspace, highlights the relevant code, and proposes a patch you accept or decline in a diff view.

## Layout

```
packages/
  core/     Editor-agnostic logic. Must never import `vscode`, so a GitHub Action or
            webhook server can reuse it for automation later.
    src/types.ts          Issue, IssueSource, AgentProvider, AnalysisResult
    src/github.ts         GitHub issue source (Octokit)
    src/git.ts            Detect the GitHub repo from git remotes
    src/agents/claude.ts  Claude Agent SDK provider (Read/Grep/Glob only, JSON-schema output)
    src/analysis.ts       Output schema, validation, path normalization
    src/edits.ts          Search/replace application, minimal-range diffing
  vscode/   Thin VS Code client: tree views, highlights/CodeLens, review diff, accept/decline.
```

## How an analysis works

1. Clicking an issue that has not been analyzed starts an analysis (the sparkle button re-runs it).
2. The Claude Agent SDK runs Claude Code in the workspace with only `Read`, `Grep` and `Glob`. It cannot modify files.
3. Claude returns JSON matching `ANALYSIS_SCHEMA`: summary, explanation, confidence, locations, and search/replace edits.
4. The extension validates the result, drops any path outside the workspace, highlights the locations, and adds CodeLens.
5. Proposed edits are applied to a virtual copy of each file and shown with `vscode.diff`. **Accept** applies a minimal `WorkspaceEdit` to the real file, left unsaved so you can review or undo it. **Decline** drops the proposal.

## Develop

```sh
npm install
npm test          # core unit tests
npm run typecheck
```

Open this folder in VS Code and press **F5**. In the Extension Development Host, open a repository with a GitHub remote, then use the Issues Tracker icon in the activity bar.

### Auth

- **GitHub:** VS Code's built-in GitHub sign-in (`repo` scope). In editors without it, use *Issues Tracker: Use a GitHub Personal Access Token*.
- **Claude:** *Issues Tracker: Set Anthropic API Key* stores a key in VS Code's secret storage. Without a key, Claude Code uses whatever credentials it already has (an `ANTHROPIC_API_KEY` in the environment, or your own Claude Code login). For anything you distribute, use API keys; claude.ai login is not permitted for third-party products.

### Settings

| Setting | Default | |
|---|---|---|
| `issuesTracker.model` | `claude-opus-5` | Model used for analysis |
| `issuesTracker.effort` | `high` | `low` … `max` |
| `issuesTracker.maxTurns` | `40` | Agent turn limit |
| `issuesTracker.maxBudgetUsd` | `2` | Cost cap per analysis |
| `issuesTracker.claudeExecutablePath` | *(bundled)* | Use a specific `claude` binary instead of the SDK's |

## Roadmap

- **Step 3:** `AgentProvider` adapters for Codex CLI, Aider, and Copilot (via GitHub assignment). Normalize the result to a diff plus optional locations by running each agent in an isolated git worktree.
- **Step 4:** Automation in `packages/action` or `packages/server`: an `auto-fix` label trigger, a worktree per issue, tests before any proposal, draft PRs only, per-issue cost caps.
- **Step 5:** Publish to the VS Code Marketplace and Open VSX. Add Jira and GitLab `IssueSource`s. Packaging needs the SDK's platform binary shipped per target (`vsce package --target`).
