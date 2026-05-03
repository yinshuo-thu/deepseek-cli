#!/usr/bin/env tsx
/**
 * BashBench runner: for each task, evaluate a model's bash command.
 * Usage: tsx runner.ts <response_json_path>
 * response_json_path: JSON file mapping task_id -> model_response_string
 * Outputs: {suite, score, results} written to <response>-bash-results.json
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { extractCodeBlock } from '../shared/extract.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(readFileSync(join(__dir, 'tasks.json'), 'utf-8'));
const responsePath = process.argv[2];

if (!responsePath) {
  console.error('Usage: tsx bashbench/runner.ts <responses.json>');
  process.exit(1);
}

const responses: Record<string, string> = JSON.parse(readFileSync(responsePath, 'utf-8'));
const results: Array<{
  id: string;
  pass: boolean;
  actual_output?: string;
  expected_output: string;
  error?: string;
}> = [];

function matchOutput(actual: string, expected: string, mode: string): boolean {
  const a = actual.trim();
  const e = expected.trim();
  switch (mode) {
    case 'exact':
      return a === e;
    case 'contains':
      return a.includes(e);
    case 'starts_with':
      return a.startsWith(e);
    case 'regex':
      return new RegExp(e).test(a);
    default:
      return a.includes(e);
  }
}

for (const task of tasks) {
  const response = responses[task.id];
  if (!response) {
    results.push({ id: task.id, pass: false, expected_output: task.expected_output, error: 'no response' });
    continue;
  }

  // Create a unique temp directory for this task
  const taskTmpDir = join(tmpdir(), `bbench-${task.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(taskTmpDir, { recursive: true });

  try {
    // Run setup script with TMPDIR set to our temp dir so files land there
    const setupScript = task.setup_script.replace(/\$TMPDIR/g, taskTmpDir);
    execSync(setupScript, { cwd: taskTmpDir, timeout: 5000, shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

    // Extract bash command from model response
    let command = extractCodeBlock(response, 'bash');
    if (!command || command === response.trim()) {
      command = extractCodeBlock(response, 'sh');
    }

    // Execute the command in the temp dir
    let actualOutput = '';
    try {
      actualOutput = execSync(command, { cwd: taskTmpDir, timeout: 5000, shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    } catch (err: any) {
      actualOutput = err.stdout?.toString() ?? '';
    }

    const pass = matchOutput(actualOutput, task.expected_output, task.match_mode);
    results.push({ id: task.id, pass, actual_output: actualOutput.trim(), expected_output: task.expected_output });
  } catch (err: any) {
    results.push({ id: task.id, pass: false, expected_output: task.expected_output, error: err.message ?? String(err) });
  } finally {
    // Cleanup
    try {
      rmSync(taskTmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

const score = results.filter(r => r.pass).length / tasks.length;
const output = { suite: 'bashbench', score, results };
const outPath = join(__dir, '../results/bash-results.json');
mkdirSync(join(__dir, '../results'), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`BashBench score: ${(score * 100).toFixed(1)}% (${results.filter(r => r.pass).length}/${tasks.length})`);
