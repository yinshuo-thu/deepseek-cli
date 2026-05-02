import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './theme.js';

interface Props {
  model: string;
  cwd: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  busy: boolean;
}

export function StatusBar({ model, cwd, inputTokens, outputTokens, costUSD, busy }: Props) {
  const cwdShort = cwd.replace(process.env.HOME ?? '', '~');
  return (
    <Box marginTop={1} paddingX={1} borderStyle="round" borderColor={palette.deepseekBlueDim}>
      <Box flexGrow={1}>
        <Text color={palette.fgMuted}>
          <Text color={palette.deepseekBlue}>● </Text>
          {model}  ·  {cwdShort}
        </Text>
      </Box>
      <Box>
        <Text color={palette.fgMuted}>
          tokens <Text color={palette.fg}>{inputTokens}/{outputTokens}</Text>  ·  cost <Text color={palette.fg}>${costUSD.toFixed(4)}</Text>
          {busy ? '  · ' : ''}{busy && <Text color={palette.warn}>working…</Text>}
        </Text>
      </Box>
    </Box>
  );
}
