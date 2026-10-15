// Builds an installable .vsix.
//
// The extension bundle inlines @issues-tracker/core, but the Agent SDK stays
// external (see esbuild.mjs), so it has to ship in node_modules inside the
// .vsix. vsce cannot make sense of this npm workspace's hoisted node_modules,
// so we stage a self-contained copy of the extension and package that instead.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const extDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootDir = path.resolve(extDir, '../..');
const stageDir = path.join(extDir, '.stage');

/** Packages loaded at runtime rather than bundled. zod is a peer dependency of the SDK. */
const RUNTIME_PACKAGES = ['@anthropic-ai/claude-agent-sdk', 'zod'];

const requireFromCore = createRequire(path.join(rootDir, 'packages/core/package.json'));

/** Walks up from a package's entry point to the directory holding its package.json. */
function packageRoot(name) {
  let dir = path.dirname(requireFromCore.resolve(name));
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find the install directory of ${name}`);
}

execFileSync(process.execPath, ['esbuild.mjs'], { cwd: extDir, stdio: 'inherit' });

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir);
fs.cpSync(path.join(extDir, 'dist'), path.join(stageDir, 'dist'), { recursive: true });
fs.cpSync(path.join(extDir, 'resources'), path.join(stageDir, 'resources'), { recursive: true });
fs.copyFileSync(path.join(rootDir, 'README.md'), path.join(stageDir, 'README.md'));

const dependencies = {};
for (const name of RUNTIME_PACKAGES) {
  const src = packageRoot(name);
  fs.cpSync(src, path.join(stageDir, 'dist', 'node_modules', name), { recursive: true });
  dependencies[name] = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
}

const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
// Marketplace names cannot be scoped; the extension ID becomes `local.issues-tracker`.
manifest.name = 'issues-tracker';
manifest.dependencies = dependencies;
delete manifest.scripts;
delete manifest.devDependencies;
fs.writeFileSync(path.join(stageDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

const vsix = path.join(extDir, `issues-tracker-${manifest.version}.vsix`);
execFileSync(
  path.join(rootDir, 'node_modules/.bin/vsce'),
  ['package', '--no-dependencies', '--skip-license', '--allow-missing-repository', '--out', vsix],
  { cwd: stageDir, stdio: 'inherit' },
);
console.log(`\nInstall with: code --install-extension ${vsix}`);
