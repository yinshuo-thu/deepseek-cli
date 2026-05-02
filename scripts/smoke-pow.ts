// Smoke test for the pure-JS DeepSeekHashV1 / PoW solver.
//
// Verifies the implementation against the ground-truth vectors lifted from
// ds2api/pow/deepseek_pow_test.go. Without these passing, the live PoW
// flow in dswebClient.ts cannot succeed.

import {
  buildPrefix,
  bytesToHex,
  deepSeekHashV1,
  solvePow,
  solveAndBuildPowHeader,
} from '../src/auth/pow.js';

interface HashVec {
  in: string;
  want: string;
}

const HASH_VECTORS: HashVec[] = [
  // Source: ds2api/pow/deepseek_pow_test.go lines 14-19.
  { in: '', want: 'e594808bc5b7151ac160c6d39a02e0a8e261ed588578403099e3561dc40c26b3' },
  { in: 'testsalt_1700000000_42', want: 'd4a2ea58c89e40887c933484868380c6f803eaa8dc53a3b9df8e431b921a4f09' },
  { in: 'testsalt_1700000000_100000', want: 'abea2f35796b65486e9be1b36f7878c66cab021e96faa473fdf4decd31f9ba30' },
  { in: 'abc123salt_1700000000_12345', want: '74b3b7452745b70e85eb32ee7f0a9ec0381d42dd5137b695da915e104fc390e1' },
];

interface SolveVec {
  salt: string;
  expire: number;
  answer: number;
  diff: number;
}

const SOLVE_VECTORS: SolveVec[] = [
  // Source: ds2api/pow/deepseek_pow_test.go lines 31-37.
  { salt: 'testsalt', expire: 1700000000, answer: 42, diff: 1000 },
  { salt: 'testsalt', expire: 1700000000, answer: 500, diff: 2000 },
  { salt: 'abc123salt', expire: 1700000000, answer: 12345, diff: 20000 },
];

let exitCode = 0;
const enc = new TextEncoder();

console.log('--- DeepSeekHashV1 hash vectors ---');
for (const v of HASH_VECTORS) {
  const got = bytesToHex(deepSeekHashV1(enc.encode(v.in)));
  const ok = got === v.want;
  console.log(`  hash(${JSON.stringify(v.in)}) = ${got} ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) {
    exitCode = 1;
    console.error(`    expected ${v.want}`);
  }
}

console.log('--- SolvePow round-trip vectors ---');
for (const v of SOLVE_VECTORS) {
  const input = buildPrefix(v.salt, v.expire) + String(v.answer);
  const challengeHex = bytesToHex(deepSeekHashV1(enc.encode(input)));
  let got: number;
  const t0 = Date.now();
  try {
    got = solvePow(challengeHex, v.salt, v.expire, v.diff);
  } catch (err) {
    console.error(`  solve salt=${v.salt} expire=${v.expire} diff=${v.diff}: FAIL — ${(err as Error).message}`);
    exitCode = 1;
    continue;
  }
  const elapsed = Date.now() - t0;
  const ok = got === v.answer;
  console.log(`  solve salt=${v.salt} answer=${got} (want ${v.answer}, diff=${v.diff}, ${elapsed}ms) ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) exitCode = 1;
}

console.log('--- solveAndBuildPowHeader round-trip ---');
{
  // Mirrors TestSolveAndBuildHeader: salt=salt, expire=1712345678, answer=777,
  // difficulty=2000. We compute the challenge hash ourselves so the harness
  // is fully self-contained.
  const expire = 1712345678;
  const salt = 'salt';
  const answer = 777;
  const challengeHex = bytesToHex(deepSeekHashV1(enc.encode(buildPrefix(salt, expire) + String(answer))));
  const header = solveAndBuildPowHeader({
    algorithm: 'DeepSeekHashV1',
    challenge: challengeHex,
    salt,
    expire_at: expire,
    difficulty: 2000,
    signature: 'sig',
    target_path: '/api/v0/chat/completion',
  });
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { answer: number };
  const ok = decoded.answer === 777;
  console.log(`  header.answer = ${decoded.answer} ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) exitCode = 1;
}

if (exitCode === 0) {
  console.log('smoke-pow: ok');
} else {
  console.error('smoke-pow: FAIL');
}
process.exit(exitCode);
