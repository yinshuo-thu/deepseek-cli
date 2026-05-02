import type { Tool } from './types.js';

// DuckDuckGo HTML endpoint scraper. No API key required.
// Rate limit conservatively — if you need volume, swap to a real search API.

export const WebSearchTool: Tool = {
  requiresPermission: true,
  definition: {
    type: 'function',
    function: {
      name: 'WebSearch',
      description:
        'Searches the web via DuckDuckGo and returns up to 10 ranked results (title · url · snippet).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          max_results: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
        },
        required: ['query'],
      },
    },
  },
  async run(args, ctx) {
    const q = String(args?.query ?? '').trim();
    if (!q) return { ok: false, content: 'Error: query is required.' };
    const decision = await ctx.requestPermission('WebSearch', `Search: ${q}`);
    if (decision === 'deny') return { ok: false, content: 'User denied WebSearch.' };

    const max = Math.max(1, Math.min(10, Number(args?.max_results ?? 6)));
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; deepseek-cli/0.1)',
          'Accept': 'text/html',
        },
      });
    } catch (e) {
      return { ok: false, content: `network: ${(e as Error).message}` };
    }
    if (!res.ok) return { ok: false, content: `HTTP ${res.status} from DuckDuckGo` };
    const html = await res.text();
    const results = parseDuckDuckGo(html).slice(0, max);
    if (!results.length) return { ok: true, content: 'no results.' };
    return {
      ok: true,
      content: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n'),
    };
  },
};

function parseDuckDuckGo(html: string): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  // DDG HTML wraps each result in <div class="result">…<a class="result__a" href="…">title</a>…<a class="result__snippet">snippet</a>…</div>
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const rawUrl = m[1] ?? '';
    const title = stripTags(m[2] ?? '').trim();
    const snippet = stripTags(m[3] ?? '').trim();
    // DDG sometimes wraps the URL in /l/?uddg=… — unwrap.
    const u = unwrapDDG(rawUrl);
    if (u && title) out.push({ title, url: u, snippet });
  }
  return out;
}

function unwrapDDG(href: string): string {
  try {
    if (href.startsWith('//')) href = 'https:' + href;
    const u = new URL(href);
    const direct = u.searchParams.get('uddg');
    if (direct) return decodeURIComponent(direct);
    return u.toString();
  } catch {
    return href;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
}
