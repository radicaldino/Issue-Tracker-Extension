import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoRef } from './types.js';

const execFileAsync = promisify(execFile);

/** Parses https, ssh and scp-style GitHub remote URLs. Returns undefined for non-GitHub remotes. */
export function parseGitHubRemote(url: string): RepoRef | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { owner: match[1], repo: match[2] };
}

/** Finds the GitHub repository for a checkout, preferring the `origin` remote. */
export async function findGitHubRepo(cwd: string): Promise<RepoRef | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('git', ['remote', '-v'], { cwd }));
  } catch {
    return undefined; // not a git repository, or git is not installed
  }
  const remotes = stdout
    .split('\n')
    .map((line) => line.split(/\s+/))
    .filter((parts): parts is [string, string, ...string[]] => parts.length >= 2 && !!parts[0] && !!parts[1])
    .map(([name, url]) => ({ name, repo: parseGitHubRemote(url) }));
  const preferred = remotes.find((r) => r.name === 'origin' && r.repo) ?? remotes.find((r) => r.repo);
  return preferred?.repo;
}
