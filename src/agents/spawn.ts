// Spawns a single subagent run. Foreground awaits completion; background
// returns immediately with the agent_id and a running status.

import { randomBytes } from 'node:crypto';
import type { ChatMessage } from '../api/types.js';
import type { Config } from '../config/index.js';
import { DeepSeekClient } from '../api/client.js';
import { ALL_TOOLS } from '../tools/index.js';
import type { Tool, ToolContext, AgentRuntime } from '../tools/types.js';
import { runAgentLoop } from './loop.js';
import { loadAgentDefinitions, type AgentDefinition } from './definitions.js';
import { agentRegistry, createInstance, makeRuntime, installExitHook } from './registry.js';
import { appendMessage, writeRecord, readRecord, readAgentMessages, type AgentRecord } from './persistence.js';
import { addWorktree, pruneWorktree, isWorktreeDirty } from './worktree.js';

export interface SpawnOptions {
  subagentType: string;
  prompt: string;
  runInBackground?: boolean;
  isolation?: 'none' | 'worktree';
  parentCtx: ToolContext;
}

export interface SpawnResult {
  agent_id: string;
  status: string;
  final_text?: string;
  worktree?: { path: string; branch: string; kept: boolean };
  error?: string;
}

export interface SpawnDeps {
  config: Config;
  /** Client used by spawned children. Shared across calls; we override `model` per request. */
  client: DeepSeekClient;
  /** cwd of the parent context — used as the default for `isolation: 'none'`. */
  cwd: string;
}

let sharedDeps: SpawnDeps | null = null;
export function configureSpawn(deps: SpawnDeps) {
  sharedDeps = deps;
  installExitHook(async (p) => { await pruneWorktree(p).catch(() => {}); });
}

function newAgentId(): string {
  return randomBytes(8).toString('hex');
}

function resolveTools(def: AgentDefinition, parent: ToolContext): Tool[] {
  if (def.tools === 'inherit') {
    // Mirror parent's permission tier. M3.0 keeps it simple: all tools available
    // to the child, modulo the child's own permissionMode filter.
    return ALL_TOOLS.slice();
  }
  const want = new Set(def.tools);
  const found: Tool[] = [];
  for (const t of ALL_TOOLS) {
    if (want.has(t.definition.function.name)) found.push(t);
  }
  // Drop unknown names with a warning (already filtered above).
  for (const w of want) {
    if (!ALL_TOOLS.some((t) => t.definition.function.name === w)) {
      console.warn(`[agents:${def.name}] unknown tool '${w}' — dropped`);
    }
  }
  return found;
}

function buildRuntime(): AgentRuntime {
  return makeRuntime(
    async (opts) => spawnAgent(opts),
    async (opts) => sendToAgent(opts),
  );
}

export async function spawnAgent(opts: SpawnOptions): Promise<SpawnResult> {
  if (!sharedDeps) throw new Error('agents/spawn: configureSpawn() not called');
  const { config, client, cwd: rootCwd } = sharedDeps;

  const parentDepth = opts.parentCtx.depth ?? 0;
  const depth = parentDepth + 1;
  const parentId = opts.parentCtx.agentId;

  const cap = agentRegistry.enforceCaps(parentId, depth);
  if (cap) {
    return { agent_id: '', status: 'error', error: cap };
  }

  const defs = await loadAgentDefinitions(rootCwd);
  const def = defs.find((d) => d.name === opts.subagentType);
  if (!def) {
    return { agent_id: '', status: 'error', error: `Unknown subagent_type '${opts.subagentType}'.` };
  }

  const id = newAgentId();
  const tools = resolveTools(def, opts.parentCtx);

  // Build child cwd — worktree or shared.
  let childCwd = rootCwd;
  let worktreeMeta: { path: string; branch: string; kept: boolean } | undefined;
  if (opts.isolation === 'worktree') {
    try {
      const wt = await addWorktree(rootCwd, id);
      childCwd = wt.path;
      worktreeMeta = { path: wt.path, branch: wt.branch, kept: false };
      agentRegistry.trackWorktree(wt.path);
    } catch (e) {
      return { agent_id: '', status: 'error', error: `worktree setup failed: ${(e as Error).message}` };
    }
  }

  // Resolve effective model.
  const effectiveModel = def.model === 'inherit' || !def.model ? config.model : def.model;

  const record: AgentRecord = {
    id,
    type: def.name,
    parent_id: parentId,
    started_at: Date.now(),
    status: 'running',
    cwd: childCwd,
    model: effectiveModel,
    tools: tools.map((t) => t.definition.function.name),
    permission_mode: def.permissionMode,
    message_count: 0,
    last_user_prompt: opts.prompt.slice(0, 200),
    ...(worktreeMeta ? { worktree: worktreeMeta } : {}),
  };

  const inst = createInstance(record, depth, parentId);
  agentRegistry.add(inst);

  // Seed messages: system prompt + user prompt.
  const systemPrompt = def.systemPrompt + `\n\nWorking directory: ${childCwd}.`;
  inst.messages.push({ role: 'system', content: systemPrompt });
  inst.messages.push({ role: 'user', content: opts.prompt });
  await appendMessage(rootCwd, id, inst.messages[0]!);
  await appendMessage(rootCwd, id, inst.messages[1]!);
  record.message_count = inst.messages.length;
  await writeRecord(record);

  const runtime = buildRuntime();

  const runOnce = async () => {
    let lastAssistantText = '';
    try {
      await runAgentLoop({
        client,
        messages: inst.messages,
        cwd: childCwd,
        model: effectiveModel,
        signal: inst.abort.signal,
        mode: def.permissionMode,
        availableTools: tools,
        agentId: id,
        parentId,
        depth,
        agentRuntime: runtime,
        onMessageAppended: async (m) => {
          record.message_count = inst.messages.length;
          if (m.role === 'assistant' && typeof m.content === 'string' && m.content) {
            lastAssistantText = m.content;
          }
          await appendMessage(rootCwd, id, m);
          await writeRecord(record);
        },
        cb: {
          onAssistantDelta: () => {/* tokens not streamed back to parent in M3 */},
          onReasoningDelta: () => {},
          onToolCallStart: (_id, name) => agentRegistry.pushRing(id, `[tool] ${name}`),
          onToolCallArgs: () => {},
          onToolCallReady: () => {},
          onToolResult: (_id, name, ok, summary) => {
            agentRegistry.pushRing(id, `  ${ok ? 'ok' : 'err'} ${name}: ${summary.slice(0, 120)}`);
          },
          onTurnEnd: () => agentRegistry.pushRing(id, '[turn end]'),
          onUsage: () => {},
          onError: (msg) => {
            agentRegistry.pushRing(id, `[error] ${msg}`);
            record.error = msg;
          },
          requestPermission: async (tool, summary) => {
            // Children inherit parent's permission UI when in 'agent' mode.
            // 'plan' children never invoke writeful tools so this rarely fires.
            // 'yolo' is auto-allowed by the loop itself.
            return opts.parentCtx.requestPermission(tool, `[${def.name}] ${summary}`);
          },
          log: (line) => agentRegistry.pushRing(id, line),
        },
      });
      record.status = inst.abort.signal.aborted ? 'stopped' : 'done';
      if (record.error) record.status = 'error';
      inst.finalText = lastAssistantText;
      record.final_text = lastAssistantText;
    } catch (e) {
      record.status = 'error';
      record.error = (e as Error).message;
    } finally {
      record.ended_at = Date.now();
      // Clean up worktree if isolation was used and it's clean.
      if (worktreeMeta) {
        try {
          const dirty = await isWorktreeDirty(worktreeMeta.path);
          if (dirty) {
            worktreeMeta.kept = true;
          } else {
            await pruneWorktree(worktreeMeta.path).catch(() => {});
            agentRegistry.untrackWorktree(worktreeMeta.path);
          }
          record.worktree = worktreeMeta;
        } catch {
          worktreeMeta.kept = true;
          record.worktree = worktreeMeta;
        }
      }
      await writeRecord(record);
      inst.resolveDone();
    }
  };

  if (opts.runInBackground) {
    void runOnce();
    return { agent_id: id, status: 'running' };
  }

  await runOnce();
  return {
    agent_id: id,
    status: record.status,
    final_text: inst.finalText,
    ...(record.error ? { error: record.error } : {}),
    ...(worktreeMeta ? { worktree: worktreeMeta } : {}),
  };
}

export async function sendToAgent(opts: { agentId: string; prompt: string; runInBackground?: boolean; parentCtx: ToolContext }): Promise<SpawnResult> {
  if (!sharedDeps) throw new Error('agents/spawn: configureSpawn() not called');
  const { config, client, cwd: rootCwd } = sharedDeps;

  let inst = agentRegistry.get(opts.agentId);
  if (!inst) {
    // Try to restore from disk.
    const rec = await readRecord(rootCwd, opts.agentId);
    if (!rec) return { agent_id: opts.agentId, status: 'error', error: 'agent not found' };
    if (rec.status === 'stopped' || rec.status === 'error') {
      return { agent_id: opts.agentId, status: rec.status, error: rec.error ?? 'agent not resumable' };
    }
    const msgs = await readAgentMessages(rootCwd, opts.agentId);
    inst = createInstance(rec, opts.parentCtx.depth ?? 0, rec.parent_id);
    inst.messages = msgs;
    agentRegistry.add(inst);
  }

  if (inst.record.status === 'stopped' || inst.record.status === 'error') {
    return { agent_id: opts.agentId, status: inst.record.status, error: inst.record.error };
  }

  const defs = await loadAgentDefinitions(rootCwd);
  const def = defs.find((d) => d.name === inst!.record.type) ?? defs.find((d) => d.name === 'general-purpose')!;
  const tools = resolveTools(def, opts.parentCtx);

  const userMsg: ChatMessage = { role: 'user', content: opts.prompt };
  inst.messages.push(userMsg);
  inst.record.last_user_prompt = opts.prompt.slice(0, 200);
  inst.record.status = 'running';
  inst.record.error = undefined;
  await appendMessage(rootCwd, opts.agentId, userMsg);
  await writeRecord(inst.record);

  // Reset abort.
  inst.abort = new AbortController();
  const runtime = buildRuntime();
  let lastAssistantText = '';

  const runOnce = async () => {
    try {
      await runAgentLoop({
        client,
        messages: inst!.messages,
        cwd: inst!.record.cwd,
        model: inst!.record.model || config.model,
        signal: inst!.abort.signal,
        mode: def.permissionMode,
        availableTools: tools,
        agentId: opts.agentId,
        parentId: inst!.parentId,
        depth: inst!.depth,
        agentRuntime: runtime,
        onMessageAppended: async (m) => {
          inst!.record.message_count = inst!.messages.length;
          if (m.role === 'assistant' && typeof m.content === 'string' && m.content) {
            lastAssistantText = m.content;
          }
          await appendMessage(rootCwd, opts.agentId, m);
          await writeRecord(inst!.record);
        },
        cb: {
          onAssistantDelta: () => {},
          onReasoningDelta: () => {},
          onToolCallStart: (_id, name) => agentRegistry.pushRing(opts.agentId, `[tool] ${name}`),
          onToolCallArgs: () => {},
          onToolCallReady: () => {},
          onToolResult: (_id, name, ok, summary) => {
            agentRegistry.pushRing(opts.agentId, `  ${ok ? 'ok' : 'err'} ${name}: ${summary.slice(0, 120)}`);
          },
          onTurnEnd: () => agentRegistry.pushRing(opts.agentId, '[turn end]'),
          onUsage: () => {},
          onError: (msg) => {
            agentRegistry.pushRing(opts.agentId, `[error] ${msg}`);
            inst!.record.error = msg;
          },
          requestPermission: async (tool, summary) => opts.parentCtx.requestPermission(tool, `[${def.name}] ${summary}`),
          log: (line) => agentRegistry.pushRing(opts.agentId, line),
        },
      });
      inst!.record.status = inst!.abort.signal.aborted ? 'stopped' : 'done';
      if (inst!.record.error) inst!.record.status = 'error';
      inst!.finalText = lastAssistantText;
      inst!.record.final_text = lastAssistantText;
    } catch (e) {
      inst!.record.status = 'error';
      inst!.record.error = (e as Error).message;
    } finally {
      inst!.record.ended_at = Date.now();
      await writeRecord(inst!.record);
    }
  };

  if (opts.runInBackground) {
    void runOnce();
    return { agent_id: opts.agentId, status: 'running' };
  }
  await runOnce();
  return {
    agent_id: opts.agentId,
    status: inst.record.status,
    final_text: inst.finalText,
    ...(inst.record.error ? { error: inst.record.error } : {}),
  };
}
