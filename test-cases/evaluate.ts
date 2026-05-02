#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: tsx evaluate.ts <results/run-xxx.json>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

interface TraitResult {
  trait: string;
  pass: boolean;
  reason: string;
}

function evaluateTraits(response: string, traits: string[]): TraitResult[] {
  return traits.map((trait: string) => {
    const lower = trait.toLowerCase();
    const responseL = response.toLowerCase();
    // Heuristic: check if key terms from the trait appear in the response
    const keywords = lower.split(/\s+or\s+|\s+and\s+|[,()[\]]/g)
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 3 && !['with', 'that', 'this', 'from', 'have', 'been', 'will'].includes(k));
    const matchCount = keywords.filter((k: string) => responseL.includes(k)).length;
    const pass = matchCount >= Math.max(1, Math.floor(keywords.length * 0.5));
    return {
      trait,
      pass,
      reason: pass
        ? `matched ${matchCount}/${keywords.length} keywords`
        : `only ${matchCount}/${keywords.length} keywords found`,
    };
  });
}

let totalScore = 0;
let totalCases = 0;

for (const tc of manifest.cases) {
  if (!tc.response) {
    console.log(`[${tc.id}] SKIPPED — no response`);
    continue;
  }
  const traitResults = evaluateTraits(tc.response, tc.expected_traits);
  const passed = traitResults.filter((t: TraitResult) => t.pass).length;
  const score = Math.round((passed / traitResults.length) * 100);
  tc.trait_results = traitResults;
  tc.score = score;
  tc.status = score >= 60 ? 'pass' : 'fail';

  totalScore += score;
  totalCases++;

  const icon = score >= 80 ? 'PASS' : score >= 60 ? 'WARN' : 'FAIL';
  console.log(`[${tc.id}] ${icon} ${score}/100 — ${tc.domain}`);
  traitResults.forEach((t: TraitResult) => {
    console.log(`  ${t.pass ? 'PASS' : 'FAIL'} ${t.trait}`);
  });
}

const avgScore = totalCases > 0 ? Math.round(totalScore / totalCases) : 0;
console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${totalCases} cases evaluated`);
console.log(`Average score: ${avgScore}/100`);
console.log(`Pass (>=60): ${manifest.cases.filter((c: any) => c.status === 'pass').length}`);
console.log(`Fail (<60): ${manifest.cases.filter((c: any) => c.status === 'fail').length}`);

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nResults updated in: ${manifestPath}`);
