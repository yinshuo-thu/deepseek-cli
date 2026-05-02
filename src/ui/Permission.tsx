import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from './theme.js';

export type PermissionDecision = 'once' | 'always' | 'deny';

interface Props {
  toolName: string;
  summary: string;
  onResolve: (d: PermissionDecision) => void;
}

export function PermissionPrompt({ toolName, summary, onResolve }: Props) {
  useInput((input) => {
    const k = input.toLowerCase();
    if (k === 'y' || k === '1') onResolve('once');
    else if (k === 'a' || k === '2') onResolve('always');
    else if (k === 'n' || k === '3' || k === 'd') onResolve('deny');
  });

  // Safety: also resolve on Ctrl+C with deny (Ink's exit handler runs after).
  useEffect(() => () => undefined, []);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.warn} paddingX={1} marginY={1}>
      <Text>
        <Text color={palette.warn} bold>permission required </Text>
        <Text color={palette.fgMuted}>· tool: </Text>
        <Text color={palette.tool} bold>{toolName}</Text>
      </Text>
      <Box marginLeft={2} flexDirection="column" marginY={0}>
        {summary.split('\n').map((ln, i) => (
          <Text key={i} color={palette.fg}>{ln}</Text>
        ))}
      </Box>
      <Text color={palette.fgMuted}>
        <Text color={palette.fg}>y</Text> allow once  ·  <Text color={palette.fg}>a</Text> allow always for this session  ·  <Text color={palette.fg}>n</Text> deny
      </Text>
    </Box>
  );
}
