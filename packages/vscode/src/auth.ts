import * as vscode from 'vscode';

const GITHUB_PAT_SECRET = 'issuesTracker.githubToken';
const ANTHROPIC_KEY_SECRET = 'issuesTracker.anthropicApiKey';

/**
 * A personal access token, if the user stored one, wins over VS Code's GitHub
 * sign-in. The PAT path exists for editors without the built-in GitHub
 * authentication provider (VSCodium and some forks).
 */
export async function getGitHubToken(secrets: vscode.SecretStorage, interactive: boolean): Promise<string | undefined> {
  const pat = await secrets.get(GITHUB_PAT_SECRET);
  if (pat) return pat;
  try {
    const session = await vscode.authentication.getSession(
      'github',
      ['repo'],
      interactive ? { createIfNone: true } : { silent: true },
    );
    return session?.accessToken;
  } catch {
    return undefined; // user cancelled, or no GitHub auth provider in this editor
  }
}

export async function promptForGitHubToken(secrets: vscode.SecretStorage): Promise<boolean> {
  const token = await vscode.window.showInputBox({
    title: 'GitHub Personal Access Token',
    prompt: 'Needs read access to issues (classic: "repo" scope; fine-grained: Issues read-only).',
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) return false;
  await secrets.store(GITHUB_PAT_SECRET, token.trim());
  return true;
}

export async function clearGitHubToken(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(GITHUB_PAT_SECRET);
}

export function getAnthropicApiKey(secrets: vscode.SecretStorage): Thenable<string | undefined> {
  return secrets.get(ANTHROPIC_KEY_SECRET);
}

export async function promptForAnthropicApiKey(secrets: vscode.SecretStorage): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'Anthropic API Key',
    prompt: 'Used for issue analysis. Leave unset to use whatever credentials Claude Code already has.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key) await secrets.store(ANTHROPIC_KEY_SECRET, key.trim());
}

export async function clearAnthropicApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(ANTHROPIC_KEY_SECRET);
}
