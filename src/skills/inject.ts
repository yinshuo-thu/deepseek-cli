// Skill injection: turn a triggered SkillDefinition into a `<skill name="X">…</skill>`
// system message. Per-session inject-once tracking — once a skill body has
// been added to a session, we don't re-add it.

import type { ChatMessage } from '../api/types.js';
import { loadSkills } from './loader.js';
import { matchSkills } from './triggers.js';
import type { SkillDefinition } from './types.js';

export interface InjectionState {
  injected: Set<string>;          // skill names already injected this session
}

export function newInjectionState(): InjectionState {
  return { injected: new Set() };
}

export function formatInjectedSystem(def: SkillDefinition): ChatMessage {
  const xml = `<skill name="${def.name}">\n${def.body}\n</skill>`;
  return { role: 'system', content: xml };
}

/** Reset the injected set — called on /clear, /resume, /compact. */
export function clearInjections(state: InjectionState) {
  state.injected.clear();
}

export function markInjected(state: InjectionState, name: string) {
  state.injected.add(name);
}

/**
 * Match skills against a user prompt and return new injections (skills not
 * yet injected this session). Caller is responsible for `markInjected()`-ing
 * the ones it actually adds.
 */
export async function pickSkillsToInject(opts: {
  cwd: string;
  prompt: string;
  recent?: string[];
  state: InjectionState;
}): Promise<SkillDefinition[]> {
  const all = await loadSkills(opts.cwd);
  const matched = matchSkills(all, opts.prompt, opts.recent);
  return matched.filter((d) => !opts.state.injected.has(d.name));
}
