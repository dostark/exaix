---
name: security
agent: senior-coder
tools:
  - read_file
  - search_files
  - run_command
  - patch_file
scope: dev
title: "Security Skill (#security)"
description: Systematic security audit mapping the OWASP-Top-10 checklist (path traversal, injection, auth, secrets) onto Exaix's concrete trust boundaries, reusing its canonical security primitives
short_summary: "Autonomous security audit for Exaix code: applies the Phase 3b nine-item checklist against Exaix's real trust boundaries, reuses the canonical security primitives, and writes findings with TDD remediation steps."
version: "1.1.0"
topics: [
  "security",
  "owasp",
  "audit",
  "path-traversal",
  "injection",
  "auth",
  "secrets",
  "tdd",
  "mcp",
  "portal",
  "run-command",
  "deno-permissions",
  "sandbox",
  "webhook",
]
qwen_skill: security
---

```text
Key points
- This is a security-first audit — not a general code review.
- Exaix's core threat model is MALICIOUS LLM OUTPUT: every tool call, path,
  command, and expression the agent emits is attacker-influenced. Audit the
  boundary that constrains agent output, not the agent's good intentions.
- Start from the Exaix Attack Surface Map below — it lists every trust boundary,
  the canonical control that defends it, and the regression test that proves it.
- Apply the Phase 3b nine-item checklist to every step that touches input,
  file paths, auth, secrets, network, or process execution.
- REUSE the canonical primitives (PathSecurity.resolveWithinRoots, PathResolver,
  validateGitArguments/validateRuntimeArguments, safe_expression, the Host/Origin
  guard, the ACTIVITY_COLUMNS allowlist). A new bespoke check is a smell — prefer
  routing through the existing boundary.
- Containment is two-layer and asymmetric: the Deno permission set is
  DEFENSE-IN-DEPTH only (it is not a hard boundary while `--allow-ffi` is
  required by the SQLite journal); the container (Dockerfile / compose.sandbox)
  is the AUTHORITATIVE boundary. Never argue a control is safe "because the Deno
  sandbox would catch it."
- Every finding must be classified 🔒 Security and written to a findings report.
- Findings require remediation steps in TDD-First format — tests before fixes.
  A security test must assert rejection-by-VALIDATION, not rejection-by-runtime
  -failure (a missing file or a thrown native error is not proof the control fired).
- Use PathResolver / PathSecurity for all file paths; never raw string `..` checks.
- Never log, print, or store secrets; never include secrets in error messages.
  Access-denied errors must be GENERIC — never echo the host path that was denied.
- When auditing more than ~20 files, work in batches of 5–10: audit a batch, record findings, then continue.

Canonical prompt (short):
"Run a Phase 3b security audit on <files or feature>. Map it to the Exaix Attack
Surface, apply the nine-item checklist, classify all findings, and write TDD
remediation steps that reuse the canonical primitives."

Examples
- "#security packages/mcp/server/handlers/patch_file_tool.ts — new file-mutation tool"
- "#security packages/triggers/adapters/ — external event ingestion adapters"
- "#security — audit all changes in the current PR for security gaps"

Do / Don't
- ✅ Do read the source — never trust the plan's description of security controls.
- ✅ Do check every input path (CLI args, config files, JSON payloads, env vars).
- ✅ Do verify PathResolver is used for every file-system operation.
- ✅ Do check that secrets are scoped to the minimal necessary lifetime.
- ✅ Do require at least one security test per finding's security control.
- ✅ Do include OWASP reference for each finding (e.g., A01 Broken Access Control).
- ❌ Don't flag style issues as security — keep the report focused.
- ❌ Don't accept "will fix later" for 🔒 Security findings — they block merge.
- ❌ Don't skip test requirements — a control without a test is as good as no control.

Related skills:
- #review-code — General code review (use #security when 3+ security findings exist)
- #fix-bug  — Implement the fix for a specific finding
- #commit   — Structured commit after all security findings are remediated

Workflow chain:
  #review-code (found security issues) → **#security** → #fix-bug → #commit
```

## See also

- [exaix-development](../exaix-development/SKILL.md) — system constraints, path validation, security modes
- [test-development](../test-development/SKILL.md) — [security]-tagged test patterns

---

## Instructions for Agent

You are performing a **systematic security audit** of the files or feature provided.

The order of operations is: **(1)** locate the change on the Exaix Attack Surface Map,
**(2)** confirm it routes through that surface's canonical control (or flag that it
doesn't), **(3)** apply the Phase 3b checklist, **(4)** classify and write TDD
remediation that reuses the primitives.

---

### Exaix Attack Surface Map

Exaix is a **local-first, single-user** agent harness whose threat model is
**malicious or manipulated LLM output**. The agent proposes tool calls, file
paths, shell commands, and flow expressions; the security boundary is the code
that **validates those proposals before they take effect**. Audit the boundary.

| #  | Surface                                                      | Entry point                                                                    | Canonical control                                                                                                                                                             | Regression test                                                                                              |
| -- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| S1 | **MCP file tools** (read/write/move/delete/patch/mkdir/list) | `packages/mcp/server/handlers/*_tool.ts` → `tool_handler.ts:resolvePortalPath` | `PathSecurity.resolveWithinRoots(rel, [realRoot], realRoot)` over `await Deno.realPath(portalPath)`                                                                           | ``packages/mcp/tests/mcp_symlink_traversal_security_test.ts``                                                  |
| S2 | **`run_command` tool**                                       | `packages/tool-runtime/src/tool_registry.ts:execute`                           | `validateGitArguments` + `validateRuntimeArguments`; cwd scoped via `getAllowedRoots()` + `resolveWithinRoots`                                                                | `packages/tool-runtime/tests/run_command_security_test.ts`, `tests/security/git_security_regression_test.ts` |
| S3 | **Portal filesystem** (Workspace/Portals path access)        | `packages/portal/src/path_resolver.ts:PathResolver.validatePath`               | realPath of target (or nearest existing ancestor) checked within allowed roots                                                                                                | `packages/portal/tests/path_resolver_symlink_security_test.ts`                                               |
| S4 | **Flow condition expressions**                               | `packages/flow/src/condition_evaluator.ts` → `safe_expression.ts`              | `validateExpression` / `evaluateExpression` over a JSON-projected context; allowlisted roots `results`/`request`/`flow`; NO `new Function`/`eval`                             | `tests/security/condition_evaluator_sandbox_test.ts`                                                         |
| S5 | **Local HTTP / SSE endpoint**                                | ``packages/mcp/server/server.ts`:handleHTTPRequest`, `sse_handler.ts`            | 127.0.0.1 bind + `isLoopbackHost`/`rejectUnsafeOrigin` (DNS-rebind/CSRF); SSE `validateTraceId` (UUID) + concurrent-stream cap                                                | ``packages/mcp/tests/http_security_test.ts``, `tests/integration/api/sse_handler_test.ts`                      |
| S6 | **External triggers** (webhooks)                             | `packages/triggers/adapters/webhook_adapter.ts:parse`                          | MANDATORY HMAC-SHA256, fail-closed (no secret ⇒ reject every payload); size cap                                                                                               | `packages/triggers/tests/external_adapters_test.ts`                                                          |
| S7 | **Activity journal / storage**                               | `packages/storage-sqlite/src/database_service.ts`                              | Parameterized queries everywhere; identifiers (e.g. `filter.distinct`) allowlisted via `ACTIVITY_COLUMNS`                                                                     | `packages/storage-sqlite/tests/db_journal_test.ts`                                                           |
| S8 | **Secrets in memory**                                        | `packages/core/src/helpers/credential_security.ts:SecureCredentialStore`       | Best-effort in-memory obfuscation — **NOT a hard boundary**; never logged/serialized                                                                                          | `tests/security/credential_security_test.ts`                                                                 |
| S9 | **Process containment**                                      | `deno.json` tasks, `Dockerfile`, `compose.sandbox.yaml`                        | Scoped `--allow-run` allowlist + `*:unsafe` opt-ins (defense-in-depth); container = authoritative (cap-drop, read-only rootfs, no-new-privileges, non-root, `--network none`) | `tests/security/deno_permissions_policy_test.ts`, `tests/security/subprocess_isolation_test.ts`              |

**Boundary invariant:** because the SQLite journal binds native code (`@db/sqlite`
→ `Deno.dlopen`) the daemon currently REQUIRES `--allow-ffi`, so the Deno
permission set cannot be a hard escape boundary — treat it as defense-in-depth
and treat the **container** as the real containment layer. (Removing this
dependency is tracked in `exaix-dev-docs/planning/phase-110-security-hardening-followups.md`.)

### Reusable Security Primitives (prefer these over a new check)

| Primitive                                                | Module                                            | Use it for                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `PathSecurity.resolveWithinRoots(input, roots, rootDir)` | `@exaix/tool-runtime` (`path_security.ts`)        | Any path derived from agent/tool input; resolves symlinks and rejects escapes                    |
| `PathResolver.validatePath`                              | `packages/portal/src/path_resolver.ts`            | Workspace/Portal path validation in services                                                     |
| `validateGitArguments` / `validateRuntimeArguments`      | `packages/tool-runtime/src/tool_registry.ts`      | Vetting `run_command` argv before spawn                                                          |
| `validateExpression` / `evaluateExpression`              | `packages/flow/src/safe_expression.ts`            | Evaluating any agent/flow-authored boolean expression — never `new Function`                     |
| `MCPServer.isLoopbackHost` / `rejectUnsafeOrigin`        | ``packages/mcp/server/server.ts``                   | Guarding any new local HTTP route (Host/Origin)                                                  |
| `ACTIVITY_COLUMNS` allowlist pattern                     | `packages/storage-sqlite/src/database_service.ts` | Any SQL where an identifier (column/table) comes from input — identifiers can't be parameterized |
| Mandatory-HMAC fail-closed pattern                       | `packages/triggers/adapters/webhook_adapter.ts`   | Any new external-event ingestion adapter                                                         |

> The full catalogue of prior findings and their fixes lives in
> `exaix-dev-docs/dev/Exaix_Security_Vulnerability_Analysis.md`. Read it before
> auditing a surface — it records what was already exploitable and how it was closed.

---

### Phase 3b — Nine-Item Security Checklist

Apply each item to every code path that processes external data, accesses the file
system, handles auth/permissions, uses secrets, makes network calls, executes
sub-processes, or touches shared mutable state.

#### Item 1 — Input Validation

- Are all external inputs (CLI args, JSON/TOML payloads, env vars, user-provided
  file paths) validated with Zod or explicit type guards before use?
- Are inputs validated at the system boundary — not deep in business logic?
- Are unknown / extra fields stripped or rejected?
- **In Exaix:** tool-call args arrive as agent output — validate them in the
  MCP handler against the tool's Zod schema (`@exaix/schemas`) before the handler
  touches the filesystem or spawns anything. Config is validated by `ConfigSchema`;
  don't re-parse it ad hoc.

#### Item 2 — Path Traversal

- Are all file system paths routed through `PathResolver` / `PathSecurity`?
- Is there any raw string concatenation or string `..`/`startsWith` check
  constructing or guarding a path from agent/tool input?
- Does the resolver verify the **realPath** is within the allowed root?
- Are symlinks resolved (`Deno.realPath`) **before** the boundary check?
- **In Exaix:** MCP handlers must go through `tool_handler.ts:resolvePortalPath`
  → `PathSecurity.resolveWithinRoots` (S1); services use `PathResolver.validatePath`
  (S3). A handler that does `join(portalPath, rel)` then `rel.startsWith("..")` is
  the exact pattern Findings 3/8 fixed — flag it. Non-existent targets must resolve
  the nearest existing ancestor, not skip the check.

#### Item 3 — Secret Handling

- Are secrets (API keys, tokens, passwords) never logged, never stored in plain
  text, never included in error messages, never serialised to disk in readable form?
- Is the lifetime of a secret value (in memory) minimised?
- Are secrets loaded from environment variables or a secure store — never hardcoded?
- **In Exaix:** provider API keys flow via env → `SecureCredentialStore` (S8),
  which is **best-effort obfuscation, not a hard boundary** — do not represent it
  as encryption-at-rest. Verify keys never reach the Activity Journal (`EventLogger`
  payloads) or webhook/error strings. The HMAC `secret` (S6) is equally sensitive.

#### Item 4 — Injection

- Is there any dynamic SQL constructed by string concatenation? (Use parameterised queries.)
- Is there any SQL **identifier** (column/table/order-by) taken from input? Identifiers
  can't be parameterized — they MUST be allowlisted.
- Is there any shell command constructed from user input? (Use argument arrays, not strings.)
- Is there any `eval` / `Function()` / `new Function()` / dynamic `import()` of an
  input-derived specifier?
- **In Exaix:** journal queries (S7) parameterize values and allowlist identifiers
  via `ACTIVITY_COLUMNS` (Finding 12). Flow conditions (S4) must use `safe_expression`,
  never `new Function` (Finding 1). `run_command` (S2) takes an argv array and runs
  `validateGitArguments`/`validateRuntimeArguments` — confirm new subcommands/flags
  (`-c`, `-C`, `--allow-*`, code-executing runtimes) stay blocked.

#### Item 5 — Auth Boundary

- Does every side-effect operation (write file, modify DB, call external API) check
  permissions before executing?
- Is the permission check performed **after** path resolution (not before)?
- Can a caller bypass the permission check by passing a pre-resolved path?
- **In Exaix:** portal writes go through the permission model before mutation, and
  the path is realPath-resolved first (S1/S3) so a symlink can't smuggle the write
  outside the portal. New local HTTP routes (S5) must pass the Host/Origin guard
  before any routing. The local endpoint has **no bearer auth yet** (Finding 5
  residual) — for multi-user exposure, that is a gap, not an accepted state.

#### Item 6 — Error Leakage

- Do error messages include internal file paths, stack traces, secret values, or
  user data that should not be exposed?
- Are errors sanitised before being returned to the caller or logged?
- Is there a difference between internal error detail (for logs) and external error
  messages (for callers)?
- **In Exaix:** access-denied errors are deliberately **generic** ("Access denied:
  path is outside the allowed directories") — the denied host path goes only to the
  journal `payload.allowed_roots`, never to the caller (Finding 10). A new error that
  interpolates the rejected path into the message is a regression.

#### Item 7 — TOCTOU (Time-of-Check Time-of-Use)

- Is a file existence check followed immediately by a file operation that assumes
  the file still exists?
- Is there a race condition between checking permissions and using the resource?
- Are atomic operations used where available (e.g., rename-based writes)?
- **In Exaix:** the workspace is the database — writes use the write-then-rename
  atomic pattern. Path realPath-resolution + permission check + use should be as
  tight as possible; background HNSW/index writers must use atomic rename, not
  in-place mutation.

#### Item 8 — Dependency Trust

- Is every new external import from a trusted, versioned source, pinned in `deno.lock`?
- Is the import pinned to a specific version (not `@latest`)?
- Are transitive dependencies reviewed for known CVEs?
- **In Exaix:** native/FFI dependencies are the sharpest risk — `@db/sqlite` pulls a
  native `.so` via `@denosaurs/plug` at runtime (unverified provenance) and forces
  `--allow-ffi` (S9). Any new FFI/WASM/native dep must be justified against this cost;
  prefer pure-TS or Deno built-ins (e.g. `node:sqlite`).

#### Item 9 — Security Tests

- Is there at least one test per security control that verifies the control works?
- Do security tests cover the negative case (what happens when the control is triggered)?
- Do they assert **rejection-by-validation** (e.g. `result.error` includes "not
  allowed" / "Access denied"), not rejection-by-runtime-failure (a missing file or a
  native throw can make a test green without the control ever firing)?
- Are tests using real inputs — not mocks that bypass the validation logic?
- **In Exaix:** place cross-cutting security tests in `tests/security/`; tag the test
  name with `[security]` so `deno task test:security` actually runs it (the filter
  matches the bracket tag, not a `security:` prefix). Reference the matching surface
  test from the Attack Surface Map as the template.

---

### Known Anti-Patterns (from prior Exaix audits)

These are the recurring shapes the 13-finding audit found. Treat each as a grep
target — if you see the left column, you likely have the right column.

| Anti-pattern (what you see)                                                | Why it's a finding                                                     | Correct pattern                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `new Function(expr)` / `eval` to evaluate a flow or agent expression       | Arbitrary code execution from LLM output (Finding 1)                   | `safe_expression.validateExpression`/`evaluateExpression`                               |
| `join(root, rel)` then `rel.startsWith("..")`                              | String check misses symlinks + encoded traversal (Findings 3, 8)       | `PathSecurity.resolveWithinRoots` over `Deno.realPath(root)`                            |
| `--allow-all` / `-A` on an operational `deno.json` task                    | Grants the daemon full host access by default (Finding 2)              | Scoped `--allow-*` + `--allow-run=<allowlist>`; keep `-A` only on `*:unsafe` opt-ins    |
| `run_command` allowing `deno test`/`status`, or `-A`/`--allow-*` in argv   | Test-runner / permission-flag bypass to run arbitrary code (Finding 4) | `validateRuntimeArguments` allowlist; reject `--allow-*` anywhere                       |
| `git -c core.x=…` / `-C <dir>` reachable via `run_command`                 | Config-injection → command execution (Finding 7)                       | `validateGitArguments` exact-match block on `-c`/`-C` (subcommand allowlist still open) |
| Local HTTP route with no Host/Origin check                                 | DNS-rebinding + CSRF against the loopback daemon (Finding 5)           | `isLoopbackHost` + `rejectUnsafeOrigin` before routing                                  |
| Webhook/event adapter that accepts unsigned payloads when no secret is set | Forged external triggers (Finding 9)                                   | Fail closed: no secret ⇒ reject; mandatory HMAC verify                                  |
| SQL with an interpolated identifier (`SELECT DISTINCT ${field}`)           | Identifier injection — identifiers can't be parameterized (Finding 12) | Allowlist the identifier (`ACTIVITY_COLUMNS.has(field)`)                                |
| Error message echoing the rejected/denied host path                        | Information disclosure of the host layout (Finding 10)                 | Generic denial message; host path → journal payload only                                |
| Unbounded streams/subscriptions/timers per request                         | Local resource-exhaustion DoS (Finding 13)                             | Injectable cap + idempotent cleanup on disconnect/cancel                                |
| `zeroOutString`-style "secure wipe" of an immutable JS string              | No-op that misrepresents the security guarantee (Finding 11)           | Remove the theatre; document the store as best-effort                                   |

### Phase 4 — Classify Findings

| Symbol      | Meaning                                                            |
| ----------- | ------------------------------------------------------------------ |
| 🔒 Security | Security control missing, incomplete, or bypassable (OWASP Top 10) |

**Exaix severity context:** weight a finding by which boundary it crosses. A
bypass that escapes the **container** (S9) or executes arbitrary code from LLM
output (S2/S4) is Critical; one that only defeats the Deno permission layer while
the container still contains it is High-or-below (defense-in-depth, not the hard
boundary). State which Attack-Surface row (S1–S9) the finding sits on.

Every finding must include:

- **OWASP category** (A01–A10)
- **Affected code** (file + symbol)
- **Attack scenario** (how it could be exploited)
- **Required fix** (specific, not vague)
- **Required test** (named test that verifies the fix)

---

### Phase 5 — Write Remediation Steps

For each finding, write a TDD-First remediation step:

```markdown
### Security Fix <N>: <title>

**OWASP:** <category>
**Severity:** 🔒 Security

**Finding:** <detailed explanation>
**Attack scenario:** <how it could be exploited>

**Actions:**

- `<file>`: <specific change required>

**Architecture Notes:** <why this fix is correct in the Exaix security model>

**Planned Tests:**

- `"security: <control> rejects <attack vector>"` — verifies the control fires
- `"security: <control> allows <legitimate input>"` — verifies no false positives

**Success Criteria:**

- [ ] PathResolver / Zod / parameterised query / etc. is used
- [ ] Security test passes
- [ ] No secrets in logs or error messages
```

---

### Phase 6 — Finalize

1. Append findings + remediation steps to the canonical security report at
   `exaix-dev-docs/dev/Exaix_Security_Vulnerability_Analysis.md` (keep its
   numbering and status conventions), and add the Attack-Surface row (S1–S9)
   each finding belongs to. Open security work is tracked in
   `exaix-dev-docs/planning/phase-110-security-hardening-followups.md`.
2. Run `deno run --allow-read --allow-write scripts/markdown_lint.ts <doc>`.

---

### Phase 7 — CI Gates and Commit

For any remediation code written as part of this audit (test stubs, quick fixes):

```bash
deno lint <src-file> <test-file>
deno check <src-file>
deno task check:arch
deno task check:style          # boundaries: TUI/CLI must not import services directly
deno task test:security        # runs [security]-tagged tests across tests/
deno fmt <src-file> <test-file>
```

Then use `#commit` for the structured commit. Type: `fix` (the commit-message
validator does not accept `security` as a type; use `fix` and name the surface in
`what:`). Mandatory fields: `what:`, `rationale:`, `tests:`, `who:`, `impact:` —
and the `impact:` component before `:` must appear verbatim in `what:`.

---

## Related

- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output Format

1. **Audit verdict** — ✅ No findings / ⚠️ Minor issues / ❌ Security issues found (blocks merge).
2. **Findings table** — one row per finding (surface S1–S9, item, OWASP, file, description).
3. **Detail section** — one block per finding with attack scenario, the canonical
   primitive it should reuse, and the required fix.
4. **Remediation steps** — TDD-First steps ready for `#next-steps` or direct implementation.
5. **Next action** — use `#fix-bug` per finding, then `#commit` when all resolved.
6. **Commit payload** — structured commit message generated via `#commit` once all findings are remediated.

---
exaix:
  skill_id: security
  triggers:
    keywords: [security, audit, OWASP, vulnerability, exploit]
    task_types: [feature, bugfix, security]
    tags: [security, audit]
  constraints:
    - "Map OWASP Top 10 checklist to Exaix trust boundaries"
    - "Reuse canonical security primitives (PathSecurity, PathResolver, validateGitArguments)"
    - "Include TDD remediation steps with each finding"
    - "Every finding classified as Security (not general code review)"
  output_requirements:
    - "Security findings per OWASP category"
    - "File:line references for each finding"
    - "TDD remediation steps with tests before fixes"
  quality_criteria:
    - name: owasp_coverage
      description: All applicable OWASP categories checked
      weight: 35
    - name: remediation_completeness
      description: Each finding has concrete remediation
      weight: 35
    - name: evidence_quality
      description: Findings reference specific file:line
      weight: 30
---
