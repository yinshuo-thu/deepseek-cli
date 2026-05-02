import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from './theme.js';
import { listSessions, type SessionMeta } from '../session/history.js';

interface Props {
  cwd: string;
  onPick: (id: string | null) => void;
}

export function ResumePicker({ cwd, onPick }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    listSessions(cwd, 15).then(setSessions).catch(() => setSessions([]));
  }, [cwd]);

  useInput((_, key) => {
    if (!sessions || sessions.length === 0) {
      if (key.escape || key.return) onPick(null);
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(sessions.length - 1, c + 1));
    else if (key.return) onPick(sessions[cursor]?.id ?? null);
    else if (key.escape) onPick(null);
  });

  if (!sessions) return <Text color={palette.fgMuted}>loading sessions…</Text>;
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={palette.fgMuted} paddingX={1} marginY={1}>
        <Text color={palette.fgMuted}>no previous sessions for this directory.</Text>
        <Text color={palette.fgMuted} dimColor>press any key to dismiss.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.deepseekBlue} paddingX={1} marginY={1}>
      <Text color={palette.deepseekBlue} bold>resume a session  <Text color={palette.fgMuted}>(↑/↓ select · enter pick · esc cancel)</Text></Text>
      {sessions.map((s, i) => {
        const ts = new Date(s.updatedAt).toISOString().replace('T', ' ').slice(0, 16);
        const head = (s.firstUserPrompt ?? '<no prompt>').replace(/\s+/g, ' ').slice(0, 64);
        const sel = i === cursor;
        return (
          <Box key={s.id}>
            <Text color={sel ? palette.deepseekBlue : palette.fgMuted}>{sel ? '▸ ' : '  '}</Text>
            <Text color={sel ? palette.fg : palette.fgMuted}>
              {ts}  ·  {String(s.messageCount).padStart(3, ' ')} msgs  ·  {head}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
