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
description: Systematic security audit using Phase 3b checklist — OWASP Top 10, path traversal, injection, auth boundary, secret handling
short_summary: "Autonomous security audit for Exaix code: applies the Phase 3b nine-item checklist and writes findings with remediation steps."
version: "1.0"
topics: ["security", "owasp", "audit", "path-traversal", "injection", "auth", "secrets", "tdd"]
qwen_skill: security
---

```text
Key points
- This is a security-first audit — not a general code review.
- Apply the Phase 3b nine-item checklist to every step that touches input,
  file paths, auth, secrets, network, or process execution.
- Every finding must be classified 🔒 Security and written to a findings report.
- Findings require remediation steps in TDD-First format — tests before fixes.
- Use PathResolver for all file paths; never raw string concatenation.
- Never log, print, or store secrets; never include secrets in error messages.
- When auditing more than ~20 files, work in batches of 5–10: audit a batch, record findings, then continue.

Canonical prompt (short):
"Run a Phase 3b security audit on <files or feature>. Apply the nine-item
checklist, classify all findings, and write remediation steps."

Examples
- "#security packages/core/src/vault_service.ts — new encrypted storage service"
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
- #review   — General code review (use #security when 3+ security findings exist)
- #fix-bug  — Implement the fix for a specific finding
- #commit   — Structured commit after all security findings are remediated

Workflow chain:
  #review (found security issues) → **#security** → #fix-bug → #commit
```

---

## Instructions for Agent

You are performing a **systematic security audit** of the files or feature provided.

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

#### Item 2 — Path Traversal

- Are all file system paths routed through `PathResolver`?
- Is there any raw string concatenation constructing a path from user input?
- Does `PathResolver` verify the resolved path is within the allowed root?
- Are symlinks resolved before permission checks?

#### Item 3 — Secret Handling

- Are secrets (API keys, tokens, passwords) never logged, never stored in plain
  text, never included in error messages, never serialised to disk in readable form?
- Is the lifetime of a secret value (in memory) minimised?
- Are secrets loaded from environment variables or a secure store — never hardcoded?

#### Item 4 — Injection

- Is there any dynamic SQL constructed by string concatenation? (Use parameterised queries.)
- Is there any shell command constructed from user input? (Use argument arrays, not strings.)
- Is there any template rendering that could produce XSS or template injection?
- Is there any `eval` / `Function()` / `new Function()` call?

#### Item 5 — Auth Boundary

- Does every side-effect operation (write file, modify DB, call external API) check
  permissions before executing?
- Is the permission check performed after path resolution (not before)?
- Can a caller bypass the permission check by passing a pre-resolved path?

#### Item 6 — Error Leakage

- Do error messages include internal file paths, stack traces, secret values, or
  user data that should not be exposed?
- Are errors sanitised before being returned to the caller or logged?
- Is there a difference between internal error detail (for logs) and external error
  messages (for callers)?

#### Item 7 — TOCTOU (Time-of-Check Time-of-Use)

- Is a file existence check followed immediately by a file operation that assumes
  the file still exists?
- Is there a race condition between checking permissions and using the resource?
- Are atomic operations used where available (e.g., rename-based writes)?

#### Item 8 — Dependency Trust

- Is every new external import from a trusted, versioned source?
- Is the import pinned to a specific version (not `@latest`)?
- Are transitive dependencies reviewed for known CVEs?

#### Item 9 — Security Tests

- Is there at least one test per security control that verifies the control works?
- Do security tests cover the negative case (what happens when the control is triggered)?
- Are tests using real inputs — not mocks that bypass the validation logic?

---

### Phase 4 — Classify Findings

| Symbol      | Meaning                                                            |
| ----------- | ------------------------------------------------------------------ |
| 🔒 Security | Security control missing, incomplete, or bypassable (OWASP Top 10) |

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

1. Write findings and remediation steps to the relevant planning document
   (or create a new security findings document in `.copilot/planning/`).
2. Run `deno run --allow-read --allow-write scripts/markdown_lint.ts <doc>`.

---

### Phase 7 — CI Gates and Commit

For any remediation code written as part of this audit (test stubs, quick fixes):

```bash
deno lint <src-file> <test-file>
deno check <src-file>
deno task check:arch
deno fmt <src-file> <test-file>
```

Then use `#commit` for the structured commit. Type: `fix` or `security`.
Mandatory fields: `what:`, `rationale:`, `tests:`, `who:`, `impact:`.

---

## Related

- [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output Format

1. **Audit verdict** — ✅ No findings / ⚠️ Minor issues / ❌ Security issues found (blocks merge).
2. **Findings table** — one row per finding (item, OWASP, file, description).
3. **Detail section** — one block per finding with attack scenario and required fix.
4. **Remediation steps** — TDD-First steps ready for `#next-steps` or direct implementation.
5. **Next action** — use `#fix-bug` per finding, then `#commit` when all resolved.
6. **Commit payload** — structured commit message generated via `#commit` once all findings are remediated.
