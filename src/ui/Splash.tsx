import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { userInfo } from 'node:os';
import { palette } from './theme.js';
import { WHALE_ART, WHALE_ART_COMPACT } from './whale.js';
import { listSessions, type SessionMeta } from '../session/history.js';

interface Props {
  version: string;
  model: string;
  cwd: string;
  termCols: number;
}

// Custom dashed border: tries to evoke the Claude Code splash look.
const DASHED_BORDER = {
  topLeft: '.',
  top: '-',
  topRight: '.',
  left: ' ',
  right: ' ',
  bottomLeft: "'",
  bottom: '-',
  bottomRight: "'",
} as const;

const WHATS_NEW = [
  '/login to authorize via DeepSeek web',
  '/mode plan|agent|yolo (Tab cycles)',
  '/reasoning off|high|max (Shift+Tab)',
  'apply_patch for multi-hunk diffs',
];

export function Splash({ version, model, cwd, termCols }: Props) {
  const [recent, setRecent] = useState<SessionMeta[]>([]);
  useEffect(() => {
    listSessions(cwd, 4).then(setRecent).catch(() => setRecent([]));
  }, [cwd]);

  const cwdShort = shortenCwd(cwd);
  const username = safeUsername();

  // Two-pane splash needs ~104 cols (left 58 + gap 1 + right 44 + outer padding).
  // Anything narrower falls back to single column with the compact whale.
  if (termCols < 104) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={palette.deepseekBlue}>{WHALE_ART_COMPACT}</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>
            <Text bold color={palette.deepseekBlue}>DeepSeek-CLI </Text>
            <Text color={palette.fgMuted}>v{version}</Text>
          </Text>
          <Text color={palette.fgMuted}>
            model <Text color={palette.fg}>{model}</Text>   ·   cwd <Text color={palette.fg}>{cwdShort}</Text>
          </Text>
          <Text color={palette.fgMuted}>
            <Text color={palette.fg}>/help</Text> for commands · <Text color={palette.fg}>Tab</Text> mode · <Text color={palette.fg}>Shift+Tab</Text> reasoning · <Text color={palette.fg}>Esc</Text> cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // Wide terminal → two-pane Claude-Code-style splash.
  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* Left brand pane */}
      <Box
        flexDirection="column"
        borderStyle={DASHED_BORDER}
        borderColor={palette.deepseekBlueDim}
        paddingX={2}
        width={58}
      >
        <Text color={palette.deepseekBlue}>—— DeepSeek-CLI v{version} ——</Text>
        <Box marginTop={1}>
          <Text>Welcome back, <Text bold>{username}</Text>!</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={palette.deepseekBlue}>{WHALE_ART.replace(/^\n/, '').replace(/\n$/, '')}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold>{model}</Text>
            <Text color={palette.fgMuted}>  ·  {humanCost()}</Text>
          </Text>
          <Text color={palette.fgMuted}>{cwdShort}</Text>
        </Box>
      </Box>

      {/* Right info column */}
      <Box flexDirection="column" marginLeft={1}>
        <Box
          flexDirection="column"
          borderStyle={DASHED_BORDER}
          borderColor={palette.deepseekBlueDim}
          paddingX={2}
          width={44}
        >
          <Text color={palette.deepseekBlue}>Recent activity</Text>
          {recent.length === 0 ? (
            <Text color={palette.fgMuted}>(no previous sessions)</Text>
          ) : (
            recent.map((s) => (
              <Text key={s.id}>
                <Text color={palette.fgMuted}>{relativeTime(s.updatedAt).padEnd(7)}</Text>
                <Text>{(s.firstUserPrompt ?? '<no prompt>').slice(0, 28)}</Text>
              </Text>
            ))
          )}
          {recent.length >= 4 && (
            <Text color={palette.fgMuted}>… /resume for more</Text>
          )}
        </Box>
        <Box
          flexDirection="column"
          borderStyle={DASHED_BORDER}
          borderColor={palette.deepseekBlueDim}
          paddingX={2}
          width={44}
        >
          <Text color={palette.deepseekBlue}>What's new</Text>
          {WHATS_NEW.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
          <Text color={palette.fgMuted}>… /help for more</Text>
        </Box>
      </Box>
    </Box>
  );
}

function shortenCwd(p: string): string {
  const home = process.env.HOME ?? '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function safeUsername(): string {
  try { return userInfo().username || 'there'; } catch { return 'there'; }
}

function humanCost(): string {
  // Splash hint about the active pricing tier; refined later when we read it
  // off config. For now just naming the family.
  return 'DeepSeek V4';
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.max(1, Math.floor(d / 1000))}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
