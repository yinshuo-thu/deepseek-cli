import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from './theme.js';

interface ModelEntry {
  id: string;
  description: string;
}

const MODELS: ModelEntry[] = [
  { id: 'deepseek-v4-flash',    description: 'Fast, cheap, default' },
  { id: 'deepseek-v4-pro',      description: 'Strongest reasoning' },
  { id: 'deepseek-reasoner',    description: 'Full thinking budget (chain-of-thought)' },
];

interface Props {
  currentModel: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}

export function DialogModel({ currentModel, onSelect, onClose }: Props) {
  const initialIndex = Math.max(0, MODELS.findIndex((m) => m.id === currentModel));
  const [cursor, setCursor] = useState(initialIndex);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(MODELS.length - 1, c + 1));
    } else if (key.return) {
      const model = MODELS[cursor];
      if (model) onSelect(model.id);
    } else if (key.escape) {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.deepseekBlue} paddingX={1} marginY={1}>
      <Text color={palette.deepseekBlue} bold>
        Select Model{'  '}
        <Text color={palette.fgMuted}>(↑/↓ navigate · enter select · esc cancel)</Text>
      </Text>
      {MODELS.map((model, i) => {
        const sel = i === cursor;
        const isCurrent = model.id === currentModel;
        return (
          <Box key={model.id}>
            <Text color={sel ? palette.deepseekBlue : palette.fgMuted}>{sel ? '▸ ' : '  '}</Text>
            <Text color={sel ? palette.fg : palette.fgMuted} bold={sel}>
              {model.id.padEnd(24, ' ')}
            </Text>
            <Text color={palette.fgMuted}>{model.description}</Text>
            {isCurrent && <Text color={palette.ok}>{'  '}(current)</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
