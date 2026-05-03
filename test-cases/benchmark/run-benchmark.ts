#!/usr/bin/env tsx
/**
 * Benchmark Runner — calls DeepSeek API for each problem in each suite,
 * saves response manifests, then evaluates via suite runners.
 *
 * Usage:
 *   tsx test-cases/benchmark/run-benchmark.ts [--round=0] [--suite=humaneval,mbpp,bashbench,swebench] [--limit=5]
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../src/config/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const round = parseInt(rawArgs.find(a => a.startsWith('--round='))?.split('=')[1] ?? '0');
const suiteArg = rawArgs.find(a => a.startsWith('--suite='))?.split('=')[1];
const limitArg = rawArgs.find(a => a.startsWith('--limit='))?.split('=')[1];
const limit = limitArg ? parseInt(limitArg) : undefined;
const modelArg = rawArgs.find(a => a.startsWith('--model='))?.split('=')[1];

const ALL_SUITES = ['humaneval', 'mbpp', 'bashbench', 'swebench'] as const;
type Suite = typeof ALL_SUITES[number];
const suites: Suite[] = suiteArg
  ? (suiteArg.split(',').filter(s => ALL_SUITES.includes(s as Suite)) as Suite[])
  : [...ALL_SUITES];

// ---------------------------------------------------------------------------
// Results directory
// ---------------------------------------------------------------------------
const resultsDir = join(__dir, 'results');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

// ---------------------------------------------------------------------------
// API helper — direct (non-streaming) chat completion
// ---------------------------------------------------------------------------
async function chatComplete(apiKey: string, baseUrl: string, model: string, prompt: string): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const isReasoner = model.includes('reasoner');
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    max_tokens: isReasoner ? 4096 : 2048,
    ...(isReasoner ? {} : { temperature: 0 }),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Problem loaders
// ---------------------------------------------------------------------------
interface HEProblem {
  id: string;
  prompt: string;
  function_signature: string;
  test_cases: unknown[];
}

interface MBPPProblem {
  id: string;
  prompt: string;
  function_signature: string;
  assert_tests: string[];
}

interface BashTask {
  id: string;
  prompt: string;
  setup_script: string;
  expected_output: string;
  match_mode: string;
}

interface SWETask {
  id: string;
  description: string;
  buggy_code: string;
  tests_after: string[];
}

function loadProblems<T>(suite: Suite): T[] {
  const filename = suite === 'humaneval' || suite === 'mbpp' ? 'problems.json' : 'tasks.json';
  const path = join(__dir, suite, filename);
  const all = JSON.parse(readFileSync(path, 'utf-8')) as T[];
  return limit !== undefined ? all.slice(0, limit) : all;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
function buildPrompt(suite: Suite, problem: HEProblem | MBPPProblem | BashTask | SWETask): string {
  switch (suite) {
    case 'humaneval':
    case 'mbpp': {
      const p = problem as HEProblem | MBPPProblem;
      return `${p.prompt}\n\nImplement the following TypeScript function with this EXACT signature (do not rename it):\n\`\`\`typescript\n${p.function_signature} {\n  // your implementation here\n}\n\`\`\`\n\nReturn ONLY the implementation inside a single \`\`\`typescript code block. Do not add extra functions or rename the function.`;
    }
    case 'bashbench': {
      const t = problem as BashTask;
      return `${t.prompt}\n\nProvide the exact bash command. Wrap in \`\`\`bash block.`;
    }
    case 'swebench': {
      const t = problem as SWETask;
      return `Here is buggy TypeScript code:\n\`\`\`typescript\n${t.buggy_code}\n\`\`\`\n\n${t.description}\n\nProvide the fixed code in a \`\`\`typescript block.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Suite evaluator — spawns the suite runner
// ---------------------------------------------------------------------------
function evalSuite(suite: Suite, responsesFile: string): void {
  const runnerMap: Record<Suite, string> = {
    humaneval: 'humaneval/runner.ts',
    mbpp: 'mbpp/runner.ts',
    bashbench: 'bashbench/runner.ts',
    swebench: 'swebench/runner.ts',
  };
  const runnerPath = `test-cases/benchmark/${runnerMap[suite]}`;
  const cmd = `node_modules/.bin/tsx "${runnerPath}" "${responsesFile}"`;
  console.log(`\n$ ${cmd}`);
  try {
    execSync(cmd, {
      cwd: join(__dir, '../..'),
      stdio: 'inherit',
      encoding: 'utf-8',
    });
  } catch {
    // Runner may exit 1 on failures — that's fine, results file is still written
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DeepSeek Benchmark Runner — Round ${round}`);
  console.log(`Suites: ${suites.join(', ')}${limit !== undefined ? ` (limit=${limit})` : ''}`);
  console.log('='.repeat(60));

  const cfg = await loadConfig();

  if (!cfg.apiKey) {
    console.error('\nError: No API key found.');
    console.error('Set the DEEPSEEK_API_KEY environment variable or run `deepseek` to configure.');
    process.exit(1);
  }

  // Map CLI model IDs to DeepSeek API model names
  const MODEL_MAP: Record<string, string> = {
    'deepseek-v4-flash': 'deepseek-chat',
    'deepseek-v4-pro': 'deepseek-reasoner',
    'deepseek-chat': 'deepseek-chat',
    'deepseek-reasoner': 'deepseek-reasoner',
  };
  const model = MODEL_MAP[modelArg ?? cfg.model] ?? 'deepseek-chat';
  console.log(`Model: ${model}`);
  const baseUrl = cfg.baseUrl;

  for (const suite of suites) {
    console.log(`\n--- Suite: ${suite} ---`);

    const problems = loadProblems(suite);
    console.log(`Loaded ${problems.length} problem(s)`);

    const responses: Record<string, string> = {};

    for (let i = 0; i < problems.length; i++) {
      const problem = problems[i] as HEProblem | MBPPProblem | BashTask | SWETask;
      const id: string =
        (problem as HEProblem).id ??
        (problem as BashTask).id ??
        `${suite}-${i}`;

      const prompt = buildPrompt(suite, problem);

      process.stdout.write(`  [${i + 1}/${problems.length}] ${id} ... `);
      const start = Date.now();
      try {
        const response = await chatComplete(cfg.apiKey!, baseUrl, model, prompt);
        responses[id] = response;
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`ok (${elapsed}s)`);
      } catch (err) {
        const msg = (err as Error).message;
        console.log(`FAILED: ${msg}`);
        responses[id] = '';
      }
    }

    // Save responses manifest
    const responsesFile = join(resultsDir, `responses-${suite}-r${round}.json`);
    writeFileSync(responsesFile, JSON.stringify(responses, null, 2));
    console.log(`\nResponses saved: ${responsesFile}`);

    // Run suite evaluator
    evalSuite(suite, responsesFile);
  }

  console.log('\nBenchmark run complete.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
