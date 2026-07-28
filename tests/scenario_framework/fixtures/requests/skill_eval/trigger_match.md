---
trace_id: "skill-trigger-match-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
tags: [self-critique, architecture-review, error-handling]
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
trigger path. Two of the tags above are chosen precisely because this body cannot reach the
skills they belong to by any other route: `self-critique` is declared only by
`reflexive-critique` and `architecture-review` only by the skill of that name, and neither
word — nor any synonym the keyword scorer would pick up — appears in a request about
exception paths. So a match on either skill is proof the tag channel carried it, not the
keyword channel. `error-handling` is the opposite case, reachable both ways, and is kept so
the fixture still exercises a normal tag/keyword agreement alongside the discriminating two.
