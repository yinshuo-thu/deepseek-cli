import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { palette } from './theme.js';
import { renderMarkdown } from './markdown.js';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'reasoning';
  content: string;
  toolName?: string;
  toolStatus?: 'pending' | 'ok' | 'err';
  pending?: boolean;
}

const ROLE_LABEL: Record<UIMessage['role'], string> = {
  user: 'you',
  assistant: 'deepseek',
  system: 'system',
  tool: 'tool',
  reasoning: 'thinking',
};

const ROLE_COLOR: Record<UIMessage['role'], string> = {
  user: palette.user,
  assistant: palette.assistant,
  system: palette.system,
  tool: palette.tool,
  reasoning: palette.reasoning,
};

export function MessageView({ msg }: { msg: UIMessage }) {
  const color = ROLE_COLOR[msg.role];
  const label = ROLE_LABEL[msg.role];

  if (msg.role === 'tool') {
    const statusGlyph = msg.toolStatus === 'pending' ? '·' : msg.toolStatus === 'err' ? '✗' : '✓';
    const statusColor = msg.toolStatus === 'err' ? palette.err : msg.toolStatus === 'pending' ? palette.tool : palette.ok;
    return (
      <Box flexDirection="column" marginY={0}>
        <Box>
          <Text color={statusColor}>{statusGlyph} </Text>
          <Text color={palette.tool} bold>{msg.toolName ?? 'tool'}</Text>
          {msg.pending && <Text color={palette.fgMuted}>  <Spinner type="dots" /></Text>}
        </Box>
        {msg.content && (
          <Box marginLeft={2}>
            <Text color={palette.fgMuted}>{msg.content}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (msg.role === 'reasoning') {
    return (
      <Box flexDirection="column" marginY={0}>
        <Text color={palette.reasoning} dimColor italic>
          ⌁ thinking
        </Text>
        <Box marginLeft={2}>
          <Text color={palette.fgMuted} italic>{msg.content}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={color} bold>{label}</Text>
        {msg.pending && <Text color={palette.fgMuted}>  <Spinner type="dots" /></Text>}
      </Box>
      <Box marginLeft={2}>
        <Text>{msg.role === 'assistant' ? renderMarkdown(msg.content || '').trimEnd() : msg.content}</Text>
      </Box>
    </Box>
  );
}
