# Sample Responses — DeepSeek CLI Phase 3 Alignment
Date: 2026-05-03

These five cases (one per sampled domain) define the concrete pass/fail bar for the Dev Agent.

---

## Case 1: COD-001 — Running Average (coding / easy)

**Prompt:**
> Write a TypeScript function that takes an array of numbers and returns the running average.

**Expected traits from cases.json:**
- `uses reduce or loop`
- `returns number[]`
- `handles empty array`
- `has TypeScript types`

### PASSING response (key traits)

```typescript
function runningAverage(nums: number[]): number[] {
  if (nums.length === 0) return [];
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < nums.length; i++) {
    sum += nums[i]!;
    result.push(sum / (i + 1));
  }
  return result;
}
```

A passing response:
1. Uses a fenced `typescript` code block
2. Has explicit type annotation: `nums: number[]` parameter and `: number[]` return type
3. Has an explicit empty-array guard (`if (nums.length === 0) return []`)
4. Uses a loop or `reduce` (not an ambiguous approach)
5. Computes a running (cumulative) average, not a single average

**Trait-by-trait evaluation:**
| Trait | How to test |
|-------|------------|
| `uses reduce or loop` | Response body contains `for`, `while`, `forEach`, or `.reduce` |
| `returns number[]` | Return type annotation is `number[]`, and the function returns an array |
| `handles empty array` | Response contains a branch that returns early or returns `[]` for empty input |
| `has TypeScript types` | Both parameter and return value have explicit `: type` annotations |

### FAILING response (what it misses)

```
Here's a running average function:

function runningAverage(nums) {
  let sum = 0;
  return nums.map((n, i) => {
    sum += n;
    return sum / (i + 1);
  });
}
```

This fails because:
- No TypeScript type annotations (parameter is untyped `nums`, no return type)
- No empty-array guard (would return `[]` incidentally, but no explicit handling)
- No fenced code block with language tag
- Plain JavaScript, not TypeScript

**Current system prompt failure mode:** "Be concise" + no instruction to add types = model produces minimal JS-style code without annotations.

---

## Case 2: MAT-003 — System of Equations (math / easy)

**Prompt:**
> Solve the system of equations: 2x + 3y = 12 and x - y = 1.

**Expected traits from cases.json:**
- `x = 3 or solution shown`
- `y = 2`
- `substitution or elimination method`

### PASSING response (key traits)

A passing response:
1. Names the method: "Using substitution:" or "Using elimination:"
2. Shows each algebraic step on its own line
3. Arrives at x = 3 and y = 2 explicitly
4. Optionally verifies: "Check: 2(3) + 3(2) = 12 ✓"

Example structure:
```
Using substitution:

From equation 2: x = y + 1

Substitute into equation 1:
2(y + 1) + 3y = 12
2y + 2 + 3y = 12
5y = 10
y = 2

Then x = y + 1 = 3

Solution: x = 3, y = 2
```

**Trait-by-trait evaluation:**
| Trait | How to test |
|-------|------------|
| `x = 3 or solution shown` | Response contains "x = 3" or "x=3" (case-insensitive) |
| `y = 2` | Response contains "y = 2" or "y=2" |
| `substitution or elimination method` | Response contains "substitut" or "eliminat" (substring match) |

### FAILING response (what it misses)

```
x = 3, y = 2.
```

This fails because:
- No method named
- No steps shown — grader cannot verify the model understands the technique
- The `substitution or elimination method` trait cannot be confirmed

**Current system prompt failure mode:** "Be concise. Stop when the task is done." encourages bare-answer responses with no working shown.

---

## Case 3: DBG-004 — Floating Point (debugging / easy)

**Prompt:**
> Why does `0.1 + 0.2 !== 0.3` in JavaScript?

**Expected traits from cases.json:**
- `floating point`
- `IEEE 754`
- `toFixed or epsilon fix`
- `binary representation`

### PASSING response (key traits)

A passing response:
1. Names the root cause: IEEE 754 double-precision floating-point
2. Explains binary representation (0.1 cannot be exactly represented in binary)
3. Shows a concrete fix — at least one of: `toFixed()`, `Number.EPSILON`, or rounding helper
4. Includes a code snippet demonstrating the fix

Example structure:
```
Root cause: IEEE 754 binary floating point

JavaScript uses 64-bit IEEE 754 doubles. The value 0.1 cannot be
represented exactly in binary — it becomes a repeating fraction, like
1/3 in decimal. When you add two of these approximations, the tiny
errors accumulate.

  0.1 + 0.2 === 0.30000000000000004  // actual value

Fix options:
```javascript
// Option 1: toFixed for display
(0.1 + 0.2).toFixed(1) === "0.3"

// Option 2: epsilon comparison for logic
Math.abs((0.1 + 0.2) - 0.3) < Number.EPSILON
```

**Trait-by-trait evaluation:**
| Trait | How to test |
|-------|------------|
| `floating point` | Response contains "floating point" or "float" |
| `IEEE 754` | Response contains "IEEE 754" or "IEEE-754" |
| `toFixed or epsilon fix` | Response contains "toFixed" or "EPSILON" or "epsilon" |
| `binary representation` | Response contains "binary" in context of the number representation |

### FAILING response (what it misses)

```
This is a floating point precision issue. Use toFixed() to round results
before comparing them.
```

This fails because:
- "IEEE 754" not mentioned
- Binary representation not explained
- No code block showing the fix
- Technically correct but graders checking for specific terms will mark it as incomplete

**Current system prompt failure mode:** No instruction to name the root cause precisely; no instruction to show a code fix.

---

## Case 4: REF-005 — Deeply Nested If-Else (refactoring / medium)

**Prompt:**
> Suggest how to refactor deeply nested if-else (4 levels deep) for readability.

**Expected traits from cases.json:**
- `early return`
- `guard clauses`
- `extract function`
- `reduce nesting`

### PASSING response (key traits)

A passing response:
1. Names at least two distinct techniques: guard clauses/early return, and extract function
2. Shows a before/after code example illustrating the transformation
3. Explains why the refactoring improves readability

Example structure:

**Before (problematic):**
```javascript
function process(user) {
  if (user) {
    if (user.isActive) {
      if (user.hasPermission) {
        if (user.plan === 'pro') {
          // actual logic
        }
      }
    }
  }
}
```

**After (guard clauses):**
```javascript
function process(user) {
  if (!user) return;
  if (!user.isActive) return;
  if (!user.hasPermission) return;
  if (user.plan !== 'pro') return;

  // actual logic — now at zero indentation
}
```

Additional technique: extract each condition check into a named function to further reduce nesting.

**Trait-by-trait evaluation:**
| Trait | How to test |
|-------|------------|
| `early return` | Response contains "early return" or shows `return` statements inside conditions |
| `guard clauses` | Response contains "guard clause" or describes the early-return pattern |
| `extract function` | Response contains "extract" + "function" or equivalent |
| `reduce nesting` | Response describes or demonstrates reducing indentation depth |

### FAILING response (what it misses)

```
You can reduce nesting by using early returns or by breaking the function
into smaller pieces. This makes the code easier to read.
```

This fails because:
- No code example — traits like "guard clauses" cannot be confirmed from prose alone
- Does not name "guard clauses" explicitly
- Extract function is only implied ("smaller pieces"), not demonstrated
- "reduce nesting" is mentioned but not shown

**Current system prompt failure mode:** No instruction to show before/after code; no instruction to name the design pattern applied.

---

## Case 5: EXP-001 — HTTPS/TLS (explanation / medium)

**Prompt:**
> Explain how HTTPS/TLS works in simple terms.

**Expected traits from cases.json:**
- `handshake`
- `certificate`
- `symmetric key`
- `encryption analogy`

### PASSING response (key traits)

A passing response:
1. Covers the TLS handshake phase by name
2. Explains the role of the certificate (identity verification)
3. Explains that asymmetric crypto is used to negotiate a symmetric key, then the symmetric key does the actual encryption
4. Uses at least one analogy (common: padlock + key, sealed envelope, secret code words)

Example structure:
```
HTTPS is HTTP with TLS encryption layered on top. Here's how it works:

1. Handshake — When you connect to https://example.com, your browser and
   the server do a "handshake": they agree on which encryption to use and
   the server proves its identity with a certificate.

2. Certificate — The certificate is like a government-issued ID: it proves
   the server is really example.com and not an impostor. It's signed by a
   trusted Certificate Authority (CA).

3. Key exchange — Using asymmetric encryption (think: a lock only the server
   can open), your browser and server secretly agree on a shared "session key"
   without ever sending it over the wire in plain text.

4. Symmetric encryption — From that point on, all data is encrypted with
   that symmetric session key — much faster than asymmetric crypto.

Analogy: it's like passing a locked box to someone; only they have the key
to open it, so they can send you a secret code, and from then on you both
use that code to talk privately.
```

**Trait-by-trait evaluation:**
| Trait | How to test |
|-------|------------|
| `handshake` | Response contains "handshake" |
| `certificate` | Response contains "certificate" |
| `symmetric key` | Response contains "symmetric" in context of the key or encryption |
| `encryption analogy` | Response contains a metaphor comparing TLS to a real-world scenario |

### FAILING response (what it misses)

```
HTTPS uses TLS to encrypt traffic. The server has a certificate signed by a
Certificate Authority. Your browser verifies it and then data is encrypted.
```

This fails because:
- No mention of "handshake"
- No explanation of symmetric vs asymmetric — just says "encrypted"
- No analogy
- Technically correct but too thin to satisfy the grader on 3 of 4 traits

**Current system prompt failure mode:** "Be concise" + no instruction to include an analogy = model produces a correct but thin answer that misses the example and handshake steps that make explanations checkable.

---

## Summary: What the Dev Agent Should Implement

All five cases fail in the same way: the current system prompt optimizes for brevity and file-manipulation agentry, leaving no guidance for response quality on conversational queries. The fixes are additive — the new domain-quality instructions sit alongside the existing agentic conventions without conflicting.

The single most valuable change: **override "use markdown sparingly" for code**. Fenced code blocks are not "markdown decoration" — they are the primary delivery artifact for ~40% of all test cases. Every case in coding, debugging, and refactoring requires at least one fenced block to pass.

Full recommended text is in `alignment-gap-report.md` under "Recommended System Prompt Additions".
