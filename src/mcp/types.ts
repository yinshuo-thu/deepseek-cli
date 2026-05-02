// MCP (Model Context Protocol) types — only the subset we implement.
// We support tool discovery + tool calls over stdio and SSE. Prompts,
// resources, sampling are out of scope for v1.

export interface MCPStdioConfig {
  transport?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

export interface MCPSseConfig {
  transport: 'sse';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

export type MCPServerConfig = MCPStdioConfig | MCPSseConfig;

export interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string; [k: string]: unknown }>;
  isError?: boolean;
}

export type MCPClientStatus = 'connecting' | 'ready' | 'reconnecting' | 'failed' | 'disabled';

export interface MCPTransport {
  start(): Promise<void>;
  send(line: string): void;
  close(): Promise<void>;
  onLine(handler: (line: string) => void): void;
  onClose(handler: (err?: Error) => void): void;
}
