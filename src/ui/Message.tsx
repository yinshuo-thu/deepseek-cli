import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { palette } from './theme.js';
import { renderMarkdown, preprocessLatex } from './markdown.js';

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

// Max lines shown for reasoning before collapsing. Reasoning can be hundreds
// of lines; collapsing keeps the scroll buffer manageable.
const MAX_REASONING_LINES = 12;

export function MessageView({ msg }: { msg: UIMessage }) {
  const color = ROLE_COLOR[msg.role];
  const label = ROLE_LABEL[msg.role];

  // ── Tool card ──────────────────────────────────────────────────────────
  if (msg.role === 'tool') {
    const statusGlyph = msg.toolStatus === 'pending' ? '·'
      : msg.toolStatus === 'err' ? '✗' : '✓';
    const statusColor = msg.toolStatus === 'err' ? palette.err
      : msg.toolStatus === 'pending' ? palette.tool : palette.ok;
    return (
      <Box flexDirection="column" marginY={0}>
        <Box>
          <Text color={statusColor}>{statusGlyph} </Text>
          <Text color={palette.tool} bold>{msg.toolName ?? 'tool'}</Text>
          {msg.pending && <Text color={palette.fgMuted}>  <Spinner type="dots" /></Text>}
        </Box>
        {msg.content && (
          <Box marginLeft={2}>
            <Text wrap="wrap" color={palette.fgMuted}>{msg.content}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── Reasoning / thinking block ─────────────────────────────────────────
  if (msg.role === 'reasoning') {
    const lines = msg.content.split('\n');
    const collapsed = !msg.pending && lines.length > MAX_REASONING_LINES;
    const displayContent = collapsed
      ? lines.slice(0, MAX_REASONING_LINES).join('\n')
      : msg.content;
    const hiddenCount = lines.length - MAX_REASONING_LINES;

    return (
      <Box flexDirection="column" marginY={0}>
        <Text color={palette.reasoning} dimColor italic>
          ⌁ thinking
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text wrap="wrap" color={palette.fgMuted} italic>{displayContent}</Text>
          {collapsed && (
            <Text color={palette.fgMuted} dimColor italic>
              … ({hiddenCount} more line{hiddenCount === 1 ? '' : 's'})
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  // ── User / assistant / system ──────────────────────────────────────────
  const isAssistant = msg.role === 'assistant';

  // User messages: apply LaTeX pre-processing so that math delimiters like
  // \(...\) are shown as backtick spans instead of raw backslash sequences.
  const displayContent = isAssistant
    ? renderMarkdown(msg.content || '').trimEnd()
    : preprocessLatex(msg.content || '');

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={color} bold>{label}</Text>
        {msg.pending && <Text color={palette.fgMuted}>  <Spinner type="dots" /></Text>}
      </Box>
      <Box marginLeft={2}>
        <Text wrap="wrap">{displayContent}</Text>
      </Box>
    </Box>
  );
}
