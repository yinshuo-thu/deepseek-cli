// One canonical verb per activity phase — chosen by what's actually happening,
// not a timer. Simple, honest, readable.

export type ActivityPhase =
  | 'thinking'      // model streaming before any tool
  | 'reasoning'     // extended reasoning / deepseek-reasoner
  | 'reading'       // Read, Glob, TodoRead
  | 'searching'     // Grep, WebSearch
  | 'writing'       // Write
  | 'editing'       // Edit, MultiEdit, NotebookEdit
  | 'running'       // Bash
  | 'fetching'      // WebFetch
  | 'orchestrating' // Agent, Task (spawning subagent)
  | 'planning'      // TodoWrite
  | 'working';      // fallback

// Single deterministic verb per phase — no random selection.
const PHASE_VERB: Record<ActivityPhase, string> = {
  thinking:      'Thinking',
  reasoning:     'Reasoning',
  reading:       'Reading',
  searching:     'Searching',
  writing:       'Writing',
  editing:       'Editing',
  running:       'Running',
  fetching:      'Fetching',
  orchestrating: 'Orchestrating',
  planning:      'Planning',
  working:       'Working',
};

// Map tool names to phases.
const TOOL_PHASE: Record<string, ActivityPhase> = {
  Read:         'reading',
  Glob:         'reading',
  TodoRead:     'reading',
  Grep:         'searching',
  WebSearch:    'searching',
  Write:        'writing',
  Edit:         'editing',
  MultiEdit:    'editing',
  NotebookEdit: 'editing',
  Bash:         'running',
  WebFetch:     'fetching',
  Agent:        'orchestrating',
  Task:         'orchestrating',
  TodoWrite:    'planning',
};

export function phaseFromTool(toolName: string): ActivityPhase {
  return TOOL_PHASE[toolName] ?? 'working';
}

export function verbForPhase(phase: ActivityPhase): string {
  return PHASE_VERB[phase];
}
