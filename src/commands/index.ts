// Slash-command registry. The App calls dispatch() and reacts to the returned action.
import type { Config, ModelId, PermissionMode, ReasoningEffort } from '../config/index.js';

export type SlashAction =
  | { type: 'noop'; message?: string }
  | { type: 'message'; markdown: string }
  | { type: 'clear' }
  | { type: 'exit' }
  | { type: 'set-model'; model: ModelId }
  | { type: 'set-mode'; mode: PermissionMode }
  | { type: 'set-reasoning'; effort: ReasoningEffort }
  | { type: 'open-config' }
  | { type: 'show-cost' }
  | { type: 'resume-picker' }
  | { type: 'compact' }
  | { type: 'auth-login' }
  | { type: 'auth-logout' }
  | { type: 'auth-whoami' };

export interface SlashContext {
  config: Config;
  cwd: string;
}

interface SlashSpec {
  name: string;
  aliases?: string[];
  summary: string;
  handler: (rest: string, ctx: SlashContext) => SlashAction;
}

const COMMANDS: SlashSpec[] = [
  {
    name: '/help',
    summary: 'Show available slash commands.',
    handler: () => ({ type: 'message', markdown: helpMarkdown() }),
  },
  {
    name: '/clear',
    summary: 'Clear the current conversation context.',
    handler: () => ({ type: 'clear' }),
  },
  {
    name: '/exit',
    aliases: ['/quit'],
    summary: 'Exit DeepSeek-CLI.',
    handler: () => ({ type: 'exit' }),
  },
  {
    name: '/model',
    summary: 'Switch model. Usage: `/model deepseek-v4-flash` or `/model deepseek-v4-pro`.',
    handler: (rest) => {
      const m = rest.trim();
      if (m === 'deepseek-v4-flash' || m === 'deepseek-v4-pro') {
        return { type: 'set-model', model: m as ModelId };
      }
      return {
        type: 'message',
        markdown:
          '**Usage:** `/model deepseek-v4-flash` or `/model deepseek-v4-pro`.\n\n' +
          '- `deepseek-v4-flash` — fast, cheap, default.\n' +
          '- `deepseek-v4-pro` — strongest reasoning. Use for hard problems.',
      };
    },
  },
  {
    name: '/mode',
    summary: 'Switch permission mode. Usage: `/mode plan|agent|yolo`.',
    handler: (rest) => {
      const m = rest.trim();
      if (m === 'plan' || m === 'agent' || m === 'yolo') {
        return { type: 'set-mode', mode: m };
      }
      return {
        type: 'message',
        markdown:
          '**Modes:** `/mode plan|agent|yolo`\n\n' +
          '- `plan` — read-only. Safe for exploring an unfamiliar repo.\n' +
          '- `agent` (default) — full toolbox; sensitive ops prompt.\n' +
          '- `yolo` — auto-approve everything. Trusted repos only.',
      };
    },
  },
  {
    name: '/reasoning',
    summary: 'Set reasoning effort. Usage: `/reasoning off|high|max`.',
    handler: (rest) => {
      const r = rest.trim();
      if (r === 'off' || r === 'high' || r === 'max') return { type: 'set-reasoning', effort: r };
      return {
        type: 'message',
        markdown:
          '**Reasoning:** `/reasoning off|high|max`\n\n' +
          '- `off` — fast turn, no chain-of-thought.\n' +
          '- `high` — moderate thinking budget.\n' +
          '- `max` — full thinking budget; uses `deepseek-reasoner`.',
      };
    },
  },
  {
    name: '/config',
    summary: 'Open ~/.deepseek/config.json in $EDITOR.',
    handler: () => ({ type: 'open-config' }),
  },
  {
    name: '/cost',
    summary: 'Show estimated session cost & token usage.',
    handler: () => ({ type: 'show-cost' }),
  },
  {
    name: '/resume',
    summary: 'Pick a previous session to resume.',
    handler: () => ({ type: 'resume-picker' }),
  },
  {
    name: '/compact',
    summary: 'Summarise + truncate the conversation to free up context.',
    handler: () => ({ type: 'compact' }),
  },
  {
    name: '/cwd',
    summary: 'Show the current working directory.',
    handler: (_, ctx) => ({ type: 'message', markdown: '`' + ctx.cwd + '`' }),
  },
  {
    name: '/login',
    summary: 'Authorize via DeepSeek web session (opens browser).',
    handler: () => ({ type: 'auth-login' }),
  },
  {
    name: '/logout',
    summary: 'Clear stored web session.',
    handler: () => ({ type: 'auth-logout' }),
  },
  {
    name: '/whoami',
    summary: 'Show current authentication source.',
    handler: () => ({ type: 'auth-whoami' }),
  },
];

export function dispatch(input: string, ctx: SlashContext): SlashAction | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head, ...rest] = trimmed.split(/\s+/);
  const lower = head!.toLowerCase();
  const match = COMMANDS.find(
    (c) => c.name === lower || (c.aliases && c.aliases.includes(lower)),
  );
  if (!match) return { type: 'message', markdown: `Unknown command \`${head}\`. Try \`/help\`.` };
  return match.handler(rest.join(' '), ctx);
}

function helpMarkdown(): string {
  const rows = COMMANDS.map((c) => `- \`${c.name}\`${c.aliases ? ` (${c.aliases.join(', ')})` : ''} — ${c.summary}`);
  return `**DeepSeek-CLI commands**\n\n${rows.join('\n')}\n\n**Keys:** Tab cycles modes · Shift+Tab cycles reasoning · Esc cancels stream · Ctrl+C twice exits.`;
}

export function commandNames(): string[] {
  return COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
}
