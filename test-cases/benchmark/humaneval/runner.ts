#!/usr/bin/env tsx
/**
 * HumanEval runner: for each problem, evaluate a model response.
 * Usage: tsx runner.ts <response_json_path>
 * response_json_path: JSON file mapping problem_id -> model_response_string
 * Outputs: {results: [{id, pass, passed_tests, total_tests}], score: float}
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
  console.error('Usage: tsx humaneval/runner.ts <responses.json>');
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
    results.push({ id: p.id, pass: false, passed_tests: 0, total_tests: p.test_cases.length, error: 'no response' });
    continue;
  }

  const code = extractCodeBlock(response, 'typescript');
  let passed = 0;
  const total = p.test_cases.length;

  for (const tc of p.test_cases) {
    const args = JSON.stringify(tc.input).slice(1, -1); // remove outer []
    const fnName = p.function_signature.match(/function (\w+)/)?.[1] ?? 'f';
    const testScript = `
${code}
const __result = ${fnName}(${args});
const __expected = ${JSON.stringify(tc.expected)};
const __ok = JSON.stringify(__result) === JSON.stringify(__expected);
process.exit(__ok ? 0 : 1);
    `.trim();

    try {
      const tmpFile = `/tmp/he-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;
      writeFileSync(tmpFile, testScript);
      execSync(`node_modules/.bin/tsx ${tmpFile}`, { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'], cwd: join(__dir, '../../..') });
      passed++;
    } catch {
      // test failed
    }
  }
  results.push({ id: p.id, pass: passed === total, passed_tests: passed, total_tests: total });
}

const score = results.filter(r => r.pass).length / problems.length;
const output = { suite: 'humaneval', score, results };
const outPath = join(__dir, '../results/he-results.json');
mkdirSync(join(__dir, '../results'), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`HumanEval score: ${(score * 100).toFixed(1)}% (${results.filter(r => r.pass).length}/${problems.length})`);
