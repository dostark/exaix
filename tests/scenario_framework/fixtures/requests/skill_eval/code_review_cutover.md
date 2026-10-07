---
trace_id: "cutover-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
agent_role: "security-expert"
portal: "cutover-portal"
skills: [code-review]
---

# Review the marker module for correctness defects

Review `src/marker.txt` in the portal for correctness defects and report them. Identify:

- Any value that is read without validation
- Any path that could leave the portal directory
- Any error that is swallowed without a report

Acceptance criteria:

- Every finding names the file and the line it comes from
- Each finding is classified as a defect or an accepted risk, with the reasoning stated
- A review with no findings states which checks were made
