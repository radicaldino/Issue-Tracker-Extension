import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvalidAnalysisError, parseAnalysisResult } from './analysis.js';
import { parseGitHubRemote } from './git.js';

const root = '/work/repo';

test('normalizes paths and drops ones outside the workspace', () => {
  const { result, dropped } = parseAnalysisResult(
    {
      summary: 's',
      explanation: 'e',
      confidence: 'high',
      locations: [
        { file: './src/a.ts', startLine: 3, endLine: 1, reason: 'r' },
        { file: '/work/repo/src/b.ts', startLine: 1, endLine: 2, reason: 'r' },
        { file: '../other/c.ts', startLine: 1, endLine: 1, reason: 'r' },
      ],
      edits: [{ file: '/etc/passwd', search: 'a', replace: 'b', description: 'd' }],
    },
    root,
  );
  assert.deepEqual(
    result.locations.map((l) => [l.file, l.startLine, l.endLine]),
    [
      ['src/a.ts', 3, 3],
      ['src/b.ts', 1, 2],
    ],
  );
  assert.equal(result.edits.length, 0);
  assert.equal(dropped.length, 2);
});

test('rejects malformed output', () => {
  assert.throws(() => parseAnalysisResult(null, root), InvalidAnalysisError);
  assert.throws(
    () => parseAnalysisResult({ summary: 's', explanation: 'e', confidence: 'sure', locations: [], edits: [] }, root),
    /confidence/,
  );
});

test('parses GitHub remotes', () => {
  const expected = { owner: 'octo', repo: 'hello-world' };
  assert.deepEqual(parseGitHubRemote('git@github.com:octo/hello-world.git'), expected);
  assert.deepEqual(parseGitHubRemote('https://github.com/octo/hello-world'), expected);
  assert.deepEqual(parseGitHubRemote('https://token@github.com/octo/hello-world.git/'), expected);
  assert.deepEqual(parseGitHubRemote('ssh://git@github.com/octo/hello-world.git'), expected);
  assert.equal(parseGitHubRemote('git@gitlab.com:octo/hello-world.git'), undefined);
});
