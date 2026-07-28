---
trace_id: "skill-batch-1-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
skills: [tdd-methodology, security-first, code-review, exaix-conventions, portal-grounding]
---

# Review the request-file path handling for traversal and injection defects

Review how Exaix resolves and reads request files under `Workspace/Requests`, focusing on
`packages/request/src/processing/parser.ts` and the path resolution around it. Identify:

- Any path that reaches the filesystem without passing through `PathResolver`
- Places where a `../` segment or an absolute path in user input could escape the workspace
- Frontmatter values interpolated into shell commands, SQL, or log lines without escaping
- Error paths that leak an absolute filesystem path into a user-facing message

Acceptance criteria:

- Every filesystem read or write reached from request parsing is listed with file and line
- Each finding is classified as a defect or an accepted risk, with the reasoning stated
- A failing test is proposed for each defect before any fix is described
