import { Octokit } from '@octokit/rest';
import type { Issue, IssueComment, IssueSource, RepoRef } from './types.js';

export class GitHubIssueSource implements IssueSource {
  private readonly octokit: Octokit;
  private login: string | undefined;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token, userAgent: 'issues-tracker' });
  }

  async getLogin(): Promise<string> {
    this.login ??= (await this.octokit.rest.users.getAuthenticated()).data.login;
    return this.login;
  }

  async listAssigned(repo: RepoRef): Promise<Issue[]> {
    const assignee = await this.getLogin();
    const items = await this.octokit.paginate(this.octokit.rest.issues.listForRepo, {
      owner: repo.owner,
      repo: repo.repo,
      assignee,
      state: 'open',
      sort: 'updated',
      per_page: 100,
    });
    // The issues endpoint also returns pull requests.
    return items
      .filter((item) => !item.pull_request)
      .map((item) => ({
        key: issueKey(repo, item.number),
        source: 'github',
        repo,
        number: item.number,
        title: item.title,
        body: item.body ?? '',
        url: item.html_url,
        labels: item.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
        author: item.user?.login ?? 'unknown',
        updatedAt: item.updated_at,
      }));
  }

  async getComments(issue: Issue): Promise<IssueComment[]> {
    const { data } = await this.octokit.rest.issues.listComments({
      owner: issue.repo.owner,
      repo: issue.repo.repo,
      issue_number: issue.number,
      per_page: 50,
    });
    return data.map((c) => ({
      author: c.user?.login ?? 'unknown',
      body: c.body ?? '',
      createdAt: c.created_at,
    }));
  }
}

export function issueKey(repo: RepoRef, number: number): string {
  return `github:${repo.owner}/${repo.repo}#${number}`;
}
