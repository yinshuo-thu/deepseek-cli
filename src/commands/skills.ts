// Slash command handlers for /skills.

import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkills, projectSkillsDir, reloadSkills } from '../skills/loader.js';

export async function listSkillsMarkdown(cwd: string): Promise<string> {
  const defs = await loadSkills(cwd);
  if (!defs.length) return '*(no skills defined)*';
  const rows = defs.map((d) => {
    const t = d.triggers.length ? ` triggers=[${d.triggers.join(', ')}]` : '';
    return `- **${d.name}** [${d.source}]${t} — ${d.description}`;
  });
  return `**Skills** (${defs.length})\n\n${rows.join('\n')}`;
}

export async function reloadSkillsMarkdown(cwd: string): Promise<string> {
  const r = await reloadSkills(cwd);
  const lines = [`Reloaded. ${r.defs.length} skills available.`];
  if (r.added.length) lines.push(`+ added: ${r.added.join(', ')}`);
  if (r.removed.length) lines.push(`- removed: ${r.removed.join(', ')}`);
  if (r.changed.length) lines.push(`~ changed: ${r.changed.join(', ')}`);
  if (!r.added.length && !r.removed.length && !r.changed.length) lines.push('No changes.');
  return lines.join('\n');
}

export async function addSkillMarkdown(cwd: string, name: string): Promise<string> {
  const safeName = name.replace(/[^A-Za-z0-9_-]/g, '-');
  if (!safeName) return 'error: invalid skill name.';
  const dir = join(projectSkillsDir(cwd), safeName);
  if (existsSync(dir)) return `error: skill directory already exists: \`${dir}\``;
  await fs.mkdir(dir, { recursive: true });
  const fp = join(dir, 'SKILL.md');
  const stub = `---
name: ${safeName}
description: TODO — describe when to use this skill.
trigger:
  - ${safeName}
---

TODO: skill body. The model will see this when a trigger matches.
`;
  await fs.writeFile(fp, stub, 'utf8');
  return `Created stub skill at \`${fp}\`. Edit it, then run \`/skills reload\`.`;
}
