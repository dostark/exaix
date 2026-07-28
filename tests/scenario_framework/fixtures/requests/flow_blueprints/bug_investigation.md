---
trace_id: "bug_investigation-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "bug-investigation"
---

# Investigate why plan execution leaves stale lease files

Investigate the execution lease lifecycle in `packages/execution/` and determine why a lease can outlive the execution it guards. Establish:

- Where a lease is acquired and every path that should release it
- Which failure paths bypass release, with the file and line
- Whether a stale lease blocks a later run or is silently reclaimed
- What the journal shows when this happens

Acceptance criteria:

- The leak is reproduced by a failing test before any fix is proposed
- Every non-releasing path is listed with file and line
- The observable symptom is tied to a journal event a reader can search for
