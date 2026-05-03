#!/usr/bin/env tsx
/**
 * MBPP runner: for each problem, evaluate a model response.
 * Usage: tsx runner.ts <response_json_path>
 * response_json_path: JSON file mapping problem_id -> model_response_string
 * Outputs: {suite, score, results} written to <response>-mbpp-results.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractCodeBlock } from '../shared/extract.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const problems = JSON.parse(readFileSync(join(__dir, 'problems.json'), 'utf-8'));
const responsePath = process.argv[2];

if (!responsePath) {
  console.error('Usage: tsx mbpp/runner.ts <responses.json>');
  process.exit(1);
}

const responses: Record<string, string> = JSON.parse(readFileSync(responsePath, 'utf-8'));
const results: Array<{
  id: string;
  pass: boolean;
  passed_tests: number;
  total_tests: number;
  error?: string;
}> = [];

for (const p of problems) {
  const response = responses[p.id];
  if (!response) {
    results.push({ id: p.id, pass: false, passed_tests: 0, total_tests: p.assert_tests.length, error: 'no response' });
    continue;
  }

  const code = extractCodeBlock(response, 'typescript');
  const total = p.assert_tests.length;
  let passed = 0;

  for (const assertion of p.assert_tests) {
    const testScript = `
${code}
const __ok = (${assertion});
process.exit(__ok ? 0 : 1);
    `.trim();

    try {
      const tmpFile = `/tmp/mbpp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;
      writeFileSync(tmpFile, testScript);
      execSync(`node_modules/.bin/tsx ${tmpFile}`, { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'], cwd: join(__dir, '../../..') });
      passed++;
    } catch {
      // assertion failed
    }
  }

  results.push({ id: p.id, pass: passed === total, passed_tests: passed, total_tests: total });
}

const score = results.filter(r => r.pass).length / problems.length;
const output = { suite: 'mbpp', score, results };
const outPath = join(__dir, '../results/mbpp-results.json');
mkdirSync(join(__dir, '../results'), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`MBPP score: ${(score * 100).toFixed(1)}% (${results.filter(r => r.pass).length}/${problems.length})`);
