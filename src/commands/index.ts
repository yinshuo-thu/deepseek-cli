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
  | { type: 'auth-whoami' }
  | { type: 'agents-list' }
  | { type: 'agents-reload' }
  | { type: 'agents-create' }
  | { type: 'hooks-list' }
  | { type: 'hooks-reload' }
  | { type: 'hooks-trust' }
  | { type: 'skills-list' }
  | { type: 'skills-reload' }
  | { type: 'skills-add'; name: string }
  | { type: 'mcp-list' }
  | { type: 'mcp-init' }
  | { type: 'mcp-add'; name: string; commandLine: string }
  | { type: 'mcp-enable'; name: string }
  | { type: 'mcp-disable'; name: string }
  | { type: 'mcp-reload' }
  | { type: 'mcp-remove'; name: string }
  | { type: 'mcp-dialog' }
  | { type: 'model-dialog' }
  | { type: 'permissions-list' }
  | { type: 'permissions-reset' }
  | { type: 'doctor' }
  | { type: 'init' }
  | { type: 'bug' }
  | { type: 'review' }
  | { type: 'toggle-vim' }
  | { type: 'memory' }
  | { type: 'toggle-fast' }
  | { type: 'upgrade' }
  | { type: 'release-notes' }
  | { type: 'terminal-setup' }
  | { type: 'ide' }
  | { type: 'status' };

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
      if (m === 'plan' || m === 'agent' || m === 'yolo' || m === 'acceptEdits' || m === 'default') {
        return { type: 'set-mode', mode: m as PermissionMode };
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
  {
    name: '/agents',
    summary: 'List subagents. `/agents reload` rescans, `/agents create` writes a new one.',
    handler: (rest) => {
      const sub = rest.trim().toLowerCase();
      if (sub === 'reload') return { type: 'agents-reload' };
      if (sub === 'create') return { type: 'agents-create' };
      return { type: 'agents-list' };
    },
  },
  {
    name: '/hooks',
    summary: 'List hooks. `/hooks reload` rescans, `/hooks trust` enables project hooks.',
    handler: (rest) => {
      const sub = rest.trim().toLowerCase();
      if (sub === 'reload') return { type: 'hooks-reload' };
      if (sub === 'trust') return { type: 'hooks-trust' };
      return { type: 'hooks-list' };
    },
  },
  {
    name: '/skills',
    summary: 'List skills. `/skills reload` rescans, `/skills add <name>` writes a stub.',
    handler: (rest) => {
      const trimmed = rest.trim();
      const [head, ...rstParts] = trimmed.split(/\s+/);
      const sub = (head ?? '').toLowerCase();
      if (sub === 'reload') return { type: 'skills-reload' };
      if (sub === 'add') {
        const name = rstParts.join(' ').trim();
        if (!name) return { type: 'message', markdown: 'Usage: `/skills add <name>`.' };
        return { type: 'skills-add', name };
      }
      return { type: 'skills-list' };
    },
  },
  {
    name: '/mcp',
    summary: 'List MCP servers. Subcommands: init, add, enable, disable, reload, remove.',
    handler: (rest) => {
      const trimmed = rest.trim();
      if (!trimmed) return { type: 'mcp-list' };
      const [sub, ...args] = trimmed.split(/\s+/);
      const lower = (sub ?? '').toLowerCase();
      if (lower === 'init') return { type: 'mcp-init' };
      if (lower === 'reload') return { type: 'mcp-reload' };
      if (lower === 'add') {
        const name = args[0];
        const commandLine = args.slice(1).join(' ').trim();
        if (!name || !commandLine) return { type: 'message', markdown: 'Usage: `/mcp add <name> <command-line>`.' };
        return { type: 'mcp-add', name, commandLine };
      }
      if (lower === 'enable' || lower === 'disable' || lower === 'remove') {
        const name = args[0];
        if (!name) return { type: 'message', markdown: `Usage: \`/mcp ${lower} <name>\`.` };
        if (lower === 'enable') return { type: 'mcp-enable', name };
        if (lower === 'disable') return { type: 'mcp-disable', name };
        return { type: 'mcp-remove', name };
      }
      return { type: 'message', markdown: 'Unknown `/mcp` subcommand. Try `/mcp` or `/mcp init|add|enable|disable|reload|remove`.' };
    },
  },
  {
    name: '/mcp-ui',
    summary: 'Open interactive MCP server toggle dialog.',
    handler: () => ({ type: 'mcp-dialog' }),
  },
  {
    name: '/model-ui',
    summary: 'Open interactive model picker dialog.',
    handler: () => ({ type: 'model-dialog' }),
  },
  {
    name: '/permissions',
    summary: 'List or reset persisted tool permissions. `/permissions reset` clears all.',
    handler: (rest) => {
      if (rest.trim() === 'reset') return { type: 'permissions-reset' };
      return { type: 'permissions-list' };
    },
  },
  {
    name: '/doctor',
    summary: 'Run system health check (Node version, API connectivity, config validity).',
    handler: () => ({ type: 'doctor' }),
  },
  {
    name: '/init',
    summary: 'Create DEEPSEEK.md project context file in the current directory.',
    handler: () => ({ type: 'init' }),
  },
  {
    name: '/bug',
    summary: 'Report a bug or open the issue tracker.',
    handler: () => ({ type: 'bug' }),
  },
  {
    name: '/review',
    summary: 'Ask the AI to review changes in the current git diff.',
    handler: () => ({ type: 'review' }),
  },
  {
    name: '/vim',
    summary: 'Toggle vim key bindings for input.',
    handler: () => ({ type: 'toggle-vim' }),
  },
  {
    name: '/memory',
    summary: 'Show or open the project memory file (DEEPSEEK.md if exists, else ~/.deepseek/notes.md).',
    handler: () => ({ type: 'memory' }),
  },
  {
    name: '/fast',
    summary: 'Toggle fast mode (uses deepseek-v4-flash for speed).',
    handler: () => ({ type: 'toggle-fast' }),
  },
  {
    name: '/upgrade',
    summary: 'Check for a newer version of deepseek-cli.',
    handler: () => ({ type: 'upgrade' }),
  },
  {
    name: '/release-notes',
    summary: 'Show recent release notes.',
    handler: () => ({ type: 'release-notes' }),
  },
  {
    name: '/terminal-setup',
    summary: 'Show instructions for setting up shell integration.',
    handler: () => ({ type: 'terminal-setup' }),
  },
  {
    name: '/ide',
    summary: 'Show IDE integration status and connection info.',
    handler: () => ({ type: 'ide' }),
  },
  {
    name: '/status',
    summary: 'Show authentication status, active model, and session info.',
    handler: () => ({ type: 'status' }),
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
