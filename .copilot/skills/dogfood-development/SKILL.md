---
name: dogfood-development
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Dogfood Development Skill (#dogfood-development)"
description: Run the dogfood loop — use Exaix to develop Exaix itself
short_summary: "Dogfood development cycle: bootstrap sandbox, write requests, review plans, execute, close loop."
version: "1.0.0"
topics: ["dogfooding", "workflow", "sandbox", "delegation"]
qwen_skill: dogfood-development
---

```text
Key points

- Dogfooding means using Exaix to develop Exaix itself
- Work happens in an isolated git worktree, not the live checkout
- The daemon runs in a sandbox outside the repo tree
- Human gates: plan approval + result review (HITL secondary approval on writes)
- Crash recovery is automatic via journal replay

See also
  User guide           →  [docs/Exaix_Dogfooding.md](../../docs/Exaix_Dogfooding.md)
  Dogfood agent role   →  [Blueprints/Agents/dogfood-developer.md](../../Blueprints/Agents/dogfood-developer.md)
  Dogfood flow         →  [Blueprints/Flows/dogfood_loop.flow.yaml](../../Blueprints/Flows/dogfood_loop.flow.yaml)

Canonical prompt (short):
"Set up a dogfood sandbox for phase {N}. Bootstrap, write the request,
start the daemon, review the plan, approve execution, review the result."

Quickstart

  # One-time setup
  deno task dogfood:bootstrap --dir ~/exa-dogfood --worktree /path/to/worktree

  # Each session
  deno task dogfood                          # start daemon
  exactl plan list                            # list generated plans
  exactl plan show <plan-id>                  # review a plan
  exactl plan approve <plan-id>               # approve execution
  exactl plan review step-3                   # review result
  deno task dogfood:stop                      # stop daemon

The dogfood loop (human + daemon)

  1. Author a request file (.md with frontmatter, skills, acceptance criteria)
  2. Daemon generates a plan (RequestProcessor -> AgentRunner -> PlanWriter)
  3. Human reviews and approves the plan
  4. Agent executes on the worktree (RED->GREEN->commit on feature branch)
  5. Human reviews the changeset (git diff, CI, journal audit trail)
  6. Close the loop (merge, or revise request and restart)

Meta-pipeline cycle (daily rhythm)

  pre-gap-analysis  →  next-steps (xN, each with commit)  →  post-gap-analysis  →  clean-codebase

  Each maps to a request with depends_on ordering:

  Phase         Agent Role      depends_on
  pre-gap       code-analyst    (first)
  next-steps x1 dogfood-coder   [pre-gap]
  next-steps x2 dogfood-coder   [step-1]
  next-steps xN dogfood-coder   [step-N-1]
  post-gap      code-reviewer   [step-N]
  clean-codebase dogfood-coder  [post-gap]

Key configuration

  - Config preset: deno task dogfood:bootstrap sets up ~/exa-dogfood with worktree
  - Portal: the Exaix repo is mounted as a portal for codebase context
  - Provider: configured during bootstrap, or override via EXA_LLM_PROVIDER
  - Skills: daemon uses Blueprints/Skills/ (not .copilot/skills/)
  - Agent role: dogfood-developer (model size M, thinking enabled, 8 default skills)
  - Permissions: HITL secondary approval for writes and run_command

Related skills
  - plan                       — create plans with step-manifests for dogfood
  - pre-gap-analysis            — analyze plan before implementation
  - post-gap-analysis           — review implementation against plan
  - next-steps                  — step-by-step execution in dogfood loop
  - remediate-plan-gaps         — fix plan gaps discovered in dogfood
  - remediate-code-gaps         — fix code gaps discovered in dogfood
  - clean-codebase              — drive CI green after implementation

Examples
  #dogfood-development Bootstrap sandbox for Phase 134
  #dogfood-development Write request for Phase 134 Step 3.2
  #dogfood-development Review plan and approve execution
```

```
---
exaix:
  skill_id: dogfood-development
  triggers:
    keywords: [dogfood, sandbox, bootstrap, daemon, delegate]
    task_types: [feature, infrastructure]
    tags: [dogfooding]
  constraints:
    - "Use deno task dogfood:bootstrap for one-time sandbox setup"
    - "Write requests as .md files with frontmatter (agent_role, skills, portal, target_branch)"
    - "Always review the plan before approving — HITL gates exist for a reason"
    - "Dogfood runs in an isolated git worktree — never on the live checkout"
  output_requirements:
    - "Sandbox bootstrapped and daemon started"
    - "Request written with frontmatter and acceptance criteria"
    - "Plan reviewed and approved"
    - "Result reviewed before merge"
  quality_criteria:
    - name: isolation
      description: Worktree isolated from live checkout
      weight: 40
    - name: plan_review
      description: Plan reviewed before approval
      weight: 30
    - name: journal_audit
      description: Journal shows complete execution chain
      weight: 30
---
```
