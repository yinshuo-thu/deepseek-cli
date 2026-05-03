#!/usr/bin/env tsx
/**
 * Phase 3 Alignment Loop
 *
 * Runs benchmark suite on DeepSeek, compares to Claude baseline,
 * reports alignment gaps. Target: ≥90% alignment on all dimensions.
 *
 * Run: tsx test-cases/benchmark/alignment-loop.ts [--round=0] [--dry-run]
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const round = parseInt(args.find(a => a.startsWith('--round='))?.split('=')[1] ?? '0');
const dryRun = args.includes('--dry-run');

const resultsDir = join(__dir, 'results');
const baselinePath = join(__dir, 'claude-baseline.json');
const scorePath = join(resultsDir, `benchmark_results_r${round}.json`);

function run(cmd: string): string {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, {
    cwd: join(__dir, '../..'),
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Phase 3 Alignment Loop — Round ${round}${dryRun ? ' [DRY RUN]' : ''}`);
  console.log('='.repeat(60));

  // Step 1: Run benchmark (or use existing results)
  if (!existsSync(scorePath) || round === 0) {
    if (!dryRun) {
      console.log('\n[1/3] Running benchmark suite...');
      run(`node_modules/.bin/tsx test-cases/benchmark/run-benchmark.ts --round=${round}`);
      run(`node_modules/.bin/tsx test-cases/benchmark/aggregate/score.ts "${resultsDir}" ${round}`);
    } else {
      console.log('\n[1/3] DRY RUN — skipping API calls, using existing results');
    }
  } else {
    console.log(`\n[1/3] Using existing results for round ${round}: ${scorePath}`);
  }

  // Step 2: Compare to Claude baseline
  console.log('\n[2/3] Comparing to Claude Sonnet 4.6 baseline...');

  if (!existsSync(scorePath)) {
    console.log('No results yet — run without --dry-run first');
    process.exit(1);
  }

  const dsResults = JSON.parse(readFileSync(scorePath, 'utf-8')) as {
    scores: Record<string, number>;
  };
  const claude = JSON.parse(readFileSync(baselinePath, 'utf-8')) as {
    timestamp: string;
    scores: Record<string, number>;
  };

  // Build a claude results file in the same format for compare.ts
  const claudeResultsPath = join(resultsDir, 'claude_baseline_formatted.json');
  writeFileSync(
    claudeResultsPath,
    JSON.stringify(
      {
        round: -1,
        timestamp: claude.timestamp,
        scores: claude.scores,
      },
      null,
      2,
    ),
  );

  let aligned: boolean;
  try {
    run(
      `node_modules/.bin/tsx test-cases/benchmark/aggregate/compare.ts "${scorePath}" "${claudeResultsPath}"`,
    );
    aligned = true;
  } catch {
    aligned = false;
  }

  // Step 3: Report
  console.log('\n[3/3] Alignment summary:');
  const dims = ['humaneval', 'mbpp', 'bashbench', 'swebench', 'process', 'overall'] as const;
  const gaps: string[] = [];

  for (const dim of dims) {
    const ds = dsResults.scores[dim] ?? 0;
    const cl = claude.scores[dim] ?? 1;
    const pct = cl === 0 ? 100 : (ds / cl) * 100;
    if (pct < 90) {
      gaps.push(`${dim}: ${ds.toFixed(2)} vs Claude ${cl.toFixed(2)} (${pct.toFixed(1)}%)`);
    }
  }

  if (aligned) {
    console.log('Target achieved: >=90% alignment on all dimensions');
    console.log('\nNext: run with --round=1 after system prompt tuning to track improvement');
  } else {
    console.log(`${gaps.length} dimension(s) below 90% alignment:`);
    gaps.forEach(g => console.log(`   * ${g}`));
    console.log('\nAction: Review alignment-gap-report.md and adjust system prompt in src/App.tsx');
    console.log(`        Then re-run: tsx test-cases/benchmark/alignment-loop.ts --round=${round + 1}`);
  }

  // Write summary log
  const logEntry = `- ${new Date().toISOString().replace(/T/, ' ').slice(0, 16)} Round ${round}: overall=${((dsResults.scores['overall'] ?? 0) * 100).toFixed(1)}% aligned=${aligned}\n`;
  const logPath = join(__dir, '../../test-cases/agent-log.md');
  if (existsSync(logPath)) {
    const log = readFileSync(logPath, 'utf-8');
    writeFileSync(logPath, log + logEntry);
  }
}

main().catch(console.error);
