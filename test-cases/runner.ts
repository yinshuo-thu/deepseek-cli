#!/usr/bin/env tsx
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load cases
const __dir = dirname(fileURLToPath(import.meta.url));
const casesPath = join(__dir, 'cases.json');
const data = JSON.parse(readFileSync(casesPath, 'utf-8'));

// CLI args: --domain=coding --id=COD-001 --limit=10
const args = process.argv.slice(2);
const domainFilter = args.find((a: string) => a.startsWith('--domain='))?.split('=')[1];
const idFilter = args.find((a: string) => a.startsWith('--id='))?.split('=')[1];
const limit = parseInt(args.find((a: string) => a.startsWith('--limit='))?.split('=')[1] ?? '5');

let cases = data.cases;
if (domainFilter) cases = cases.filter((c: any) => c.domain === domainFilter);
if (idFilter) cases = cases.filter((c: any) => c.id === idFilter);
cases = cases.slice(0, limit);

console.log(`\nDeepSeek CLI Test Runner`);
console.log(`Running ${cases.length} cases...\n`);

// For each case, call DeepSeek API directly using the project's API client
// Note: This requires DEEPSEEK_API_KEY to be set or config to be valid.
// For now, output the cases as prompts ready for manual testing or batch API calls.

const results: any[] = [];
for (const tc of cases) {
  console.log(`[${tc.id}] ${tc.domain.toUpperCase()} — ${tc.prompt.slice(0, 60)}...`);
  results.push({
    id: tc.id,
    domain: tc.domain,
    difficulty: tc.difficulty,
    tags: tc.tags,
    prompt: tc.prompt,
    expected_traits: tc.expected_traits,
    status: 'pending', // Will be filled by evaluate.ts after getting response
    response: null,
    score: null,
    timestamp: new Date().toISOString(),
  });
}

// Save manifest
const resultsDir = join(__dir, 'results');
mkdirSync(resultsDir, { recursive: true });
const manifestPath = join(resultsDir, `run-${Date.now()}.json`);
writeFileSync(manifestPath, JSON.stringify({ cases: results }, null, 2));

console.log(`\nCase manifest saved to: ${manifestPath}`);
console.log(`\nNext steps:`);
console.log(`  1. Run each prompt through deepseek-cli or API`);
console.log(`  2. Fill in 'response' field in the manifest`);
console.log(`  3. Run: tsx test-cases/evaluate.ts ${manifestPath}`);
