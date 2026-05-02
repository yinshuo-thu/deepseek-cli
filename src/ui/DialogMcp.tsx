import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from './theme.js';

interface McpServer {
  name: string;
  transport: 'stdio' | 'sse';
  enabled: boolean;
  status?: string;
}

interface Props {
  servers: McpServer[];
  onToggle: (name: string, enabled: boolean) => void;
  onClose: () => void;
}

export function DialogMcp({ servers, onToggle, onClose }: Props) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(servers.length - 1, c + 1));
    } else if (input === ' ') {
      const server = servers[cursor];
      if (server) {
        onToggle(server.name, !server.enabled);
      }
    } else if (key.escape || input === 'q' || input === 'Q') {
      onClose();
    }
  });

  if (servers.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={palette.fgMuted} paddingX={1} marginY={1}>
        <Text color={palette.fgMuted}>No MCP servers configured.</Text>
        <Text color={palette.fgMuted} dimColor>Press esc or q to close.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.deepseekBlue} paddingX={1} marginY={1}>
      <Text color={palette.deepseekBlue} bold>
        MCP Servers{'  '}
        <Text color={palette.fgMuted}>(↑/↓ navigate · space toggle · esc/q close)</Text>
      </Text>
      {servers.map((server, i) => {
        const sel = i === cursor;
        const indicator = server.enabled ? '●' : '○';
        const indicatorColor = server.enabled ? palette.ok : palette.fgMuted;
        const statusText = server.status ?? (server.enabled ? 'enabled' : 'disabled');
        return (
          <Box key={server.name}>
            <Text color={sel ? palette.deepseekBlue : palette.fgMuted}>{sel ? '▸ ' : '  '}</Text>
            <Text color={indicatorColor}>{indicator}</Text>
            <Text>{' '}</Text>
            <Text color={sel ? palette.fg : palette.fgMuted}>
              {server.name.padEnd(24, ' ')}
            </Text>
            <Text color={palette.fgMuted}>{server.transport.padEnd(6, ' ')}</Text>
            <Text color={server.enabled ? palette.ok : palette.fgMuted}>{statusText}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
