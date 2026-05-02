import type { Tool } from './types.js';

const MAX_BYTES = 500_000;

export const WebFetchTool: Tool = {
  requiresPermission: true,
  definition: {
    type: 'function',
    function: {
      name: 'WebFetch',
      description:
        'Fetches a URL via HTTP GET. Returns the response body, with HTML stripped to plain text by default. For known JSON endpoints, set raw=true. Caps response at ~500KB.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Fully-qualified http(s) URL.' },
          raw: { type: 'boolean', default: false, description: 'Return raw body instead of HTML→text.' },
        },
        required: ['url'],
      },
    },
  },
  async run(args, ctx) {
    const url = String(args?.url ?? '');
    if (!/^https?:\/\//i.test(url)) return { ok: false, content: 'Error: url must be http(s).' };
    const decision = await ctx.requestPermission('WebFetch', `GET ${url}`);
    if (decision === 'deny') return { ok: false, content: 'User denied WebFetch.' };

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'deepseek-cli/0.1 (+https://github.com/yinshuo-thu/deepseek-cli)' },
      });
    } catch (e) {
      return { ok: false, content: `Network error: ${(e as Error).message}` };
    }
    if (!res.ok) return { ok: false, content: `HTTP ${res.status} ${res.statusText} for ${url}` };

    const reader = res.body?.getReader();
    if (!reader) return { ok: false, content: 'No response body.' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > MAX_BYTES) { reader.cancel(); break; }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const ctype = res.headers.get('content-type') ?? '';
    const text = buf.toString('utf8');
    if (args?.raw || !/text\/html|application\/xhtml/.test(ctype)) {
      return { ok: true, content: text.slice(0, MAX_BYTES) };
    }
    return { ok: true, content: htmlToText(text).slice(0, MAX_BYTES) };
  },
};

function htmlToText(html: string): string {
  // Minimal HTML→text. Drop scripts/styles, decode common entities, collapse whitespace.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
