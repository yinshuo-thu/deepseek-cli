// Slash command handlers for /hooks: list, reload, trust.

import { clearHookCache, isProjectTrusted, loadHooks, trustProject } from '../hooks/settings.js';

export async function listHooksMarkdown(cwd: string): Promise<string> {
  const { hooks, projectTrusted, projectHasHooks } = await loadHooks(cwd);
  const lines: string[] = [];
  lines.push(`**Hooks** (${hooks.length})`);
  if (projectHasHooks && !projectTrusted) {
    lines.push('');
    lines.push('Project hooks are loaded but **disabled** until you run `/hooks trust`.');
  }
  lines.push('');
  if (!hooks.length) {
    lines.push('*(no hooks defined)*');
    return lines.join('\n');
  }
  for (const h of hooks) {
    const status = h.enabled ? 'enabled' : 'disabled';
    const matcher = h.matcher ? ` matcher=\`${h.matcher}\`` : '';
    const block = h.exit_blocks_tool ? ' (blocks)' : '';
    lines.push(`- [${h.source}/${status}] **${h.event}**${matcher}${block} — \`${h.command}\``);
  }
  return lines.join('\n');
}

export async function reloadHooksMarkdown(cwd: string): Promise<string> {
  clearHookCache(cwd);
  const { hooks, projectTrusted, projectHasHooks } = await loadHooks(cwd, true);
  const userCount = hooks.filter((h) => h.source === 'user').length;
  const projCount = hooks.filter((h) => h.source === 'project').length;
  const trustNote = projectHasHooks && !projectTrusted ? ' (project hooks disabled — `/hooks trust`)' : '';
  return `Reloaded. ${userCount} user + ${projCount} project hooks${trustNote}.`;
}

export async function trustHooksMarkdown(cwd: string): Promise<string> {
  const before = await isProjectTrusted(cwd);
  await trustProject(cwd);
  clearHookCache(cwd);
  const { hooks } = await loadHooks(cwd, true);
  const proj = hooks.filter((h) => h.source === 'project');
  if (before) return `Already trusted: \`${cwd}\`. ${proj.length} project hooks loaded.`;
  return `Trusted \`${cwd}\`. ${proj.length} project hooks now enabled.`;
}
