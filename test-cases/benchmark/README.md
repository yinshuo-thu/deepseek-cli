# Terminal Task Benchmark

Evaluates DeepSeek CLI agent performance across 5 dimensions, then compares alignment against a Claude baseline.

## Suite Overview

| Suite | Tasks | Weight (output) | Description |
|-------|-------|-----------------|-------------|
| HumanEval | 20 | 35% | TypeScript algorithmic problems |
| MBPP | 10 | 15% | Programming by example (TypeScript) |
| BashBench | 15 | 25% | Terminal command tasks |
| SWE-bench | 10 | 25% | Bug-fix tasks (TypeScript) |
| Process | — | 30% of overall | Tool-use quality metrics |

## Scoring Formulas

```
output_weighted = HE*0.35 + MBPP*0.15 + Bash*0.25 + SWE*0.25
overall         = output_weighted*0.70 + process*0.30
```

Alignment target: DeepSeek score / Claude score >= 90% on every dimension.

## How to Run Individual Suites

Each runner takes a JSON file mapping problem/task IDs to model response strings:

```json
{
  "HE-001": "```typescript\nfunction hasCloseElements(...) { ... }\n```",
  "HE-002": "..."
}
```

```bash
# HumanEval
tsx test-cases/benchmark/humaneval/runner.ts responses.json

# MBPP
tsx test-cases/benchmark/mbpp/runner.ts responses.json

# BashBench
tsx test-cases/benchmark/bashbench/runner.ts responses.json

# SWE-bench
tsx test-cases/benchmark/swebench/runner.ts responses.json
```

Each runner writes a results JSON file next to the responses file (e.g. `responses-he-results.json`). Copy or move them to the results directory with the expected names before aggregating:

- `he-results.json`
- `mbpp-results.json`
- `bash-results.json`
- `swe-results.json`
- `process-results.json`

## How to Aggregate

```bash
tsx test-cases/benchmark/aggregate/score.ts test-cases/benchmark/results 0
```

This reads all result files from the results directory and writes `benchmark_results_r0.json`. Missing suite files are treated as 0%.

## How to Compare Against Baseline

```bash
tsx test-cases/benchmark/aggregate/compare.ts \
  test-cases/benchmark/results/benchmark_results_r0.json \
  test-cases/benchmark/results/claude_baseline.json
```

Prints a per-dimension alignment table. Exits 0 if all dimensions reach the 90% alignment target, exits 1 otherwise.

## Process Metrics

Process metrics measure tool-use quality, not output correctness. The `process/metrics.ts` module evaluates:

- **required_hit_rate**: fraction of required tools actually used
- **sequence_score**: how well tool calls follow the preferred sequence
- **used_forbidden**: whether any forbidden tools were called

Task types and their patterns are defined in `process/patterns.json`.

## Directory Structure

```
test-cases/benchmark/
  shared/extract.ts          Code block extractor (used by all runners)
  humaneval/
    problems.json            20 HumanEval-style problems
    runner.ts                Evaluator
  mbpp/
    problems.json            10 MBPP-style problems
    runner.ts                Evaluator
  bashbench/
    tasks.json               15 bash command tasks
    runner.ts                Evaluator
  swebench/
    tasks.json               10 bug-fix tasks
    runner.ts                Evaluator
  process/
    patterns.json            Tool-use patterns per task type
    metrics.ts               Process evaluation logic
  aggregate/
    score.ts                 Aggregates suite results into one file
    compare.ts               Alignment comparison vs baseline
  results/                   Output directory for result JSON files
```
