---
trace_id: "skill-trigger-match-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
tags: [review, quality, error-handling]
---

# Review error handling in the request processing pipeline

Review the error handling and exception paths in Exaix's request processing pipeline.
Examine `packages/request/src/request_processor.ts` and the surrounding catch blocks to
identify:

- Exception paths that can escape uncaught and terminate request processing silently
- Catch blocks that swallow an error without journalling it, so the failure is invisible
  in the Activity Journal
- Error messages that omit the trace_id or request id needed to correlate a failure
- Retry and fallback behaviour when a downstream service throws
- Specific remediation for each issue found, ordered by severity

Acceptance criteria:

- Every uncaught exception path is listed with its file and line
- Each swallowed error is classified as either intentional (with justification) or a defect
- The recommendations are concrete enough to implement without further investigation

NOTE FOR MAINTAINERS: this request deliberately carries NO `skills:` frontmatter. Explicit
`request.skills` pinning short-circuits trigger matching entirely — AgentRunner resolves the
pinned ids and never calls `matchSkills` — so a fixture that pins skills cannot exercise the
trigger path. The `tags` above and the keywords in this body are what the matcher scores
against: `review`/`quality` reach the code-review skill, and `error`/`exception`/`catch`
reach error-handling.
