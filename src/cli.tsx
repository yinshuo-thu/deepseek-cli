#!/usr/bin/env node
import React from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { App } from './App.js';
import { loadConfig, saveConfig, redact, type Config, type ModelId } from './config/index.js';
import { palette } from './ui/theme.js';
import { WHALE_ART } from './ui/whale.js';
import { DeepSeekClient } from './api/client.js';
import { startProxyServer } from './auth/server.js';
import { loadSession } from './auth/session.js';
import { listSessions } from './session/history.js';

const VERSION = '0.1.0';

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('deepseek')
    .usage('$0 [prompt]', 'Native DeepSeek terminal coding agent.')
    .option('api-key',  { type: 'string', describe: 'Override the API key for this run.' })
    .option('base-url', { type: 'string', describe: 'Override the API base URL.' })
    .option('model',    { type: 'string', choices: ['deepseek-v4-flash', 'deepseek-v4-pro'] as const, describe: 'Model to use.' })
    .option('print',    { type: 'boolean', describe: 'One-shot mode: print response and exit (no TUI).', default: false })
    .help()
    .version(VERSION)
    .parse();

  const baseConfig = await loadConfig();
  const config: Config = {
    ...baseConfig,
    ...(argv['api-key']  ? { apiKey: argv['api-key'] as string } : {}),
    ...(argv['base-url'] ? { baseUrl: argv['base-url'] as string } : {}),
    ...(argv.model       ? { model: argv.model as ModelId }       : {}),
  };

  // If we previously logged in via /login, lazy-start the proxy and rewrite
  // baseUrl to point at it. Falls back to OpenAI flavor on failure.
  if (config.apiFlavor === 'deepseek-web') {
    const session = await loadSession();
    if (session) {
      try {
        const proxy = await startProxyServer(session);
        config.baseUrl = proxy.url;
        // Provide a placeholder apiKey so DeepSeekClient.stream() won't bail
        // before reaching the proxy (the proxy ignores Authorization for now).
        if (!config.apiKey) config.apiKey = 'deepseek-web';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`failed to start deepseek-web proxy: ${msg}; falling back to openai flavor`);
        config.apiFlavor = 'openai';
        config.baseUrl = 'https://api.deepseek.com';
      }
    } else {
      console.warn('config has apiFlavor=deepseek-web but no session found; falling back to openai flavor');
      config.apiFlavor = 'openai';
      config.baseUrl = 'https://api.deepseek.com';
    }
  }

  // First-run wizard: no API key anywhere → ask interactively.
  // Skip the wizard when we're on the deepseek-web flavor: the proxy is the
  // auth source and any apiKey we have is just a placeholder.
  if (!config.apiKey && config.apiFlavor !== 'deepseek-web') {
    const key = await firstRunWizard(config);
    if (!key) {
      console.error('No API key provided. Exiting.');
      process.exit(1);
    }
    config.apiKey = key;
    await saveConfig({ apiKey: key });
  }

  // One-shot --print mode (handy for scripting; full TUI otherwise).
  const initialPrompt = (argv._ as string[]).join(' ').trim();
  if (argv.print) {
    if (!initialPrompt) {
      console.error('--print requires a prompt argument.');
      process.exit(1);
    }
    await printOnce(config, initialPrompt);
    return;
  }

  // Pre-load recent sessions BEFORE rendering so the splash renders once at
  // its final height. If we waited for a useEffect inside Splash, the initial
  // (recent=[]) frame would already be in scrollback by the time the async
  // load completed and Splash re-rendered taller — producing a "double splash".
  const initialRecentSessions = await listSessions(process.cwd(), 4).catch(() => []);

  // Render the TUI.
  const { waitUntilExit } = render(
    <App
      config={config}
      version={VERSION}
      initialRecentSessions={initialRecentSessions}
    />,
    { exitOnCtrlC: false },
  );
  await waitUntilExit();
}

async function firstRunWizard(config: Config): Promise<string | null> {
  return new Promise((resolve) => {
    const { unmount } = render(<Wizard config={config} onDone={(k) => { unmount(); resolve(k); }} />);
  });
}

function Wizard({ config, onDone }: { config: Config; onDone: (key: string | null) => void }) {
  const [val, setVal] = React.useState('');
  const { exit } = useApp();
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={palette.deepseekBlue}>{WHALE_ART}</Text>
      <Box marginLeft={2} flexDirection="column" marginBottom={1}>
        <Text bold color={palette.deepseekBlue}>Welcome to DeepSeek-CLI</Text>
        <Text color={palette.fgMuted}>
          Get an API key from <Text color={palette.fg}>https://platform.deepseek.com/api_keys</Text>
        </Text>
        <Text color={palette.fgMuted}>
          It will be stored at <Text color={palette.fg}>~/.deepseek/config.json</Text> (chmod 600).
        </Text>
      </Box>
      <Box>
        <Text color={palette.deepseekBlue}>API key › </Text>
        <TextInput
          value={val}
          onChange={setVal}
          mask="•"
          onSubmit={(v) => {
            const k = v.trim();
            if (!k) { onDone(null); exit(); return; }
            onDone(k);
            exit();
          }}
          placeholder="sk-…"
        />
      </Box>
    </Box>
  );
}

async function printOnce(config: Config, prompt: string) {
  const client = new DeepSeekClient(config);
  const ctrl = new AbortController();
  process.on('SIGINT', () => ctrl.abort());
  for await (const ev of client.stream({
    messages: [{ role: 'user', content: prompt }],
    signal: ctrl.signal,
  })) {
    if (ev.kind === 'content') process.stdout.write(ev.delta);
    else if (ev.kind === 'reasoning') process.stderr.write(ev.delta);
    else if (ev.kind === 'error') { process.stderr.write(`\n[error] ${ev.message}\n`); process.exit(1); }
  }
  process.stdout.write('\n');
}

main().catch((e) => {
  console.error('fatal:', e?.stack || e);
  process.exit(1);
});
