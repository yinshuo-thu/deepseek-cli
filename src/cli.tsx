#!/usr/bin/env node
import React from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import yargs from 'yargs';
import { AuthWizard, type AuthWizardResult } from './ui/AuthWizard.js';
import { hideBin } from 'yargs/helpers';

import { App } from './App.js';
import { loadConfig, saveConfig, redact, type Config, type ModelId } from './config/index.js';
import { palette } from './ui/theme.js';
import { WHALE_ART } from './ui/whale.js';
import { DeepSeekClient } from './api/client.js';
import { startProxyServer } from './auth/server.js';
import { loadSession } from './auth/session.js';
import { listSessions } from './session/history.js';
import { mcpRegistry } from './mcp/registry.js';

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

  // First-run wizard: no credentials configured → show auth method picker.
  // Skip when already on deepseek-web flavor (proxy is the auth source).
  if (!config.apiKey && config.apiFlavor !== 'deepseek-web') {
    const patch = await firstRunWizard(config);
    if (!patch) {
      console.error('No credentials provided. Exiting.');
      process.exit(1);
    }
    Object.assign(config, patch);
    await saveConfig(patch);
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

  // Kick off MCP registry connections in the background — non-blocking. Tools
  // become visible once `tools/list` completes for each server.
  mcpRegistry.connectAll(process.cwd()).catch((err) => {
    console.warn(`mcp connectAll failed: ${err instanceof Error ? err.message : String(err)}`);
  });

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

// firstRunWizard: shown once when no credentials are configured.
// Presents three auth methods; returns the selected config patch or null to abort.
async function firstRunWizard(config: Config): Promise<Partial<Config> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const { unmount } = render(
      <Box flexDirection="column" paddingX={1} paddingY={0}>
        <Box marginBottom={1}>
          <Text color={palette.deepseekBlue}>{WHALE_ART}</Text>
        </Box>
        <Box marginBottom={1} marginLeft={2}>
          <Text bold color={palette.deepseekBlue}>Welcome to DeepSeek-CLI</Text>
        </Box>
        <AuthWizard
          onDone={(result: AuthWizardResult) => {
            if (settled) return;
            settled = true;
            unmount();
            if (result.type === 'cancel') { resolve(null); return; }
            if (result.type === 'api-key') {
              resolve({ apiKey: result.apiKey, baseUrl: 'https://api.deepseek.com', apiFlavor: 'openai' });
            } else if (result.type === 'browser') {
              resolve({ apiFlavor: 'deepseek-web', baseUrl: result.proxyUrl });
            } else if (result.type === 'custom') {
              resolve({ baseUrl: result.baseUrl, apiKey: result.apiKey || undefined, apiFlavor: 'openai' });
            }
          }}
        />
      </Box>,
    );
  });
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
