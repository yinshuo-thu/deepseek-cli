import { spawn } from 'node:child_process';
import type { Tool } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export const BashTool: Tool = {
  requiresPermission: true,
  definition: {
    type: 'function',
    function: {
      name: 'Bash',
      description:
        'Executes a shell command in the user\'s default shell. Default timeout 120s, max 600s. Output is captured and returned.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to run.' },
          description: { type: 'string', description: 'Short human-readable description.' },
          timeout: { type: 'integer', description: 'Timeout in milliseconds (max 600000).' },
        },
        required: ['command'],
      },
    },
  },
  async run(args, ctx) {
    const cmd = String(args?.command ?? '').trim();
    if (!cmd) return { ok: false, content: 'Error: command is required.' };
    const summary = args?.description ? `${args.description}\n  $ ${cmd}` : `$ ${cmd}`;
    const decision = await ctx.requestPermission('Bash', summary);
    if (decision === 'deny') return { ok: false, content: 'User denied Bash command.' };

    const timeout = Math.min(Math.max(1000, Number(args?.timeout ?? DEFAULT_TIMEOUT_MS)), MAX_TIMEOUT_MS);
    return await execShell(cmd, ctx.cwd, timeout, ctx.log);
  },
};

function execShell(cmd: string, cwd: string, timeoutMs: number, onLine: (s: string) => void): Promise<{ ok: boolean; content: string }> {
  return new Promise((resolveP) => {
    const child = spawn(process.env.SHELL || '/bin/sh', ['-lc', cmd], {
      cwd,
      env: process.env,
    });
    const chunks: string[] = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    const cap = (label: 'out' | 'err') => (data: Buffer) => {
      const s = data.toString('utf8');
      chunks.push(s);
      // Surface line-by-line for live status; cap to avoid flooding.
      for (const ln of s.split('\n')) {
        if (ln.trim()) onLine(`${label === 'err' ? '! ' : '· '}${ln.slice(0, 400)}`);
      }
    };
    child.stdout.on('data', cap('out'));
    child.stderr.on('data', cap('err'));

    child.on('close', (code) => {
      clearTimeout(timer);
      const out = chunks.join('').slice(-20_000); // tail-cap returned to model
      const status = killed ? `(killed after ${timeoutMs}ms)` : `exit=${code}`;
      resolveP({
        ok: !killed && code === 0,
        content: `$ ${cmd}\n${out || '<no output>'}\n[${status}]`,
      });
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolveP({ ok: false, content: `spawn error: ${e.message}` });
    });
  });
}
