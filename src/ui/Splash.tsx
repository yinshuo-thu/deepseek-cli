import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { userInfo } from 'node:os';
import { palette } from './theme.js';
import { WHALE_ART, WHALE_ART_COMPACT } from './whale.js';
import { listSessions, type SessionMeta } from '../session/history.js';

// One outer dashed rectangle, two columns inside, horizontal divider in
// the right column. Layout is built as a series of fixed-width strings
// so the borders line up exactly. ASCII only — Unicode width is handled
// for any CJK content that lands in the right column.

const TOTAL_W = 100;
const LEFT_W = 56;
const RIGHT_W = 37;
const DIVIDER_W = TOTAL_W - 2 - LEFT_W - 2 - 1; // = 39

interface Props {
  version: string;
  model: string;
  cwd: string;
  termCols: number;
  /**
   * Pre-loaded recent sessions. When provided, Splash uses them directly and
   * skips the async fetch — this avoids a re-render that would leave a
   * partial first frame in terminal scrollback (the "double splash" bug).
   * Callers should `await listSessions(cwd, 4)` before rendering.
   */
  initialRecent?: SessionMeta[];
}

interface Line {
  text: string;
  color?: string;
  bold?: boolean;
  kind?: 'divider';
}

const WHATS_NEW: Line[] = [
  { text: '/login to authorize via DeepSeek web' },
  { text: '/mode plan|agent|yolo (Tab cycles)' },
  { text: '/reasoning off|high|max (Shift+Tab)' },
  { text: 'apply_patch for multi-hunk diffs' },
];

export function Splash({ version, model, cwd, termCols, initialRecent }: Props) {
  const [recent, setRecent] = useState<SessionMeta[]>(initialRecent ?? []);
  // Only fetch on mount when caller didn't pre-load. The pre-loaded path is
  // strongly preferred (see prop docs) — this branch exists for legacy callers
  // and mid-session remounts, where a brief re-render is acceptable.
  useEffect(() => {
    if (initialRecent !== undefined) return;
    listSessions(cwd, 4).then(setRecent).catch(() => setRecent([]));
  }, [cwd, initialRecent]);

  // Two-pane needs ~102 cols (100 + outer paddingX); fall back below that.
  if (termCols < TOTAL_W + 2) {
    return <CompactSplash version={version} model={model} cwd={cwd} />;
  }

  const username = safeUsername();
  const cwdShort = shortenCwd(cwd);
  const borderColor = palette.deepseekBlueDim;

  // Trim leading/trailing blank lines from the whale.
  const whaleLines = (() => {
    const arr = WHALE_ART.split('\n');
    while (arr.length && arr[0]!.trim() === '') arr.shift();
    while (arr.length && arr[arr.length - 1]!.trim() === '') arr.pop();
    return arr;
  })();

  // Left column content lines (top-to-bottom).
  const leftLines: Line[] = [
    { text: '' },
    { text: `Welcome back, ${username}!` },
    { text: '' },
    ...whaleLines.map((l) => ({ text: l, color: palette.deepseekBlue })),
    { text: '' },
    { text: `${model}  ·  DeepSeek V4`, bold: true },
    { text: cwdShort, color: palette.fgMuted },
    { text: '' },
  ];

  // Right column content lines.
  const rightLines: Line[] = [
    { text: '' },
    { text: 'Recent activity', bold: true, color: palette.deepseekBlue },
  ];
  if (recent.length === 0) {
    rightLines.push({ text: '(no previous sessions)', color: palette.fgMuted });
  } else {
    for (const s of recent) {
      const time = relativeTime(s.updatedAt);
      const head = truncToWidth(
        (s.firstUserPrompt ?? '<no prompt>').replace(/\s+/g, ' '),
        RIGHT_W - 9,
      );
      rightLines.push({ text: `${time.padEnd(7)}  ${head}` });
    }
  }
  if (recent.length >= 4) rightLines.push({ text: '… /resume for more', color: palette.fgMuted });
  rightLines.push({ text: '', kind: 'divider' });
  rightLines.push({ text: '' });
  rightLines.push({ text: "What's new", bold: true, color: palette.deepseekBlue });
  for (const wn of WHATS_NEW) rightLines.push(wn);
  rightLines.push({ text: '… /help for more', color: palette.fgMuted });

  const maxRows = Math.max(leftLines.length, rightLines.length);

  // Top border embeds the title (` DeepSeek-CLI v0.1.0 `).
  const titleText = ` DeepSeek-CLI v${version} `;
  const titleStart = 3;
  const trailDashes = TOTAL_W - 2 - titleStart - titleText.length;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Top border with embedded title */}
      <Text>
        <Text color={borderColor}>.{'-'.repeat(titleStart)}</Text>
        <Text bold color={palette.deepseekBlue}>{titleText}</Text>
        <Text color={borderColor}>{'-'.repeat(trailDashes)}.</Text>
      </Text>

      {/* Body rows */}
      {Array.from({ length: maxRows }, (_, i) => {
        const lLine = leftLines[i];
        const rLine = rightLines[i];
        const lText = padToWidth(truncToWidth(lLine?.text ?? '', LEFT_W), LEFT_W);
        return (
          <Text key={i}>
            <Text color={borderColor}>| </Text>
            <Text color={lLine?.color ?? palette.fg} bold={lLine?.bold}>{lText}</Text>
            <Text color={borderColor}> |</Text>
            {rLine?.kind === 'divider' ? (
              <Text color={borderColor}>{'-'.repeat(DIVIDER_W)}|</Text>
            ) : (
              <>
                <Text color={borderColor}> </Text>
                <Text color={rLine?.color ?? palette.fg} bold={rLine?.bold}>
                  {padToWidth(truncToWidth(rLine?.text ?? '', RIGHT_W), RIGHT_W)}
                </Text>
                <Text color={borderColor}> |</Text>
              </>
            )}
          </Text>
        );
      })}

      {/* Bottom border */}
      <Text color={borderColor}>{"'" + '-'.repeat(TOTAL_W - 2) + "'"}</Text>
    </Box>
  );
}

function CompactSplash({ version, model, cwd }: { version: string; model: string; cwd: string }) {
  const cwdShort = shortenCwd(cwd);
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
          <Text color={palette.fg}>/help</Text> · <Text color={palette.fg}>Tab</Text> mode · <Text color={palette.fg}>Shift+Tab</Text> reasoning · <Text color={palette.fg}>Esc</Text> cancel
        </Text>
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

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.max(1, Math.floor(d / 1000))}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

// Visual width: CJK / fullwidth chars take 2 cols, others take 1.
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||                     // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0x303e) ||                     // CJK radicals + symbols
      (cp >= 0x3041 && cp <= 0x33ff) ||                     // hiragana/katakana/CJK
      (cp >= 0x3400 && cp <= 0x4dbf) ||                     // CJK Ext A
      (cp >= 0x4e00 && cp <= 0x9fff) ||                     // CJK Unified
      (cp >= 0xa000 && cp <= 0xa4cf) ||                     // Yi
      (cp >= 0xac00 && cp <= 0xd7a3) ||                     // Hangul
      (cp >= 0xf900 && cp <= 0xfaff) ||                     // CJK Compat
      (cp >= 0xfe30 && cp <= 0xfe4f) ||                     // CJK Compat Forms
      (cp >= 0xff00 && cp <= 0xff60) ||                     // Fullwidth
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff)                      // emoji rough range
    ) w += 2; else w += 1;
  }
  return w;
}

function padToWidth(s: string, w: number): string {
  const pad = Math.max(0, w - visualWidth(s));
  return s + ' '.repeat(pad);
}

function truncToWidth(s: string, w: number): string {
  let acc = '';
  let used = 0;
  for (const ch of s) {
    const cw = visualWidth(ch);
    if (used + cw > w) break;
    acc += ch;
    used += cw;
  }
  return acc;
}
