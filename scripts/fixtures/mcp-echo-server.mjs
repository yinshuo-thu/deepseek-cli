#!/usr/bin/env node
// Minimal MCP server (stdio transport) exposing one tool: echo {message}.
// Implements: initialize, notifications/initialized, tools/list, tools/call.

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return;

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo-server', version: '0.0.1' },
      },
    });
    return;
  }
  if (msg.method === 'notifications/initialized') {
    return; // notification, no reply
  }
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes the provided message.',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
              required: ['message'],
            },
          },
        ],
      },
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `echo: ${args.message ?? ''}` }],
        },
      });
      return;
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32602, message: `unknown tool: ${name}` },
    });
    return;
  }
  // Unhandled method.
  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method: ${msg.method}` } });
  }
});
