// Smoke test: hits the real DeepSeek API and prints the streamed response.
// Run with: tsx scripts/smoke.ts "your prompt"

import { loadConfig } from '../src/config/index.js';
import { DeepSeekClient } from '../src/api/client.js';

const prompt = process.argv.slice(2).join(' ').trim() || 'In one sentence: what is DeepSeek-CLI?';

const cfg = await loadConfig();
if (!cfg.apiKey) {
  console.error('No API key. Set DEEPSEEK_API_KEY or run `deepseek` once to configure.');
  process.exit(1);
}

console.log(`> ${prompt}\n`);
const client = new DeepSeekClient(cfg);
const ctrl = new AbortController();
process.on('SIGINT', () => ctrl.abort());

let totalIn = 0, totalOut = 0;
for await (const ev of client.stream({
  messages: [{ role: 'user', content: prompt }],
  signal: ctrl.signal,
})) {
  if (ev.kind === 'content') process.stdout.write(ev.delta);
  else if (ev.kind === 'usage') {
    totalIn = ev.usage.prompt_tokens ?? totalIn;
    totalOut = ev.usage.completion_tokens ?? totalOut;
  } else if (ev.kind === 'error') {
    console.error(`\n[error] ${ev.message}`);
    process.exit(1);
  }
}
console.log(`\n\n— tokens: ${totalIn} in / ${totalOut} out`);
