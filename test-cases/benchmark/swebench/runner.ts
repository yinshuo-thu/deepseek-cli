#!/usr/bin/env tsx
/**
 * SWE-bench runner: for each bug-fix task, evaluate a model's fixed code.
 * Usage: tsx runner.ts <response_json_path>
 * response_json_path: JSON file mapping task_id -> model_response_string (the fixed code)
 * Outputs: {suite, score, results} written to <response>-swe-results.json
 *
 * Scoring:
 *   - Verify tests_before FAIL on buggy_code (sanity check baseline)
 *   - Verify tests_after PASS on model's fixed code
 *   - Score 1 if all tests_after pass, 0 otherwise
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractCodeBlock } from '../shared/extract.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(readFileSync(join(__dir, 'tasks.json'), 'utf-8'));
const responsePath = process.argv[2];

if (!responsePath) {
  console.error('Usage: tsx swebench/runner.ts <responses.json>');
  process.exit(1);
}

const responses: Record<string, string> = JSON.parse(readFileSync(responsePath, 'utf-8'));

interface TaskResult {
  id: string;
  pass: boolean;
  baseline_confirmed: boolean;
  passed_after: number;
  total_after: number;
  error?: string;
}

const results: TaskResult[] = [];

function runScript(script: string): boolean {
  try {
    const tmpFile = `/tmp/swe-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;
    writeFileSync(tmpFile, script);
    const result = execSync(`node_modules/.bin/tsx ${tmpFile}`, {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: join(__dir, '../../..'),
    });
    return result !== null;
  } catch {
    return false;
  }
}

function buildTestScript(code: string, assertions: string[]): string {
  const assertBlock = assertions.map((a, i) =>
    `const __test${i} = (${a});\nif (!__test${i}) process.exit(1);`
  ).join('\n');
  return `${code}\n${assertBlock}`;
}

for (const task of tasks) {
  const response = responses[task.id];
  if (!response) {
    results.push({
      id: task.id,
      pass: false,
      baseline_confirmed: false,
      passed_after: 0,
      total_after: task.tests_after.length,
      error: 'no response',
    });
    continue;
  }

  // Check baseline: tests_before should fail on buggy_code
  const buggyScript = buildTestScript(task.buggy_code, task.tests_before);
  const baselineFails = !runScript(buggyScript);

  // Extract the fixed code from model response
  const fixedCode = extractCodeBlock(response, 'typescript');

  // Run tests_after on fixed code
  let passedAfter = 0;
  for (const assertion of task.tests_after) {
    const testScript = `${fixedCode}\nconst __ok = (${assertion});\nif (!__ok) process.exit(1);`;
    if (runScript(testScript)) passedAfter++;
  }

  const pass = passedAfter === task.tests_after.length;
  results.push({
    id: task.id,
    pass,
    baseline_confirmed: baselineFails,
    passed_after: passedAfter,
    total_after: task.tests_after.length,
  });
}

const score = results.filter(r => r.pass).length / tasks.length;
const output = { suite: 'swebench', score, results };
const outPath = join(__dir, '../results/swe-results.json');
mkdirSync(join(__dir, '../results'), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`SWE-bench score: ${(score * 100).toFixed(1)}% (${results.filter(r => r.pass).length}/${tasks.length})`);
