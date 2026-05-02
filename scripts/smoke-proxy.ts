// Smoke test for the OpenAI-compatible proxy.
//
// Two modes:
//   - DEFAULT (no env): live PoW + DS web wire format would require a real
//     cookie, so this mode currently exercises the OpenAI shape against the
//     real client. With DS_COOKIE unset, the test only validates that
//     `/v1/models` works and that `/v1/chat/completions` returns *some*
//     OpenAI-shaped error chunk + [DONE] (since the stub cookie won't pass
//     validate). This keeps the mock-style "always green" smoke contract.
//   - DS_COOKIE set: hit chat.deepseek.com end-to-end, expect a non-empty
//     streamed reply.

import { startProxyServer } from '../src/auth/server.js';
import type { WebSession } from '../src/auth/session.js';

const liveCookie = (process.env.DS_COOKIE ?? '').trim();
const liveMode = liveCookie.length > 0;

const session: WebSession = liveMode
  ? { cookie: liveCookie, userId: 'live-user', createdAt: Date.now() }
  : { cookie: 'stub-cookie-for-smoke-test', userId: 'stub-user', createdAt: Date.now() };

if (!liveMode) {
  console.log('skipped live: no DS_COOKIE — running mock-shape smoke only');
}

const proxy = await startProxyServer(session);
console.log(`proxy listening at ${proxy.url} (live=${liveMode})`);

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
  let sawError = false;
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
      const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>; error?: { message?: string } };
      const choice = json.choices?.[0];
      if (choice?.delta?.content) assembled += choice.delta.content;
      if (choice?.finish_reason === 'error' || json.error) sawError = true;
      if (choice?.finish_reason) sawFinish = true;
    }
  }
  console.log(`assembled content: ${JSON.stringify(assembled)}`);
  if (!sawFinish) throw new Error('no finish_reason chunk seen');
  if (!sawDone) throw new Error('no [DONE] sentinel seen');

  if (liveMode) {
    if (sawError) throw new Error('live mode: stream surfaced an error chunk');
    if (assembled.length < 4) throw new Error(`live mode: assembled stream too short: ${JSON.stringify(assembled)}`);
    console.log('smoke-proxy: ok (live)');
  } else {
    // Mock cookie path: dswebClient detects the stub cookie and emits a
    // deterministic "[mock]" echo, so we keep the original assertions.
    if (!assembled.includes('[mock]')) throw new Error('assembled stream missing "[mock]" prefix');
    if (!assembled.includes('hello world')) throw new Error('assembled stream missing echoed prompt');
    if (sawError) throw new Error('mock mode: unexpected error chunk');
    console.log('smoke-proxy: ok (mock)');
  }
} catch (err) {
  exitCode = 1;
  console.error(`smoke-proxy: FAIL — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  proxy.close();
}

process.exit(exitCode);
