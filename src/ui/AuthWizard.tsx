// Authentication wizard shown on first run and via /login.
// Three methods:
//   1. DeepSeek API Key  — direct API key from platform.deepseek.com
//   2. Browser Login     — ds2api web-session cookie via local proxy
//   3. Custom Proxy      — third-party relay base URL + API key

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { palette } from './theme.js';
import { loginFlow } from '../commands/login.js';

// ── Public types ─────────────────────────────────────────────────────────────

export type AuthWizardResult =
  | { type: 'api-key';  apiKey: string }
  | { type: 'browser';  proxyUrl: string }
  | { type: 'custom';   baseUrl: string; apiKey: string }
  | { type: 'cancel' };

interface AuthWizardProps {
  onDone: (result: AuthWizardResult) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const METHODS = [
  {
    id: 'api-key' as const,
    label: 'DeepSeek API Key',
    desc:  'sk-… from platform.deepseek.com/api_keys',
  },
  {
    id: 'browser' as const,
    label: 'Browser Login',
    desc:  'Session cookie via chat.deepseek.com (free tier)',
  },
  {
    id: 'custom' as const,
    label: 'Custom Proxy / Relay',
    desc:  'Third-party OpenAI-compatible relay + your API key',
  },
];

type Step =
  | 'select'
  | 'api-key-input'
  | 'custom-url'
  | 'custom-key'
  | 'browser-waiting';

// ── Component ────────────────────────────────────────────────────────────────

export function AuthWizard({ onDone }: AuthWizardProps) {
  const [step, setStep]         = useState<Step>('select');
  const [cursor, setCursor]     = useState(0);
  const [apiKey, setApiKey]     = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserError, setBrowserError] = useState('');
  const doneRef = useRef(false);

  // Handle arrow-key selection on the method-select screen.
  useInput((input, key) => {
    if (step !== 'select') return;
    if (key.upArrow)   setCursor((c) => (c + METHODS.length - 1) % METHODS.length);
    if (key.downArrow) setCursor((c) => (c + 1) % METHODS.length);
    if (key.escape)    { if (!doneRef.current) { doneRef.current = true; onDone({ type: 'cancel' }); } }
    if (key.return) {
      const method = METHODS[cursor]!.id;
      if (method === 'api-key') setStep('api-key-input');
      else if (method === 'custom') setStep('custom-url');
      else setStep('browser-waiting');
    }
  }, { isActive: step === 'select' });

  // Browser flow: fire async login when we enter browser-waiting.
  useEffect(() => {
    if (step !== 'browser-waiting') return;
    let cancelled = false;
    loginFlow({
      onUrl: (url) => { if (!cancelled) setBrowserUrl(url); },
    }).then((result) => {
      if (cancelled || doneRef.current) return;
      doneRef.current = true;
      if (result.ok && result.proxyUrl) {
        onDone({ type: 'browser', proxyUrl: result.proxyUrl });
      } else {
        setBrowserError(result.message);
      }
    }).catch((err) => {
      if (cancelled || doneRef.current) return;
      setBrowserError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [step]);  // eslint-disable-line

  // ── Select screen ──────────────────────────────────────────────────────────
  if (step === 'select') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={0}>
        <Box marginBottom={1}>
          <Text bold color={palette.deepseekBlue}>How would you like to connect?</Text>
        </Box>

        {METHODS.map((m, i) => {
          const active = i === cursor;
          return (
            <Box key={m.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={active ? palette.deepseekBlue : palette.fgMuted}>
                  {active ? '❯ ' : '  '}
                </Text>
                <Text bold={active} color={active ? palette.fg : palette.fgMuted}>
                  {m.label}
                </Text>
              </Box>
              <Box marginLeft={4}>
                <Text color={palette.fgMuted}>{m.desc}</Text>
              </Box>
            </Box>
          );
        })}

        <Box marginTop={1}>
          <Text color={palette.fgMuted} dimColor>
            ↑↓ navigate · Enter confirm · Esc cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // ── API key input ──────────────────────────────────────────────────────────
  if (step === 'api-key-input') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={palette.deepseekBlue}>DeepSeek API Key</Text>
          <Text color={palette.fgMuted}>  platform.deepseek.com/api_keys</Text>
        </Box>
        <Box>
          <Text color={palette.deepseekBlue}>API key › </Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            mask="•"
            placeholder="sk-…"
            onSubmit={(v) => {
              const k = v.trim();
              if (!k || doneRef.current) return;
              doneRef.current = true;
              onDone({ type: 'api-key', apiKey: k });
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={palette.fgMuted} dimColor>
            Enter to confirm · Esc to go back
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Custom proxy: URL step ─────────────────────────────────────────────────
  if (step === 'custom-url') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={palette.deepseekBlue}>Custom Proxy  </Text>
          <Text color={palette.fgMuted}>Step 1 of 2 — Base URL</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={palette.fgMuted}>
            Any OpenAI-compatible endpoint, e.g.{'\n'}
            {'  '}https://openrouter.ai/api/v1{'\n'}
            {'  '}https://api.together.xyz/v1
          </Text>
        </Box>
        <Box>
          <Text color={palette.deepseekBlue}>Base URL › </Text>
          <TextInput
            value={customUrl}
            onChange={setCustomUrl}
            placeholder="https://…/v1"
            onSubmit={(v) => {
              const u = v.trim();
              if (!u) return;
              try { new URL(u); } catch { return; }
              setCustomUrl(u);
              setStep('custom-key');
            }}
          />
        </Box>
      </Box>
    );
  }

  // ── Custom proxy: API key step ─────────────────────────────────────────────
  if (step === 'custom-key') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={palette.deepseekBlue}>Custom Proxy  </Text>
          <Text color={palette.fgMuted}>Step 2 of 2 — API Key</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={palette.fgMuted}>Relay: {customUrl}</Text>
        </Box>
        <Box>
          <Text color={palette.deepseekBlue}>API key › </Text>
          <TextInput
            value={customKey}
            onChange={setCustomKey}
            mask="•"
            placeholder="sk-… (required by most relays)"
            onSubmit={(v) => {
              if (doneRef.current) return;
              doneRef.current = true;
              onDone({ type: 'custom', baseUrl: customUrl, apiKey: v.trim() });
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={palette.fgMuted} dimColor>
            Enter to confirm
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Browser waiting ────────────────────────────────────────────────────────
  if (step === 'browser-waiting') {
    if (browserError) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="red">✗ Browser login failed</Text>
          <Text color={palette.fgMuted}>{browserError}</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={palette.deepseekBlue}>Browser Login</Text>
        </Box>
        <Box gap={1}>
          <Text color={palette.deepseekBlue}><Spinner type="dots" /></Text>
          <Text color={palette.fg}>
            {browserUrl ? `Auth server: ${browserUrl}` : 'Starting auth server…'}
          </Text>
        </Box>
        {browserUrl && (
          <Box marginTop={1} flexDirection="column">
            <Text color={palette.fgMuted}>
              Browser tab opened → complete login on chat.deepseek.com
            </Text>
            <Text color={palette.fgMuted}>
              Then run the console snippet to finish authorization.
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return null;
}
