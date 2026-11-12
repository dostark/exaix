# Phase 235 Step 5 — github-actions-ci skill review

- Reviewer: DeepSeek V4.1 Flash 1017 (opencode-go)
- Date: 2026-11-12
- Skill: `.copilot/skills/github-actions-ci`
- Method: document review for the prose cases; executed test and commands for the
  deterministic cases.
- `SKILL.md` sha256: `9c2f1dad58bc669b9d6fdcd42fc45b45adae96ce4806167438bac6290fba2c48`
- `exaix.yaml` sha256: `917b1ffb77ee2eeddb0cca6913d9ba8ddd128a4048945a18e2b12ebbfdf133af`

## Limitation

The prose cases show that the guidance covers each condition. They do not measure model
behavior or value. The count and discovery cases were executed.

## Cases

| Case | Input | Expected | Evidence | Outcome |
| --- | --- | --- | --- | --- |
| `p235-s5-c1` | No checks exist for the SHA | `absent`, not success | `Classify each check`: "absent: no check exists for this SHA"; Do/Don't: "Treat 'no checks' as success" | pass (document review) |
| `p235-s5-c2` | All jobs passed on an older SHA | Does not satisfy the newer commit | Key points: "Never mix results from another SHA"; Do/Don't: "Carry a passing result from an older SHA" | pass (document review) |
| `p235-s5-c3` | An authentication error | `unavailable`, not absent workflow | `Classify each check`: "unavailable: authentication, network, or permission error prevented a result" | pass (document review) |
| `p235-s5-c4` | Permission to inspect CI | No cancellation or push inferred | Key points: read-only; "This skill grants no action authority"; Do/Don't: "Infer permission to rerun, cancel, push, or merge from permission to inspect" | pass (document review) |
| `p235-s5-c5` | A new real folder before the count update | The catalog test and the production count reject it | `tests/scripts/check_skills_test.ts` 8/8 after GREEN; the pre-update run failed with "expected 28 folders, found 29" | pass (executed test) |
| `p235-s5-c6` | Catalog-valid skill without prompt or Qwen entry | Invocation discovery incomplete | `.qwen/settings.json` entry and generated prompt both present; `check:qwen-skills-sync` passes | pass (executed command) |
| `p235-s5-c7` | Prompt and Qwen entry present | Both resolve the canonical folder, no copied workflow body | `.copilot/prompts/github-actions-ci.prompt.md` points to `.copilot/skills/github-actions-ci/SKILL.md`; `check:qwen-skills-sync` passes | pass (executed command) |

## Tool list and read-only posture

- Frontmatter tools: `read_file`, `search_files`, `run_command`. No `write_file`, no
  `patch_file`.
- The body states that `run_command` stays subject to the agent-role permission set, so the
  read-only rule is structural where the sidecar can express it and role-gated where it
  cannot.
