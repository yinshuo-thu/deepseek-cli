import React, { useRef } from 'react';
import { Box, Text } from 'ink';
import { palette } from './theme.js';
import type { PermissionMode } from '../config/index.js';
import { type ActivityPhase, verbForPhase } from './statusVerbs.js';

interface Props {
  model: string;
  cwd: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  busy: boolean;
  activity: ActivityPhase | null; // current phase, null when idle
  mode: PermissionMode;
  reasoningEffort: 'off' | 'high' | 'max';
  termCols: number;
}

const MODE_COLOR: Record<PermissionMode, string> = {
  plan: palette.warn,
  acceptEdits: palette.fgMuted,
  agent: palette.deepseekBlue,
  yolo: palette.err,
  default: palette.deepseekBlue,
};

const MODE_LABEL: Record<PermissionMode, string> = {
  plan: 'plan',
  acceptEdits: 'accept-edits',
  agent: 'agent',
  yolo: 'yolo',
  default: 'agent',
};

export function StatusBar({ model, cwd, inputTokens, outputTokens, costUSD, busy, activity, mode, reasoningEffort, termCols }: Props) {
  // Pick a verb once per phase transition, not on a timer.
  // useRef so re-renders don't re-pick; resets when activity changes.
  const lastActivity = useRef<ActivityPhase | null>(null);
  const verbRef = useRef<string>('Working');

  if (activity !== lastActivity.current) {
    lastActivity.current = activity;
    verbRef.current = verbForPhase(activity ?? 'working');
  }

  const statusVerb = verbRef.current;

  const right = `↑${inputTokens}  ↓${outputTokens}   $${costUSD.toFixed(4)}   ${MODE_LABEL[mode]}${reasoningEffort !== 'off' ? `·${reasoningEffort}` : ''}${busy ? `  · ${statusVerb}…` : ''}`;
  const rightLen = right.length;

  const cwdShort = shortenPath(cwd);
  const dotModel = `● ${model}`;
  const sep = '   ·   ';
  const leftFull = `${dotModel}${sep}${cwdShort}`;

  const budget = Math.max(20, termCols - 4 - 2 - rightLen);
  const left = leftFull.length > budget ? leftFull.slice(0, budget - 1) + '…' : leftFull;
  const pad = ' '.repeat(Math.max(1, termCols - 4 - left.length - rightLen));

  return (
    <Box marginTop={1} paddingX={1} borderStyle="round" borderColor={palette.deepseekBlueDim}>
      <Text>
        <Text color={palette.deepseekBlue}>● </Text>
        <Text color={palette.fg}>{model}</Text>
        <Text color={palette.fgMuted}>{sep}</Text>
        <Text color={palette.fgMuted}>{truncateLeft(cwdShort, budget - dotModel.length - sep.length)}</Text>
        <Text>{pad}</Text>
        <Text color={palette.fgMuted}>↑</Text>
        <Text color={palette.fg}>{inputTokens}</Text>
        <Text color={palette.fgMuted}>  ↓</Text>
        <Text color={palette.fg}>{outputTokens}</Text>
        <Text color={palette.fgMuted}>   </Text>
        <Text color={palette.fg}>${costUSD.toFixed(4)}</Text>
        <Text color={palette.fgMuted}>   </Text>
        <Text color={MODE_COLOR[mode]} bold>{MODE_LABEL[mode]}</Text>
        {reasoningEffort !== 'off' && (
          <>
            <Text color={palette.fgMuted}>·</Text>
            <Text color={palette.reasoning}>{reasoningEffort}</Text>
          </>
        )}
        {busy && <Text color={palette.warn}>  · {statusVerb}…</Text>}
      </Text>
    </Box>
  );
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

function truncateLeft(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - max + 1);
}
