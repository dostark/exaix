---
agent: copilot
scope: dev
title: jscpd Code Duplication Detection Guide
short_summary: "Using jscpd to detect and track code duplication in Exaix codebase"
version: "0.1"
topics: ["refactoring", "quality", "tools", "jscpd"]
---

## jscpd Code Duplication Detection Guide

## Quick Start

```bash
# Basic scan of source and tests
npx jscpd src/ tests/

# Generate JSON report for detailed analysis
npx jscpd src/ tests/ --reporters json --output ./jscpd-report

# Scan specific directory
npx jscpd src/tui/

# With HTML report
npx jscpd src/ tests/ --reporters html,json --output ./jscpd-report
```text

## Command Options

| Option         | Description                      | Example                         |
| -------------- | -------------------------------- | ------------------------------- |
| `--min-lines`  | Minimum lines to consider clone  | `--min-lines 5` (default: 5)    |
| `--min-tokens` | Minimum tokens to consider clone | `--min-tokens 50` (default: 50) |
| `--threshold`  | Fail if duplication exceeds %    | `--threshold 10`                |
| `--reporters`  | Output formats                   | `json`, `html`, `console`       |
| `--ignore`     | Patterns to ignore               | `--ignore "**/node_modules/**"` |
| `--format`     | Languages to scan                | `--format typescript`           |

## Understanding Output

### Console Output

```text
Clone found (typescript):
 - tests/ai/openai_provider_test.ts [64:2 - 78:13] (14 lines, 136 tokens)
   tests/ai/anthropic_provider_test.ts [44:2 - 56:12]
```text

Interpretation:

- **File 1**: `openai_provider_test.ts`, lines 64-78
- **File 2**: `anthropic_provider_test.ts`, lines 44-56
- **Size**: 14 lines, 136 tokens (larger = higher priority for refactoring)

### JSON Report Structure

```json
{
  "statistics": {
    "total": {
      "lines": 78636,
      "clones": 300,
      "duplicatedLines": 3340,
      "percentage": 4.2
    }
  },
  "duplicates": [...]
}
```text

## Duplication Thresholds

| Level       | Percentage | Action                            |
| ----------- | ---------- | --------------------------------- |
| 🟢 Good     | < 2%       | No action needed                  |
| 🟡 Warning  | 2-5%       | Monitor, refactor when convenient |
| 🟠 High     | 5-10%      | Plan refactoring phase            |
| 🔴 Critical | > 10%      | Immediate attention required      |

### Per-File Thresholds

| Level       | Percentage | Action                     |
| ----------- | ---------- | -------------------------- |
| 🟢 Good     | < 15%      | Acceptable                 |
| 🟡 Warning  | 15-30%     | Consider helper extraction |
| 🔴 Critical | > 30%      | Create extraction plan     |

## Common Duplication Patterns

### 1. Test Setup Duplication

```typescript
// BAD: Repeated across test files
const { db, tempDir, cleanup } = await initTestDbService();
const context = createTestContext(db);
// ... 10+ lines of setup

// GOOD: Extract to helper
const ctx = await createTestFixture();
```text

### 2. Provider Pattern Duplication

```typescript
// BAD: Same constructor in multiple providers
constructor(config: Config) {
  this.apiKey = config.apiKey || Deno.env.get("API_KEY");
  this.model = config.model || DEFAULT_MODEL;
}

// GOOD: Base class
export abstract class BaseProvider {
  constructor(config: Config, defaults: Defaults) {
    this.apiKey = config.apiKey || Deno.env.get(defaults.envKey);
    this.model = config.model || defaults.defaultModel;
  }
}
```text

### 3. Test Assertion Patterns

```typescript
// BAD: Same assertions repeated
assertEquals(result.status, "success");
assertEquals(result.data.length, 3);
assertExists(result.timestamp);

// GOOD: Custom assertion helper
assertSuccessResult(result, { dataLength: 3 });
```text

## Refactoring Workflow

1. **Run jscpd** to identify duplicates
   ```bash
   npx jscpd src/ tests/ --reporters json --output ./jscpd-report
   ```text

1.
   ```bash
   grep -o '"duplicatedTokens": [0-9]*' jscpd-report/jscpd-report.json | sort -t: -k2 -nr | head -20
   ```text

1.
   ```bash
   grep -B15 'filename.ts' jscpd-report/jscpd-report.json
   ```text

1.
   - Same file duplication → Extract method
   - Cross-file duplication → Extract helper/utility
   - Test duplication → Create test helper or fixture

1.
   - Create helper with tests
   - Refactor one usage
   - Verify tests pass
   - Refactor remaining usages

1.
   ```bash
   npx jscpd src/ tests/ --reporters json --output ./jscpd-report-after
   ```text

## Integration with CI

Add to pre-commit or CI pipeline:

```bash
# Fail if duplication > 5%
npx jscpd src/ tests/ --threshold 5

# Or specific directories
npx jscpd src/ai/ --threshold 3
```text

## Exaix-Specific Patterns

### Test Helper Locations

- `tests/helpers/` - General test utilities
- `tests/cli/helpers/` - CLI test setup
- `tests/integration/helpers/` - Integration test environment
- `tests/tui/helpers.ts` - TUI mocks and harnesses
- `tests/mcp/helpers/` - MCP server test setup

### When NOT to Deduplicate

1. **Intentional isolation** - Security tests should be standalone

1.
1.

## Current Status (2026-01-04)

- **Total clones**: 300
- **Duplicated lines**: 3,340 (4.2%)
- **Highest duplication files**:
  - `tests/ai/openai_provider_test.ts` (127%)
  - `tests/ai/anthropic_provider_test.ts` (91%)
  - `tests/services/request_router_test.ts` (78%)

See [phase-14-code-deduplication.md](../planning/phase-14-code-deduplication.md) for refactoring plan.

## References

- [jscpd GitHub](https://github.com/kucherenko/jscpd)
- [Testing Guidelines](testing.md)
- [Phase 14 Refactoring Plan](../planning/phase-14-code-deduplication.md)

```
