#!/usr/bin/env tsx
/**
 * Aggregates all benchmark suite results into a single score file.
 * Usage: tsx aggregate/score.ts <results-dir> <round-number>
 * Reads: he-results.json, mbpp-results.json, bash-results.json, swe-results.json, process-results.json
 * Writes: benchmark_results_r{N}.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const resultsDir = process.argv[2] ?? 'test-cases/benchmark/results';
const round = process.argv[3] ?? '0';

function safeRead(path: string) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const he = safeRead(join(resultsDir, 'he-results.json'));
const mbpp = safeRead(join(resultsDir, 'mbpp-results.json'));
const bash = safeRead(join(resultsDir, 'bash-results.json'));
const swe = safeRead(join(resultsDir, 'swe-results.json'));
const proc = safeRead(join(resultsDir, 'process-results.json'));

const heScore = he?.score ?? 0;
const mbppScore = mbpp?.score ?? 0;
const bashScore = bash?.score ?? 0;
const sweScore = swe?.score ?? 0;
const procScore = proc?.score ?? 0;

const outputScore = heScore * 0.35 + mbppScore * 0.15 + bashScore * 0.25 + sweScore * 0.25;
const overallScore = outputScore * 0.7 + procScore * 0.3;
// output_only: overall score when process metrics are not available
const outputOnlyScore = outputScore;

const result = {
  round: parseInt(round),
  timestamp: new Date().toISOString(),
  scores: {
    humaneval: heScore,
    mbpp: mbppScore,
    bashbench: bashScore,
    swebench: sweScore,
    process: procScore,
    output_weighted: outputScore,
    overall: overallScore,
    output_only: outputOnlyScore,
  },
  raw: { he, mbpp, bash, swe, proc },
};

const outPath = join(resultsDir, `benchmark_results_r${round}.json`);
writeFileSync(outPath, JSON.stringify(result, null, 2));

console.log(`\n=== Benchmark Results Round ${round} ===`);
console.log(`HumanEval:  ${(heScore * 100).toFixed(1)}%`);
console.log(`MBPP:       ${(mbppScore * 100).toFixed(1)}%`);
console.log(`BashBench:  ${(bashScore * 100).toFixed(1)}%`);
console.log(`SWE-bench:  ${(sweScore * 100).toFixed(1)}%`);
console.log(`Process:    ${(procScore * 100).toFixed(1)}%`);
console.log(`─────────────────────────`);
console.log(`Output:     ${(outputScore * 100).toFixed(1)}%`);
console.log(`Overall:    ${(overallScore * 100).toFixed(1)}%`);
console.log(`Written to: ${outPath}`);
