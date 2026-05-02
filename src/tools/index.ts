import type { Tool } from './types.js';
import { ReadTool } from './read.js';
import { WriteTool, markRead } from './write.js';
import { EditTool } from './edit.js';
import { BashTool } from './bash.js';

export const ALL_TOOLS: Tool[] = [ReadTool, WriteTool, EditTool, BashTool];

export function toolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.definition.function.name === name);
}

// Re-export hook used by Edit/Write to track Read-before-Write semantics.
export { markRead };
export type { Tool } from './types.js';
