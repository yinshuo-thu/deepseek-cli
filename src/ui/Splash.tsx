import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './theme.js';
import { WHALE_ART } from './whale.js';

interface Props {
  version: string;
  model: string;
  cwd: string;
}

export function Splash({ version, model, cwd }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={palette.deepseekBlue}>{WHALE_ART}</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text color={palette.fg}>
          <Text bold color={palette.deepseekBlue}>DeepSeek-CLI </Text>
          <Text color={palette.fgMuted}>v{version}</Text>
        </Text>
        <Text color={palette.fgMuted}>
          model: <Text color={palette.fg}>{model}</Text>   ·   cwd: <Text color={palette.fg}>{cwd}</Text>
        </Text>
        <Text color={palette.fgMuted}>
          Type <Text color={palette.fg}>/help</Text> for commands. <Text color={palette.fg}>Esc</Text> to cancel a stream. <Text color={palette.fg}>Ctrl+C</Text> twice to exit.
        </Text>
      </Box>
    </Box>
  );
}
