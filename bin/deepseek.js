#!/usr/bin/env node
// Bin shim: prefers built dist/, falls back to tsx for dev.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, '..', 'dist', 'cli.js');
const srcEntry = resolve(here, '..', 'src', 'cli.tsx');

if (existsSync(distEntry)) {
  await import(distEntry);
} else if (existsSync(srcEntry)) {
  // Dev mode — re-exec under tsx so JSX/TS are handled.
  const tsx = resolve(here, '..', 'node_modules', '.bin', 'tsx');
  const child = spawn(tsx, [srcEntry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  console.error('deepseek-cli: no built output and no src found. Run `npm run build` first.');
  process.exit(1);
}
