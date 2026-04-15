---
agent: copilot
scope: dev
title: Exaix Source Development Guidelines
short_summary: "Guidance for developing Exaix source code: TDD-first, patterns, project structure, and best practices."
version: "0.1"
topics: ["source", "development", "tdd", "patterns"]
---

Key points

- Strict TDD-first approach: write failing tests before implementation
- Follow step-specific Success Criteria in `docs/Exaix_Implementation_Plan.md`
- Keep Problems tab clean: fix TypeScript errors, linter issues, and remove `any` types before marking a step complete

Canonical prompt (short):
"You are a repository-aware coding assistant for Exaix. Consult `.copilot/manifest.json` and include the `short_summary` for relevant docs before replying. Follow the TDD-first workflow: suggest tests first, implement minimal code, and add verification steps."

Examples

- "Add unit tests for a service's error handling and implement the minimal change to pass them."
- "Refactor module X to reduce duplication while keeping behavior unchanged; provide tests demonstrating equivalence."

Do / Don't

- ✅ Do follow TDD and verify Success Criteria
- ✅ Do add module-level documentation and file headers
- ❌ Don't proceed with implementation if no refined Implementation Plan step exists

Examples section

- Example prompt: "You are an engineer. Propose a set of failing tests that validate behavior X. Output JSON with test names and assertions."

## Full migration: Source guidelines (extended)

### Project Structure

- `src/ai/` — AI/LLM provider implementations
- `src/cli/` — CLI command implementations
- `src/config/` — Configuration schemas and loaders
- `src/parsers/` — File parsers (frontmatter, etc.)
- `src/schemas/` — Zod validation schemas
- `src/services/` — Core business logic services
- `src/services/request_analysis/` — Request intent analysis (Phase 45)
- `src/services/portal_knowledge/` — Portal codebase analysis (Phase 46)
- `src/services/quality_gate/` — Request quality gate & clarification protocol (Phase 47):
  - `heuristic_assessor.ts` — zero-cost text-signal scoring
  - `llm_assessor.ts` — LLM assessment with heuristic fallback
  - `request_enricher_llm.ts` — LLM body rewriter
  - `request_quality_gate.ts` — orchestrator + `buildQualityGateConfig()`
  - `clarification_engine.ts` — multi-turn Q&A loop producing `IRequestSpecification`
  - `clarification_persistence.ts` — atomic `_clarification.json` read/write
  - `mod.ts` — barrel export
- `src/main.ts` — Application entry point

### Module Documentation

Always include file-level documentation with responsibilities and the Implementation Plan step the module implements. Use clear section separators for large files, and include types/interfaces near the top.

### Type Definitions

Export types that consumers need and keep internal types private. Provide thorough JSDoc or TypeScript comments for public types.

Refer to [CODE_STYLE.md](../../CODE_STYLE.md) for the full set of typing and style rules such as strict type safety, constant usage, import placement, DI patterns, environment variable handling, etc.

### Configuration Schema

Use Zod for config validation and keep config options in `exa.config.toml` examples. Provide default values and bounds where possible.

### Service Pattern — Dependency Injection & Interfaces

Exaix enforces an **Interface-first, Constructor Injection** policy for all services.

- **Every injectable service exposes an interface.** `class Foo` → `export interface IFoo`. Consumers depend on `IFoo`, never on `Foo`.
- **Constructor injection only.** Pass `config`, `db`, `provider`, and peer services via constructors. Module-level singletons and static accessors are prohibited.
- **Test mocks implement the full interface.** Never use `as any` or object-literals to fake a service.
- **Prefer narrow interfaces.** Declare only the methods a consumer actually calls. This reduces coupling and makes mocking lighter.

```typescript
// ✅ GOOD — interface + constructor injection
export interface IGitService { commit(msg: string): Promise<void>; }
export class GitService implements IGitService { ... }

export class PlanExecutor {
  constructor(private git: IGitService, private db: IDatabaseService) {}
}

// ❌ BAD — concrete dependency / singleton access
constructor(private git: GitService) {}
const git = GitService.getInstance();
```

### System Constraints & Patterns

- **Runtime Persistence**: The .exa/Active, Workspace/Requests, and Workspace/Plans folders are the "Database". Code must respect file-system atomicity (use `writeTextFile` with atomic renaming where possible).
- **Activity Journal**: All side-effects (file writes, executions, errors) MUST be logged to the Activity Journal (`.exa/journal.db`) via `EventLogger`.
- **Security Modes**:
  - **Sandboxed**: No network, no file access (default).
  - **Hybrid**: Read-only access to specific "Portal" paths.
  - **Note**: Always use `PathResolver` to validate paths before access.
- **MCP Enforcement**: In Hybrid mode, agents can read files directly but MUST use MCP tools for writes (to ensure auditability).
- **Intent Analysis**: Requests can trigger the `RequestAnalyzer` via the `--analyze` flag. This layer extracts goals, constraints, requirements, and complexity to a `req_analysis.json` artifact. In the current pipeline, `RequestProcessor` can pass `SessionMemory` context into analysis, and structured frontmatter (`acceptance_criteria`, `expected_outcomes`, `scope`) is treated as explicit high-confidence input. Use the centralized `AnalysisMode` / `AnalyzerEngine` types from `src/types/request.ts` (Phase 45).
- **Request Quality Gate** (Phase 47): `RequestQualityGate` (`src/services/quality_gate/`) runs on every request _before_ agent/flow routing. Assessment modes: `heuristic` (zero-cost), `llm`, `hybrid` (heuristic-first, LLM for borderline scores). Results in one of four outcomes: `proceed`, `auto-enrich`, `needs-clarification` (Q&A loop → `REFINING` status), or `reject` (`FAILED` status). Config wired via `buildQualityGateConfig(config.quality_gate ?? {})` in `RequestProcessor` constructor. CLI: `exactl request clarify <id> [--interactive|--answer|--proceed|--cancel]`. Key interfaces/schemas: `IRequestQualityGateService`, `IRequestQualityAssessment`, `IClarificationSession`, `IRequestSpecification`. New statuses: `REFINING`, `NEEDS_CLARIFICATION`, `ENRICHING`.
- **Portal Knowledge Gathering** (Phase 46): `PortalKnowledgeService` (`src/services/portal_knowledge/`) builds a structured analysis snapshot of every portal codebase — file census, key files, config parsing, pattern detection, architecture inference, and (deep mode) symbol extraction via `deno doc`. Results persist to `Memory/Projects/{alias}/knowledge.json` (validated by `PortalKnowledgeSchema` in `src/shared/schemas/portal_knowledge.ts`). Always use `PortalKnowledgeService.getOrAnalyze()` rather than raw file reads when agents need codebase context. Modes: `quick` (fast, no LLM), `standard` (all non-LLM strategies), `deep` (full, includes `SymbolExtractor`). Configured via `[portal_knowledge]` TOML section. CLI: `exactl portal analyze <alias>`, `exactl portal knowledge <alias>`.
  - Directory: `src/services/portal_knowledge/` — `directory_analyzer.ts`, `config_parser.ts`, `key_file_identifier.ts`, `pattern_detector.ts`, `architecture_inferrer.ts`, `symbol_extractor.ts`, `portal_knowledge_service.ts`, `knowledge_persistence.ts`
  - Interface: `IPortalKnowledgeService` in `src/services/portal_knowledge/interfaces.ts`
  - Config interface: `IPortalKnowledgeConfig` — fields: `defaultMode`, `quickScanLimit`, `maxFilesToRead`, `staleness` (hours), `useLlmInference`, `ignorePatterns`, `autoAnalyzeOnMount`
- **Acceptance Criteria Propagation** (Phases 48–49): `CriteriaGenerator` (`src/services/criteria_generator.ts`) converts `IRequestAnalysis` (Phase 45 output) into `EvaluationCriterion[]` for use by quality gates. Goals become `goal_*` criteria; acceptance criteria become `ac_*` criteria. Set `includeRequestCriteria: true` on a gate step (or on `flow.settings`) to enable. `GateEvaluator` merges dynamic criteria with static gate criteria (static wins on name collision). `ReflexiveAgent.run()` accepts an optional third `requestAnalysis?` parameter; when provided, the critique prompt includes a structured requirements block, capped by `MAX_CRITIQUE_REQUIREMENTS`, and the critique output carries `requirementsFulfillment[]` (MET/PARTIAL/MISSING per requirement). `ConfidenceScorer.assess()` accepts an optional fourth `critique?` parameter; when `critique.requirementsFulfillment` is non-empty, goal alignment is factored into the confidence score: `finalScore = rawScore × 0.7 + goalAlignmentScore × 100 × 0.3`. Request complexity selection is now multi-signal: analysis-derived complexity first, then content heuristics, then agent fallback. Key constants in `src/shared/constants.ts`: `MAX_DYNAMIC_CRITERIA`, `DEFAULT_GOAL_WEIGHT`, `PRIORITY_1_GOAL_WEIGHT`, `ACCEPTANCE_CRITERION_WEIGHT`, `GOAL_ALIGNMENT_CONFIDENCE_WEIGHT`, `EXISTING_SCORE_CONFIDENCE_WEIGHT`.

### Configuration Constants & Magic Numbers

**ALL magic numbers MUST be configurable constants** centralized appropriately:

- **Production code:** `src/config/constants.ts`
- **Test code:** `tests/config/constants.ts` for test-specific constants (test prompts, mock data, test environment variables, etc.)

Never use hardcoded numeric literals in business logic or test code.

**Requirements:**

- ✅ Extract ALL numeric literals > 1 into named constants
- ✅ Group related constants by module/feature in `constants.ts`
- ✅ Use descriptive names with `DEFAULT_` prefix for production, `TEST_` prefix for test constants
- ✅ Import and use constants instead of literals
- ✅ Update constants file when adding new configurable values
- ✅ Keep test-specific constants (test prompts, mock API keys, test messages) in `tests/config/constants.ts`

**Examples:**

```typescript
// ❌ BAD: Magic numbers in code
const timeout = 30000;
const maxRetries = 3;
const delay = Math.pow(2, attempt) * 100;

// ✅ GOOD: Configurable constants
import {
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_MAX_RETRIES,
  DEFAULT_GIT_RETRY_BACKOFF_BASE_MS,
} from "../config/constants.ts";

const timeout = DEFAULT_GIT_COMMAND_TIMEOUT_MS;
const maxRetries = DEFAULT_GIT_MAX_RETRIES;
const delay = Math.pow(2, attempt) * DEFAULT_GIT_RETRY_BACKOFF_BASE_MS;

// ✅ GOOD: Test-specific constants
import * as TEST_CONSTANTS from "./config/constants.ts";

const testPrompt = TEST_CONSTANTS.REGRESSION_TEST_PROMPT;
const apiKey = Deno.env.get(TEST_CONSTANTS.ENV_GOOGLE_API_KEY);
```

**Constants File Structure:**

- Group constants by module/feature with clear section headers
- Include JSDoc comments explaining purpose and units
- Use consistent naming patterns
- Keep related constants together
- Separate test constants from production constants

### Environment Variable Configuration (Phase 28)

**Pattern:** Always validate environment variable inputs via Zod schema

Exaix supports only 4 production environment variables for runtime overrides:

- `EXA_LLM_PROVIDER` - Override AI provider (validated against ProviderType enum)
- `EXA_LLM_MODEL` - Override model name (must be non-empty)
- `EXA_LLM_BASE_URL` - Override API endpoint (must be valid URL)
- `EXA_LLM_TIMEOUT_MS` - Override timeout (1000-300000ms, validated)

**Requirements:**

- ✅ Use `getValidatedEnvOverrides()` for production env vars
- ✅ Use `isTestMode()` and `isCIMode()` helpers for test detection
- ✅ Use `EXA_TEST_*` prefix for all test-related environment variables
- ✅ Never use direct `Deno.env.get()` for `EXA_LLM_*` vars without validation
- ✅ All env vars validated via Zod schema in `src/config/env_schema.ts`

**Examples:**

```typescript
// ✅ GOOD: Validated env var usage
import { getValidatedEnvOverrides, isCIMode, isTestMode } from "../config/env_schema.ts";

const envOverrides = getValidatedEnvOverrides();
const provider = envOverrides.EXA_LLM_PROVIDER ?? config.ai?.provider ?? DEFAULT_PROVIDER;
const model = envOverrides.EXA_LLM_MODEL ?? config.ai?.model ?? DEFAULT_MODEL;

// Check test mode
if (isTestMode()) {
  // Skip timer-based operations in tests
}

// Check CI mode
if (isCIMode() && !Deno.env.get("EXA_TEST_ENABLE_PAID_LLM")) {
  // Skip paid API tests in CI
}

// ❌ BAD: Direct env var access without validation
const provider = Deno.env.get("EXA_LLM_PROVIDER"); // No validation!
const timeout = Number(Deno.env.get("EXA_LLM_TIMEOUT_MS")); // Could be invalid!
```

**Validation Benefits:**

- Invalid values are rejected with clear warnings
- Type safety enforced (URLs, numbers, enums)
- Prevents runtime errors from misconfigured env vars
- Consistent error handling across codebase

---

## Code Patterns & Anti-Patterns

Based on systematic code review and fixes implemented in Phase 22, here are the established patterns and anti-patterns for Exaix development.

### ✅ REQUIRED PATTERNS

#### 1. Non-Blocking Async Operations

**Pattern**: Always use non-blocking alternatives to synchronous operations

```typescript
// ✅ GOOD: Non-blocking delay
private delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ❌ BAD: Blocking synchronous delay
await new Promise(resolve => setTimeout(resolve, ms)); // Blocks event loop
```

#### 2. Timeout Protection for External Operations

**Pattern**: All subprocess, network, and external operations must have configurable timeouts

```typescript
// ✅ GOOD: Timeout-protected subprocess
const cmd = new Deno.Command("git", {
  args,
  stdout: "piped",
  stderr: "piped",
  signal: AbortSignal.timeout(DEFAULT_GIT_COMMAND_TIMEOUT_MS),
});
```

#### 3. Secure Path Validation

**Pattern**: All file paths must be validated against canonical real paths to prevent traversal attacks

```typescript
// ✅ GOOD: Secure path resolution
import { PathSecurity } from "../utils/path_security.ts";
const securePath = await PathSecurity.resolveAndValidate(path, allowedRoots);
```

#### 4. Proper Synchronization for Concurrent Operations

**Pattern**: Use file locking or queuing to prevent race conditions in concurrent file operations

```typescript
// ✅ GOOD: File locking for concurrent access
await this.withFileLock(filePath, async () => {
  // Safe concurrent file operations
});
```

#### 5. Registry Pattern for Service Decoupling

**Pattern**: Use registry patterns to decouple factory classes from concrete implementations

```typescript
// ✅ GOOD: Registry-based provider creation
const provider = await ProviderRegistry.create(options);
```

#### 6. Interface-first Dependency Injection

**Pattern**: Every injectable service declares an `IFoo` interface; all consumers depend on the interface, not the class. Dependencies injected via constructor only.

```typescript
// ✅ GOOD
export interface IEventLogger { info(action: string): Promise<void>; }
export class EventLogger implements IEventLogger { ... }

export class PlanExecutor {
  constructor(private logger: IEventLogger, private db: IDatabaseService) {}
}
```

**Pattern**: Each method should have exactly one JSDoc block with complete documentation

```typescript
// ✅ GOOD: Single comprehensive JSDoc
/**
 * Create an LLM provider based on environment and configuration.
 * @param config Exaix configuration object
 * @returns Configured IModelProvider instance
 * @throws {ProviderFactoryError} Missing required API key
 */
static create(config: Config): IModelProvider
```

#### 10. Top-Level Imports

**Pattern**: All import statements must be placed at the top of the module to ensure static analysis and bundle optimization

```typescript
// ✅ GOOD: Top-level imports
import { join } from "@std/path";
import { MyService } from "./service.ts";

export class MyClass {
  // ...
}
```

#### 7. Error Boundaries and Isolation

**Pattern**: Isolate failures to prevent cascading corruption of execution contexts

```typescript
// ✅ GOOD: Error boundary isolation
try {
  await this.executeStep(stepId);
} catch (error) {
  stepResults.set(stepId, createFailedStepResult(error));
  // Continue with other steps
}
```

#### 8. Classified Error Handling

**Pattern**: Classify errors into specific types with appropriate HTTP/JSON-RPC codes

```typescript
// ✅ GOOD: Classified error responses
if (error instanceof ValidationError) {
  return { code: -32602, message: "Invalid params", data: error.details };
}
```

#### 9. File Locking for Concurrent Access

**Pattern**: Use exclusive file locks for read-modify-write operations on shared files

```typescript
// ✅ GOOD: Atomic file operations with locking
await this.withFileLock(`${filePath}.lock`, async () => {
  const content = await Deno.readTextFile(filePath);
  const updated = modifyContent(content);
  await Deno.writeTextFile(filePath, updated);
});
```

### ❌ PROHIBITED ANTI-PATTERNS

#### 1. Blocking Synchronous Operations

**Anti-pattern**: Never use synchronous delays, file operations, or blocking calls in async contexts

```typescript
// ❌ BAD: Blocking operations
setTimeout(() => {}, 1000); // Blocks event loop
Deno.readTextFileSync(path); // Synchronous file I/O
```

#### 2. Missing Timeout Protection

**Anti-pattern**: Never execute external commands without timeout protection

```typescript
// ❌ BAD: No timeout protection
const cmd = new Deno.Command("git", { args: ["status"] });
await cmd.output(); // Can hang indefinitely
```

#### 3. Path Traversal Vulnerabilities

**Anti-pattern**: Never use unvalidated paths or string concatenation for file operations

```typescript
// ❌ BAD: Path traversal vulnerable
const fullPath = `${baseDir}/${userInput}`; // Allows ../../../etc/passwd
await Deno.readTextFile(fullPath);
```

#### 4. Race Conditions in File Operations

**Anti-pattern**: Never perform concurrent read-modify-write operations without synchronization

```typescript
// ❌ BAD: Race condition prone
const content = await Deno.readTextFile(file);
const updated = modify(content);
await Deno.writeTextFile(file, updated); // Can conflict with concurrent operations
```

#### 5. Tight Coupling Between Services

**Anti-pattern**: Never directly instantiate concrete classes where an `IFoo` interface exists, and never use `as any` to pass a mock of a service

```typescript
// ❌ BAD: Tight coupling
export class ProviderFactory {
  static create(): IProvider {
    return new OpenAIProvider(); // Direct instantiation
  }
}

// ❌ BAD: as any mock
const logger = { info: () => {} } as any; // Missing interface compliance
```

#### 6. Duplicate JSDoc Blocks

**Anti-pattern**: Never have multiple JSDoc comment blocks for the same method

```typescript
// ❌ BAD: Duplicate JSDoc
/**
 * Method description
 */
/**
 * Method description.
 */
static method() {}
```

#### 7. Missing Error Isolation

**Anti-pattern**: Never allow single failures to corrupt entire execution contexts

```typescript
// ❌ BAD: No error isolation
const results = await Promise.all(steps.map((step) => execute(step)));
// One failure can corrupt the entire results array
```

#### 8. Generic Error Handling

**Anti-pattern**: Never catch all errors generically without proper classification

```typescript
// ❌ BAD: Generic error handling
try {
  await operation();
} catch (error) {
  throw new Error("Operation failed"); // Loses error context
}
```

#### 9. File Operations Without Locking

**Anti-pattern**: Never perform read-modify-write on shared files without exclusive locks

```typescript
// ❌ BAD: Unlocked file operations
const data = JSON.parse(await Deno.readTextFile("shared.json"));
data.counter++;
await Deno.writeTextFile("shared.json", JSON.stringify(data));
// Can cause data corruption with concurrent access
```

#### 10. Nested Imports

**Anti-pattern**: Never place import statements inside functions or conditional blocks unless absolutely necessary for conditional loading (and document why)

```typescript
// ❌ BAD: Dynamic import inside function
async function process() {
  const { heavy } = await import("./heavy_module.ts");
}
```

### Implementation Verification

**All code changes must be verified against these patterns:**

- ✅ Passes all unit tests with comprehensive coverage
- ✅ No blocking operations in async contexts
- ✅ All external operations have timeout protection
- ✅ All file paths are securely validated
- ✅ Concurrent operations are properly synchronized
- ✅ Error handling follows classification patterns
- ✅ No duplicate documentation blocks
- ✅ File operations use appropriate locking mechanisms

**Pre-commit Checklist:**

- [ ] No synchronous operations in async methods
- [ ] All external commands have timeout protection
- [ ] File paths validated against canonical real paths
- [ ] Concurrent file operations use exclusive locks
- [ ] Error handling provides classified responses
- [ ] JSDoc is single block per method with complete documentation
- [ ] Constants used instead of magic numbers
- [ ] Injectable services implement an `IFoo` interface; constructors accept interfaces, not concrete classes
- [ ] All tests pass with >90% coverage
- [ ] **On a feature branch, not `main`** (Gate 0 blocks direct commits on `main`)
- [ ] **Working tree is clean before any rebase/pull** (pre-rebase hook enforces this)

---
