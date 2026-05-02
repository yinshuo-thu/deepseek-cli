import React from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from './theme.js';

interface Props {
  toolName: string;
  onResolve: (action: 'exit-plan' | 'cancel') => void;
}

export function ExitPlanModePrompt({ toolName, onResolve }: Props) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') onResolve('exit-plan');
    else if (input === 'n' || input === 'N' || key.escape) onResolve('cancel');
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.deepseekBlue} paddingX={1} marginY={1}>
      <Text bold color={palette.deepseekBlue}>Plan Mode — write tool requested</Text>
      <Text>The model wants to run <Text bold color="yellow">{toolName}</Text>, which is blocked in plan mode.</Text>
      <Text color={palette.fgMuted}>Press <Text bold color="green">y</Text> to exit plan mode and allow  ·  <Text bold color="red">n</Text> / Esc to cancel</Text>
    </Box>
  );
}
