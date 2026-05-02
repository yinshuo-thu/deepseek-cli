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
import type { PermissionMode } from '../config/index.js';

export const ALL_TOOLS: Tool[] = [
  ReadTool, WriteTool, EditTool, BashTool,
  GlobTool, GrepTool, ListDirTool,
  ApplyPatchTool, WebFetchTool, WebSearchTool,
  AgentTool, SendMessageTool, MonitorTool, TaskStopTool,
];

/**
 * The model-visible tool set depends on the permission mode.
 *  - plan : read-only (Read, Glob, Grep, list_dir, WebFetch, WebSearch) + agent control tools
 *  - agent: full toolbox
 *  - yolo : full toolbox (auto-approved at runtime)
 */
const READ_ONLY = new Set([
  'Read', 'Glob', 'Grep', 'list_dir', 'WebFetch', 'WebSearch',
  'Agent', 'SendMessage', 'Monitor', 'TaskStop',
]);

export function toolsForMode(mode: PermissionMode): Tool[] {
  if (mode === 'plan') return ALL_TOOLS.filter((t) => READ_ONLY.has(t.definition.function.name));
  return ALL_TOOLS;
}

export function toolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.definition.function.name === name);
}

export { markRead };
export type { Tool } from './types.js';
