// Match SkillDefinitions against a user prompt + recent messages.
// Triggers: case-insensitive substring match, OR `imports X` regex
// (`\bimport[s]?\s+['"\s]?X`).

import type { SkillDefinition } from './types.js';

const MAX_MATCHES = 3;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function triggerMatches(trigger: string, haystack: string): boolean {
  const t = trigger.trim();
  if (!t) return false;
  const lower = haystack.toLowerCase();
  // Special form: `imports <X>` → look for `import[s]? <X>` patterns.
  const importMatch = t.match(/^imports?\s+(.+)$/i);
  if (importMatch) {
    const target = importMatch[1]!.trim();
    const re = new RegExp(`\\bimport[s]?\\s+['"\\s]?${escapeRegExp(target)}`, 'i');
    return re.test(haystack);
  }
  return lower.includes(t.toLowerCase());
}

export function matchSkills(skills: SkillDefinition[], prompt: string, recent?: string[]): SkillDefinition[] {
  const haystack = [prompt, ...(recent ?? [])].join('\n');
  const matched: { def: SkillDefinition; score: number }[] = [];
  for (const def of skills) {
    let hit = false;
    for (const t of def.triggers) {
      if (triggerMatches(t, haystack)) { hit = true; break; }
    }
    if (hit) matched.push({ def, score: def.description.length });
  }
  // Tie-break: longest description wins.
  matched.sort((a, b) => b.score - a.score);
  return matched.slice(0, MAX_MATCHES).map((m) => m.def);
}
