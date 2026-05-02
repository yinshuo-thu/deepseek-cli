// Smoke test for the OpenAI-compatible mock proxy.
//
// Spins up the proxy directly against a stub WebSession (skips the browser
// auth dance), POSTs an OpenAI-shaped chat completion, and asserts that the
// response streams back content in OpenAI SSE format.

import { startProxyServer } from '../src/auth/server.js';
import type { WebSession } from '../src/auth/session.js';

const stubSession: WebSession = {
  cookie: 'stub-cookie-for-smoke-test',
  userId: 'stub-user',
  createdAt: Date.now(),
};

const proxy = await startProxyServer(stubSession);
console.log(`proxy listening at ${proxy.url}`);

let exitCode = 0;
try {
  // /v1/models
  const modelsRes = await fetch(`${proxy.url}/models`);
  const models = await modelsRes.json() as { data: Array<{ id: string }> };
  console.log(`models: ${models.data.map((m) => m.id).join(', ')}`);
  if (!models.data.find((m) => m.id === 'deepseek-v4-flash')) {
    throw new Error('expected deepseek-v4-flash in /v1/models');
  }

  // /v1/chat/completions streaming
  const chatRes = await fetch(`${proxy.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      stream: true,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello world' },
      ],
    }),
  });
  if (!chatRes.ok || !chatRes.body) {
    throw new Error(`chat HTTP ${chatRes.status}`);
  }

  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let assembled = '';
  let sawDone = false;
  let sawFinish = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { sawDone = true; continue; }
      const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }> };
      const choice = json.choices?.[0];
      if (choice?.delta?.content) assembled += choice.delta.content;
      if (choice?.finish_reason) sawFinish = true;
    }
  }
  console.log(`assembled content: ${JSON.stringify(assembled)}`);
  if (!assembled.includes('[mock]')) throw new Error('assembled stream missing "[mock]" prefix');
  if (!assembled.includes('hello world')) throw new Error('assembled stream missing echoed prompt');
  if (!sawFinish) throw new Error('no finish_reason chunk seen');
  if (!sawDone) throw new Error('no [DONE] sentinel seen');
  console.log('smoke-proxy: ok');
} catch (err) {
  exitCode = 1;
  console.error(`smoke-proxy: FAIL — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  proxy.close();
}

process.exit(exitCode);
