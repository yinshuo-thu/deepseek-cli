// OpenAI-compatible message + tool-call shapes used by DeepSeek's /chat/completions.

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  name?: string;            // for role==='tool', the tool/function name
  tool_call_id?: string;    // for role==='tool'
  tool_calls?: ToolCall[];  // for role==='assistant'
  // DeepSeek-specific: chain-of-thought from `deepseek-reasoner`.
  reasoning_content?: string | null;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: true;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required';
  temperature?: number;
  max_tokens?: number;
}

export interface UsageDelta {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

// One streaming event we emit upward — model-agnostic.
export type StreamEvent =
  | { kind: 'content'; delta: string }
  | { kind: 'reasoning'; delta: string }
  | { kind: 'tool_call_start'; id: string; name: string; index: number }
  | { kind: 'tool_call_args'; index: number; argsDelta: string }
  | { kind: 'tool_call_end'; index: number }
  | { kind: 'usage'; usage: UsageDelta }
  | { kind: 'done'; finishReason: string }
  | { kind: 'error'; message: string };
