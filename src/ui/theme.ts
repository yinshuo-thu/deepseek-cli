// DeepSeek brand palette + Ink-friendly colour tokens.
// All colours are 24-bit hex; Ink will downsample on terminals that
// don't support truecolor.

export const palette = {
  // Brand
  deepseekBlue: '#4D6BFE',
  deepseekBlueDim: '#3A52CC',
  whaleNavy: '#0F1A4A',

  // Semantic
  fg: '#E6E8F0',
  fgMuted: '#8B91A8',
  bg: '#0B0F1A',
  bgRaised: '#141A2A',

  ok: '#3DDC84',
  warn: '#F5B452',
  err: '#FF5C7C',

  // Roles
  user: '#9DB2FF',
  assistant: '#4D6BFE',
  system: '#8B91A8',
  tool: '#F5B452',
  reasoning: '#A56BFE', // chain-of-thought (deepseek-reasoner)
} as const;

export type Theme = typeof palette;

// ANSI helpers for places we need raw escape codes (cli-highlight, etc.)
export const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
} as const;
