import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';
import { highlight, supportsLanguage } from 'cli-highlight';
import { palette } from './theme.js';

// Configure marked once with the terminal renderer.
marked.use(
  markedTerminal({
    code: chalk.hex(palette.fg).bgHex(palette.bgRaised),
    blockquote: chalk.hex(palette.fgMuted).italic,
    heading: chalk.hex(palette.deepseekBlue).bold,
    firstHeading: chalk.hex(palette.deepseekBlue).bold,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.hex(palette.deepseekBlue).bgHex(palette.bgRaised),
    list: (body: string) => body,
    listitem: (text: string) => `  • ${text}`,
    table: chalk.hex(palette.fg),
    paragraph: chalk.hex(palette.fg),
    link: chalk.hex(palette.deepseekBlue).underline,
    href: chalk.hex(palette.deepseekBlueDim).underline,
    hr: chalk.hex(palette.fgMuted),
    text: (s: string) => s,
    width: Math.max(40, (process.stdout.columns ?? 80) - 4),
    reflowText: false,
    tab: 2,
  }) as any,
);

/** Render markdown to ANSI for an Ink <Text> with raw=true. */
export function renderMarkdown(md: string): string {
  try {
    return marked.parse(md) as string;
  } catch {
    return md;
  }
}

/** Highlight a fenced code block by language, fall back to plain text. */
export function highlightCode(code: string, lang?: string): string {
  if (lang && supportsLanguage(lang)) {
    try { return highlight(code, { language: lang }); } catch {}
  }
  try { return highlight(code, { language: 'plaintext', ignoreIllegals: true }); }
  catch { return code; }
}
