---
name: github-actions-ci
agent: general
tools:
  - read_file
  - search_files
  - run_command
scope: dev
title: "GitHub Actions CI Diagnosis (#github-actions-ci)"
description: Diagnose GitHub Actions state for a precise commit — check status, the first failing step, and local reproduction, read-only by default
short_summary: "Report commit-specific CI checks with evidence, classify absent, unavailable, pending and failed, and never act beyond read-only inspection."
version: "1.0.0"
topics: ["ci", "github-actions", "diagnosis", "triage"]
qwen_skill: github-actions-ci
---

```text
Key points

- Diagnose one repository and one commit. Never mix results from another SHA.
- Read-only by default: inspect, do not rerun, cancel, push, open a PR, or merge. This skill
  grants no action authority. `run_command` stays subject to the agent-role permission set.
- Absent, unavailable, pending and failed are four different outcomes. Do not collapse them.
- Every claim names the command, the commit, and the output it came from.
- A baseline or known-bad failure stays explicit and is never attributed to the change.

1. Resolve the target
   - Record the repository and the full commit SHA. Use the branch head only when the request
     names the branch and gives no SHA.
   - Record the workflow runs and check suites for that SHA.

2. Collect check state
   - Use read-only commands: `gh pr checks`, `gh run list --commit <sha>`,
     `gh run view <id> --log-failed`.
   - Record the exact command and its exit status with each result.

3. Classify each check
   - pending: queued or in progress.
   - success: completed with a success conclusion.
   - failure: completed with a failure, cancelled, or timed-out conclusion.
   - absent: no check exists for this SHA.
   - unavailable: authentication, network, or permission error prevented a result.

4. Report
   - Per check: name, status, conclusion, and job link.
   - The first substantive failing step with the log excerpt that proves it.
   - A local reproduction command when an existing repository command matches; otherwise the
     exact not-reproducible reason.
   - The baseline state of a failure that predates the change.

5. Stop
   - Do not propose or perform rerun, cancel, push, PR, or merge without explicit
     authorization. Do not edit a workflow file to make a check pass.

Canonical prompt (short):
"Diagnose CI for {repo} at {sha}. Report each check, the first failing step, and a local
reproduction. Read-only; no rerun, cancel, push, PR or merge."

Examples
- "#github-actions-ci diagnose the failing check on 9f2c1ab"
- "#github-actions-ci why is main red"

Output format
   1. Repository and commit SHA.
   1. Per-check table: name, status, conclusion, link.
   1. First failing step and its evidence excerpt.
   1. Reproduction command, or the exact reason none exists.
   1. Unavailable and absent evidence, stated separately.

Do / Don't
- ✅ Report the SHA with every result.
- ✅ Separate absent, unavailable, pending and failed.
- ✅ Quote the failing log line that supports the diagnosis.
- ❌ Treat "no checks" as success.
- ❌ Carry a passing result from an older SHA.
- ❌ Infer permission to rerun, cancel, push, or merge from permission to inspect.

Related
- #infra — CI pipeline and configuration changes
- #fix-bug — reproduce and fix the failing check
```
