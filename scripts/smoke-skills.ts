#!/usr/bin/env node
// Skills smoke. Writes a fixture skill that triggers on "foobar-magic", runs
// the matcher pipeline against a prompt, asserts the skill matched and that
// formatInjectedSystem produces a `<skill name="...">…</skill>` system message.
// Then verifies inject-once behaviour and the explicit Skill tool.

import { promises as fs, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkills, clearSkillCache } from '../src/skills/loader.js';
import { matchSkills } from '../src/skills/triggers.js';
import { newInjectionState, pickSkillsToInject, formatInjectedSystem, markInjected } from '../src/skills/inject.js';
import { SkillTool } from '../src/tools/skill.js';
import type { ToolContext } from '../src/tools/types.js';

const tmp = join(tmpdir(), `ds-smoke-skills-${Date.now().toString(36)}`);
mkdirSync(join(tmp, '.deepseek', 'skills', 'foo'), { recursive: true });
const skillFp = join(tmp, '.deepseek', 'skills', 'foo', 'SKILL.md');
await fs.writeFile(skillFp, `---
name: foo
description: Use this when the user asks for foobar-magic.
trigger:
  - foobar-magic
allowed-tools:
  - Read
  - Bash
---

When the user asks for foobar-magic, do the following:
1. Cast the spell.
2. Return success.
`);

console.log('[1] loadSkills picks up the fixture');
clearSkillCache(tmp);
const all = await loadSkills(tmp);
if (all.length !== 1) { console.error(`! expected 1 skill, got ${all.length}`); process.exit(2); }
if (all[0]!.name !== 'foo') { console.error(`! expected name=foo, got ${all[0]!.name}`); process.exit(3); }
if (!all[0]!.allowedTools || all[0]!.allowedTools.length !== 2) { console.error(`! allowedTools mismatch: ${JSON.stringify(all[0]!.allowedTools)}`); process.exit(4); }
console.log(`  ok — ${all[0]!.name} triggers=${JSON.stringify(all[0]!.triggers)}`);

console.log('[2] matchSkills picks the skill on a triggering prompt');
const matched = matchSkills(all, 'please do some foobar-magic for me');
if (matched.length !== 1) { console.error(`! expected 1 match, got ${matched.length}`); process.exit(5); }
console.log('  ok — matched');

console.log('[3] no match for unrelated prompt');
const notMatched = matchSkills(all, 'just say hi');
if (notMatched.length !== 0) { console.error(`! expected 0, got ${notMatched.length}`); process.exit(6); }
console.log('  ok — no false positive');

console.log('[4] formatInjectedSystem wraps the body');
const sys = formatInjectedSystem(matched[0]!);
if (sys.role !== 'system') { console.error('! expected role=system'); process.exit(7); }
const content = String(sys.content ?? '');
if (!content.startsWith('<skill name="foo">')) { console.error(`! unexpected content prefix: ${content.slice(0, 40)}`); process.exit(8); }
if (!content.includes('Cast the spell.')) { console.error('! body missing'); process.exit(9); }
if (!content.endsWith('</skill>')) { console.error('! missing close tag'); process.exit(10); }
console.log('  ok — wrapped');

console.log('[5] pickSkillsToInject + inject-once');
const state = newInjectionState();
const first = await pickSkillsToInject({ cwd: tmp, prompt: 'foobar-magic please', state });
if (first.length !== 1) { console.error(`! first pick should return 1, got ${first.length}`); process.exit(11); }
markInjected(state, first[0]!.name);
const second = await pickSkillsToInject({ cwd: tmp, prompt: 'foobar-magic again', state });
if (second.length !== 0) { console.error(`! second pick should return 0 (already injected), got ${second.length}`); process.exit(12); }
console.log('  ok — inject-once');

console.log('[6] explicit Skill tool returns body');
const ctx: ToolContext = {
  cwd: tmp,
  log: () => {},
  async requestPermission() { return 'always'; },
};
const r = await SkillTool.run({ name: 'foo' }, ctx);
if (!r.ok) { console.error(`! tool failed: ${r.content}`); process.exit(13); }
if (!r.content.includes('Cast the spell.')) { console.error('! tool result missing body'); process.exit(14); }
if (!r.content.includes('Read, Bash')) { console.error('! tool result missing allowed-tools note'); process.exit(15); }
console.log('  ok — Skill tool returns body');

console.log('— smoke:skills ok');
