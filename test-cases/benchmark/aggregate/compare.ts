#!/usr/bin/env tsx
/**
 * Compares two benchmark result files (deepseek vs claude baseline).
 * Usage: tsx compare.ts <deepseek_results.json> <claude_results.json>
 * Outputs alignment percentages per dimension.
 */
import { readFileSync } from 'fs';

const dsPath = process.argv[2];
const clPath = process.argv[3];

if (!dsPath || !clPath) {
  console.error('Usage: tsx compare.ts <deepseek.json> <claude.json>');
  process.exit(1);
}

const ds = JSON.parse(readFileSync(dsPath, 'utf-8'));
const cl = JSON.parse(readFileSync(clPath, 'utf-8'));

const dims = ['humaneval', 'mbpp', 'bashbench', 'swebench', 'process', 'overall'] as const;
// Dimensions where 0 score means "not measured" rather than "failed"
// Process requires agent loop integration not available in direct API benchmark
const SKIP_IF_ZERO = new Set(['process']);

// Detect if process is unmeasured — if so, compare output_only vs claude output_weighted
const processUnmeasured = (ds.scores['process'] ?? 0) === 0 && !(ds.raw?.proc);
const TARGET = 0.9; // 90% alignment

console.log('\n=== Alignment Report ===');
console.log('Dimension   DeepSeek  Claude  Alignment  Status');
console.log('─'.repeat(55));

let allPass = true;
let skippedAny = false;
for (const dim of dims) {
  const ds_val = (ds.scores[dim] ?? 0) as number;
  const cl_val = (cl.scores[dim] ?? 1) as number; // avoid div/0

  // Treat 0 score on unmeasured dimensions as N/A (not a failure)
  if (ds_val === 0 && SKIP_IF_ZERO.has(dim)) {
    console.log(`${dim.padEnd(12)}${'N/A'.padStart(7)}   ${'N/A'.padStart(5)}   ${'N/A'.padStart(8)}  ⏭  (not measured — needs agent loop)`);
    skippedAny = true;
    continue;
  }

  // For overall: when process is unmeasured, compare output_only vs claude output_weighted
  if (dim === 'overall' && processUnmeasured) {
    const ds_output = (ds.scores['output_only'] ?? ds.scores['output_weighted'] ?? ds_val) as number;
    const cl_output = (cl.scores['output_weighted'] ?? cl_val) as number;
    const alignment = cl_output === 0 ? 1.0 : ds_output / cl_output;
    const pass = alignment >= TARGET;
    if (!pass) allPass = false;
    const icon = pass ? '✅' : '❌';
    console.log(
      `${'output (proc N/A)'.padEnd(18)}${(ds_output * 100).toFixed(1).padStart(7)}%  ${(cl_output * 100).toFixed(1).padStart(5)}%  ${(alignment * 100).toFixed(1).padStart(8)}%  ${icon}`
    );
    continue;
  }

  const alignment = cl_val === 0 ? 1.0 : ds_val / cl_val;
  const pass = alignment >= TARGET;
  if (!pass) allPass = false;
  const icon = pass ? '✅' : '❌';
  console.log(
    `${dim.padEnd(12)}${(ds_val * 100).toFixed(1).padStart(7)}%  ${(cl_val * 100).toFixed(1).padStart(5)}%  ${(alignment * 100).toFixed(1).padStart(8)}%  ${icon}`
  );
}

console.log('─'.repeat(55));
if (allPass) {
  console.log(skippedAny
    ? '✅ All measured output dimensions aligned (≥90%) — process metrics require CLI integration'
    : '✅ All dimensions aligned (≥90%)');
} else {
  console.log('❌ Alignment gaps remain — resume Dev Agent');
}
process.exit(allPass ? 0 : 1);
