# DeepSeek CLI — Test Case Alignment Framework

## Purpose

This framework enables systematic comparison between DeepSeek CLI responses and expected Claude Code-quality outputs. By running 100 structured test cases across 10 domains, you can quantify alignment gaps and guide targeted improvements to the CLI's prompting, tooling, and response quality.

## Structure

```
test-cases/
  cases.json       — All 100 test cases with expected traits
  runner.ts        — Generates a run manifest from selected cases
  evaluate.ts      — Scores responses against expected traits
  results/         — Output manifests from each run (gitignored except .gitkeep)
  README.md        — This file
```

## Domains (10 cases each, 100 total)

| Domain | ID Prefix | Description |
|--------|-----------|-------------|
| coding | COD | TypeScript/JS implementation tasks |
| math | MAT | Mathematical reasoning and explanation |
| writing | WRI | Prose, email, documentation, creative |
| debugging | DBG | Bug identification and fixes |
| refactoring | REF | Code improvement patterns |
| explanation | EXP | Technical concept explanations |
| creative | CRE | Creative tasks, naming, humor |
| analysis | ANA | Architectural and technical tradeoffs |
| data | DAT | SQL, schemas, data engineering |
| qa | QNA | General CS knowledge Q&A |

## How to Run

### Step 1: Generate a run manifest

Run all cases (default limit 5):

```bash
tsx test-cases/runner.ts
```

Filter by domain:

```bash
tsx test-cases/runner.ts --domain=coding --limit=10
```

Run a single case:

```bash
tsx test-cases/runner.ts --id=COD-001
```

Run all 100 cases:

```bash
tsx test-cases/runner.ts --limit=100
```

This creates a manifest file at `test-cases/results/run-<timestamp>.json` with all selected cases in `pending` status.

### Step 2: Fill in responses

Open the manifest file and fill in the `response` field for each case. You can:

- Run the prompt through `deepseek-cli` interactively and paste the output
- Use the DeepSeek API directly and programmatically populate responses
- Use any other method to get model responses for each prompt

### Step 3: Evaluate responses

```bash
tsx test-cases/evaluate.ts test-cases/results/run-<timestamp>.json
```

This scores each case 0-100 based on trait matching and updates the manifest in place.

## Scoring System

Each test case has `expected_traits` — a list of heuristic descriptions of what a high-quality response should contain.

For each trait, the evaluator:
1. Extracts keywords from the trait description (splitting on "or", "and", punctuation)
2. Checks how many keywords appear in the model response (case-insensitive)
3. Passes if at least 50% of keywords are found (minimum 1)

The case score is: `(traits_passed / total_traits) * 100`

- Score >= 80: PASS (high quality)
- Score 60-79: WARN (acceptable but improvable)
- Score < 60: FAIL (needs improvement)

## Using Results to Guide Improvements

After evaluating, look for patterns in failing cases:

- **Domain failures**: If all `coding` cases fail, the model may need better system prompting for code generation
- **Trait failures**: If "TypeScript types" consistently fails, the model may need nudging to use explicit types
- **Difficulty patterns**: If `hard` cases consistently fail, consider breaking them into smaller steps

Results are stored in `test-cases/results/` for comparison across runs as you iterate on the CLI.

## Case Format

```json
{
  "id": "COD-001",
  "domain": "coding",
  "difficulty": "easy|medium|hard",
  "prompt": "The exact prompt to send to the model",
  "expected_traits": ["trait 1", "trait 2"],
  "tags": ["typescript", "function"]
}
```

## Adding New Cases

Edit `cases.json` directly. Follow the ID convention: `XXX-NNN` where `XXX` is the 3-letter domain prefix and `NNN` is zero-padded sequence number. Keep IDs unique.
