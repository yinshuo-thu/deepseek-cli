// Subagents smoke: spawn `general-purpose`, ask it a tiny task, verify
// final_text + persisted meta.json. Hits the live DeepSeek API.

import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, projectDir } from '../src/config/index.js';
import { DeepSeekClient } from '../src/api/client.js';
import { configureSpawn, spawnAgent } from '../src/agents/spawn.js';
import { agentRegistry } from '../src/agents/registry.js';
import type { ToolContext } from '../src/tools/types.js';

const cfg = await loadConfig();
if (!cfg.apiKey) {
  console.error('No DEEPSEEK_API_KEY.');
  process.exit(1);
}

const cwd = process.cwd();
const client = new DeepSeekClient(cfg);
configureSpawn({ config: cfg, client, cwd });

// Top-level fake parent context — auto-allow permissions for the smoke run.
const parentCtx: ToolContext = {
  cwd,
  log: () => {},
  readFiles: new Set<string>(),
  depth: 0,
  async requestPermission() { return 'always'; },
};

console.log('[1] foreground spawn — general-purpose');
const r = await spawnAgent({
  subagentType: 'general-purpose',
  prompt: `Use the Read tool on ${join(cwd, 'package.json')} to find the "name" field in package.json. Reply with just the name value, nothing else.`,
  parentCtx,
  isolation: 'none',
});

console.log(`  agent_id=${r.agent_id} status=${r.status}`);
console.log(`  final_text="${(r.final_text ?? '').slice(0, 200)}"`);

if (r.status !== 'done') {
  console.error(`! expected status=done, got ${r.status}: ${r.error}`);
  process.exit(2);
}
if (!r.final_text || r.final_text.trim().length < 3) {
  console.error('! final_text is missing or trivial');
  process.exit(3);
}

const metaFp = join(projectDir(cwd), `agent-${r.agent_id}.meta.json`);
const jsonlFp = join(projectDir(cwd), `agent-${r.agent_id}.jsonl`);
if (!existsSync(metaFp)) { console.error(`! missing meta: ${metaFp}`); process.exit(4); }
if (!existsSync(jsonlFp)) { console.error(`! missing jsonl: ${jsonlFp}`); process.exit(5); }
const meta = JSON.parse(await fs.readFile(metaFp, 'utf8'));
console.log(`  meta path=${metaFp}`);
console.log(`  meta.status=${meta.status} meta.message_count=${meta.message_count}`);
if (meta.status !== 'done') { console.error(`! meta.status=${meta.status}`); process.exit(6); }

console.log('[2] background spawn + Monitor');
const bg = await spawnAgent({
  subagentType: 'Explore',
  prompt: `List the top-level entries in ${cwd} using list_dir, then summarise them in one short sentence.`,
  parentCtx,
  isolation: 'none',
  runInBackground: true,
});
console.log(`  bg agent_id=${bg.agent_id} initial status=${bg.status}`);
if (bg.status !== 'running') {
  console.error(`! expected running, got ${bg.status}`);
  process.exit(7);
}

// Poll Monitor until done or timeout (60s).
const start = Date.now();
let cursor = 0;
let finalStatus = 'running';
while (Date.now() - start < 60_000) {
  const inst = agentRegistry.get(bg.agent_id);
  if (!inst) break;
  finalStatus = inst.record.status;
  const tail = inst.ringBuffer.slice(cursor);
  if (tail.length) {
    for (const ln of tail) console.log(`    | ${ln}`);
    cursor = inst.ringBuffer.length;
  }
  if (finalStatus !== 'running') break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`  bg final status=${finalStatus}`);
if (finalStatus !== 'done') {
  console.error(`! bg agent did not reach done in time`);
  process.exit(8);
}

console.log('— smoke:agents ok');
