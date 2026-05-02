// Skill = a reusable instruction snippet, frontmatter-defined, that can be
// triggered by a phrase in the user prompt. The triggered skill body becomes
// part of the system context for that turn-chain.

export interface SkillDefinition {
  name: string;
  description: string;
  /** Substrings (case-insensitive) and `imports X` style triggers. */
  triggers: string[];
  /** Optional whitelist of tool names — scopes the agent's available tools when this skill triggers. */
  allowedTools?: string[];
  body: string;
  source: 'project' | 'user';
  filePath: string;
  mtimeMs: number;
}
