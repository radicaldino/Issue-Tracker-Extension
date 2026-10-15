import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Chooses the Claude Code binary for the Agent SDK to run:
 * 1. the `issuesTracker.claudeExecutablePath` setting, if set;
 * 2. the SDK's bundled platform binary (returns undefined so the SDK uses it);
 * 3. a `claude` already installed on this machine.
 *
 * The bundled binary is an optional dependency, and npm skips it silently if
 * its download fails, so the fallback matters.
 */
export function resolveClaudeExecutable(setting: string): string | undefined {
  if (setting) return setting;
  if (hasBundledBinary()) return undefined;
  return findInstalledClaude();
}

function hasBundledBinary(): boolean {
  try {
    require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function findInstalledClaude(): string | undefined {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  // Editors launched from a desktop shortcut often lack ~/.local/bin on PATH, so check the installer's defaults too.
  const dirs = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
  ];
  for (const dir of dirs.filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
