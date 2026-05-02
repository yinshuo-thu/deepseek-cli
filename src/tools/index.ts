import type { Tool } from './types.js';
import { ReadTool } from './read.js';
import { WriteTool, markRead } from './write.js';
import { EditTool } from './edit.js';
import { BashTool } from './bash.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { ListDirTool } from './list_dir.js';
import { WebFetchTool } from './web_fetch.js';
import { WebSearchTool } from './web_search.js';
import { ApplyPatchTool } from './apply_patch.js';
import { AgentTool } from './agent.js';
import { SendMessageTool } from './send_message.js';
import { MonitorTool } from './monitor.js';
import { TaskStopTool } from './task_stop.js';
import { SkillTool } from './skill.js';
import type { PermissionMode } from '../config/index.js';

const BUILTINS: Tool[] = [
  ReadTool, WriteTool, EditTool, BashTool,
  GlobTool, GrepTool, ListDirTool,
  ApplyPatchTool, WebFetchTool, WebSearchTool,
  AgentTool, SendMessageTool, MonitorTool, TaskStopTool,
  SkillTool,
];

/**
 * Extra dynamic tools (currently MCP) registered at runtime. The MCP registry
 * sets this at boot. Kept as a mutable holder to avoid an import cycle
 * between `tools/` and `mcp/`.
 */
let extraTools: () => Tool[] = () => [];
export function setExtraToolsProvider(fn: () => Tool[]): void {
  extraTools = fn;
}

/** All tools the agent can see right now (built-ins + MCP). */
export function allTools(): Tool[] {
  return [...BUILTINS, ...extraTools()];
}

/** Static snapshot of built-ins — used by tests and callers that want the stable list. */
export const ALL_TOOLS: Tool[] = BUILTINS;

/**
 * The model-visible tool set depends on the permission mode.
 *  - plan : read-only (Read, Glob, Grep, list_dir, WebFetch, WebSearch) + agent control tools
 *  - agent: full toolbox
 *  - yolo : full toolbox (auto-approved at runtime)
 */
const READ_ONLY = new Set([
  'Read', 'Glob', 'Grep', 'list_dir', 'WebFetch', 'WebSearch',
  'Agent', 'SendMessage', 'Monitor', 'TaskStop',
  'Skill',
]);

const ACCEPT_EDITS = new Set([
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'list_dir', 'WebFetch', 'WebSearch',
  'Agent', 'SendMessage', 'Monitor', 'TaskStop', 'Skill', 'apply_patch',
]);

export function toolsForMode(mode: PermissionMode): Tool[] {
  const merged = allTools();
  if (mode === 'plan') return merged.filter((t) => READ_ONLY.has(t.definition.function.name));
  if (mode === 'acceptEdits') return merged.filter((t) => ACCEPT_EDITS.has(t.definition.function.name));
  return merged; // agent, yolo, default
}

export function toolByName(name: string): Tool | undefined {
  return allTools().find((t) => t.definition.function.name === name);
}

export { markRead };
export type { Tool } from './types.js';
