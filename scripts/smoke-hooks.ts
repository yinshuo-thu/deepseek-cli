#!/usr/bin/env node
// Hooks smoke. Writes a fixture project settings.json with a PreToolUse hook
// that always denies, trusts the project, runs runHooks() with a fake Bash
// payload, asserts blocked=true. Then runs an actual mini-loop driven through
// the agent loop (no API call) by invoking the runHooks pipeline directly with
// the same toolName routing.

import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHooks } from '../src/hooks/runner.js';
import { clearHookCache, trustProject } from '../src/hooks/settings.js';

const tmp = join(tmpdir(), `ds-smoke-hooks-${Date.now().toString(36)}`);
mkdirSync(join(tmp, '.deepseek'), { recursive: true });
const settingsFp = join(tmp, '.deepseek', 'settings.json');
await fs.writeFile(settingsFp, JSON.stringify({
  hooks: [
    {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo "no bash for you" 1>&2; exit 2',
      exit_blocks_tool: true,
      timeoutMs: 5000,
    },
    {
      event: 'UserPromptSubmit',
      command: 'echo \'{"rewrite":"REWRITTEN"}\'',
      timeoutMs: 5000,
    },
  ],
}, null, 2));

console.log('[1] without trust → project hooks should be disabled');
clearHookCache(tmp);
const untrusted = await runHooks({ event: 'PreToolUse', payload: { tool: 'Bash', args: { command: 'rm -rf /' } }, cwd: tmp, toolName: 'Bash' });
if (untrusted.results.length !== 0) { console.error(`! expected 0 hook runs while untrusted, got ${untrusted.results.length}`); process.exit(2); }
console.log('  ok — 0 hooks ran');

console.log('[2] trust the project, then re-run');
await trustProject(tmp);
clearHookCache(tmp);
const blocked = await runHooks({ event: 'PreToolUse', payload: { tool: 'Bash', args: { command: 'rm -rf /' } }, cwd: tmp, toolName: 'Bash' });
if (!blocked.blocked) { console.error('! expected blocked=true'); process.exit(3); }
if (blocked.results.length !== 1) { console.error(`! expected 1 hook ran, got ${blocked.results.length}`); process.exit(4); }
if (blocked.results[0]!.exitCode !== 2) { console.error(`! expected exit=2, got ${blocked.results[0]!.exitCode}`); process.exit(5); }
console.log(`  ok — blocked=${blocked.blocked} reason="${(blocked.blockReason ?? '').trim()}"`);

console.log('[3] non-matching tool → should not block');
const ok = await runHooks({ event: 'PreToolUse', payload: { tool: 'Read', args: {} }, cwd: tmp, toolName: 'Read' });
if (ok.blocked) { console.error('! expected not blocked for Read'); process.exit(6); }
console.log(`  ok — Read passed (results=${ok.results.length})`);

console.log('[4] UserPromptSubmit rewrite');
const rw = await runHooks({ event: 'UserPromptSubmit', payload: { prompt: 'hello' }, cwd: tmp });
if (rw.rewrite !== 'REWRITTEN') { console.error(`! expected rewrite='REWRITTEN', got ${JSON.stringify(rw.rewrite)}`); process.exit(7); }
console.log(`  ok — rewrite="${rw.rewrite}"`);

// Clean up: untrust the temp project so we don't leave noise in trusted-projects.json
import { loadTrustedProjects } from '../src/hooks/settings.js';
import { join as pj } from 'node:path';
import { homedir } from 'node:os';
const trusted = await loadTrustedProjects();
trusted.delete(tmp);
const trustedFp = pj(homedir(), '.deepseek', 'trusted-projects.json');
if (existsSync(trustedFp)) {
  await fs.writeFile(trustedFp, JSON.stringify({ projects: Array.from(trusted) }, null, 2), { mode: 0o600 });
}

console.log('— smoke:hooks ok');
