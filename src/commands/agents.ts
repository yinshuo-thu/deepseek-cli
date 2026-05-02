// Slash command handlers for /agents — list, create, reload.

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadAgentDefinitions, reloadAgentDefinitions, projectAgentsDir, type AgentDefinition } from '../agents/definitions.js';

export async function listAgentsMarkdown(cwd: string): Promise<string> {
  const defs = await loadAgentDefinitions(cwd);
  if (!defs.length) return '*(no agents defined)*';
  const rows = defs.map((d) => {
    const tools = Array.isArray(d.tools) ? `${d.tools.length} tools` : 'inherit';
    const src = d.source === 'builtin' ? 'built-in' : 'project';
    return `- **${d.name}** [${src}, ${d.model}, ${tools}, mode=${d.permissionMode}] — ${d.description}`;
  });
  return `**Subagents** (${defs.length})\n\n${rows.join('\n')}`;
}

export async function reloadAgentsMarkdown(cwd: string): Promise<string> {
  const r = await reloadAgentDefinitions(cwd);
  const lines: string[] = [`Reloaded. ${r.defs.length} agents available.`];
  if (r.added.length) lines.push(`+ added: ${r.added.join(', ')}`);
  if (r.removed.length) lines.push(`- removed: ${r.removed.join(', ')}`);
  if (r.changed.length) lines.push(`~ changed: ${r.changed.join(', ')}`);
  if (!r.added.length && !r.removed.length && !r.changed.length) lines.push('No changes.');
  return lines.join('\n');
}

export interface CreateAgentDraft {
  name: string;
  description: string;
  tools: string[] | 'inherit';
  permissionMode: 'plan' | 'agent' | 'yolo';
  systemPrompt: string;
}

export function renderAgentMarkdown(d: CreateAgentDraft): string {
  const toolsLine = d.tools === 'inherit' ? 'tools: inherit' : `tools:\n${d.tools.map((t) => `  - ${t}`).join('\n')}`;
  return `---
name: ${d.name}
description: ${d.description}
${toolsLine}
model: inherit
permissionMode: ${d.permissionMode}
---

${d.systemPrompt}
`;
}

export async function writeAgentFile(cwd: string, draft: CreateAgentDraft): Promise<string> {
  const dir = projectAgentsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const fp = join(dir, `${draft.name}.md`);
  if (existsSync(fp)) {
    throw new Error(`agent file already exists: ${fp}`);
  }
  await fs.writeFile(fp, renderAgentMarkdown(draft), 'utf8');
  return fp;
}

/** Used by App.tsx for the auto-generated draft. The model stays in charge; this is a fallback shape. */
export function defaultDraft(name: string, description: string): CreateAgentDraft {
  return {
    name,
    description,
    tools: 'inherit',
    permissionMode: 'agent',
    systemPrompt: `You are the ${name} subagent.\n\n${description}\n\nReply concisely.`,
  };
}

export type { AgentDefinition };
