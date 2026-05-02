// Tool-calling smoke test: ask the model to read a file via the Read tool.
// Confirms that the streaming + tool_calls path round-trips cleanly.

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../src/config/index.js';
import { DeepSeekClient } from '../src/api/client.js';
import { runAgentLoop } from '../src/agents/loop.js';

const cfg = await loadConfig();
if (!cfg.apiKey) {
  console.error('No DEEPSEEK_API_KEY.');
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), 'deepseek-smoke-'));
const file = join(dir, 'secret.txt');
await writeFile(file, 'the magic word is wormhole', 'utf8');

const messages: any[] = [
  { role: 'system', content: `You are a CLI assistant. The cwd is ${dir}. Use the Read tool to read files when asked.` },
  { role: 'user', content: `Read the file ${file} and tell me the magic word in one sentence.` },
];

const ctrl = new AbortController();
process.on('SIGINT', () => ctrl.abort());

let buf = '';
await runAgentLoop({
  client: new DeepSeekClient(cfg),
  messages,
  cwd: dir,
  model: cfg.model,
  signal: ctrl.signal,
  cb: {
    onAssistantDelta: (d) => { buf += d; process.stdout.write(d); },
    onReasoningDelta: () => {},
    onToolCallStart: (_, name) => process.stdout.write(`\n[tool: ${name}]`),
    onToolCallArgs: () => {},
    onToolCallReady: (_, name, args) => process.stdout.write(`\n  args: ${JSON.stringify(args)}\n`),
    onToolResult: (_, name, ok, summary) => process.stdout.write(`  ${ok ? '✓' : '✗'} ${name}: ${summary.slice(0, 120)}\n`),
    onTurnEnd: () => {},
    onUsage: () => {},
    onError: (m) => console.error(`\n[error] ${m}`),
    requestPermission: async () => 'always', // auto-allow in smoke test
    log: () => {},
  },
});

await rm(dir, { recursive: true, force: true });
console.log('\n— smoke test ok');
if (!buf.toLowerCase().includes('wormhole')) {
  console.error('— ! model did not echo the magic word; tool round-trip may be broken');
  process.exit(2);
}
