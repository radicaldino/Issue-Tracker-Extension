import * as esbuild from 'esbuild';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  // The Agent SDK is ESM and locates its native Claude Code binary relative to
  // its own install, so it is loaded from node_modules at runtime, not bundled.
  external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
