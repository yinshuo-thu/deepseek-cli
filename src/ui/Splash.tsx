import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './theme.js';
import { WHALE_ART, WHALE_ART_COMPACT } from './whale.js';

interface Props {
  version: string;
  model: string;
  cwd: string;
  termCols: number;
}

export function Splash({ version, model, cwd, termCols }: Props) {
  const art = termCols >= 70 ? WHALE_ART : WHALE_ART_COMPACT;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={palette.deepseekBlue}>{art}</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>
          <Text bold color={palette.deepseekBlue}>DeepSeek-CLI </Text>
          <Text color={palette.fgMuted}>v{version}</Text>
        </Text>
        <Text color={palette.fgMuted}>
          model <Text color={palette.fg}>{model}</Text>   ·   cwd <Text color={palette.fg}>{shortenCwd(cwd)}</Text>
        </Text>
        <Text color={palette.fgMuted}>
          Type <Text color={palette.fg}>/help</Text> for commands · <Text color={palette.fg}>Tab</Text> cycles plan/agent/yolo · <Text color={palette.fg}>Shift+Tab</Text> reasoning · <Text color={palette.fg}>Esc</Text> cancels
        </Text>
      </Box>
    </Box>
  );
}

function shortenCwd(p: string): string {
  const home = process.env.HOME ?? '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}
