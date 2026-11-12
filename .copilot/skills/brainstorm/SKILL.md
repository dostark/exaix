---
name: brainstorm
agent: general
tools:
  - read_file
  - search_files
  - run_command
scope: dev
title: "Brainstorming Skill (#brainstorm)"
description: Run a structured decision session — frame the choice, gather evidence, diverge, set criteria, compare, and record the recommendation
short_summary: "Turn an open question into a decision brief with options, criteria, failure modes, an assumption ledger, and a record."
version: "1.0.0"
topics: ["brainstorming", "decisions", "requirements", "elicitation", "tradeoffs"]
qwen_skill: brainstorm
---

```text
Key points

- A brainstorm ends with a decision brief, not a transcript.
- Frame the decision before generating options.
- Evidence first: read the repository before asking the user.
- At least three options, including do-nothing.
- Set criteria before you score anything.
- One recommendation, with its consequences and what would change it.
- Change nothing — code, skills, or plans — before explicit confirmation.

1. Frame the decision
   - Classify it: reversible (two-way door) or irreversible (one-way door).
   - Name the owner, the deadline, and the cost of delay.
   - Name the blast radius and who is affected.
   - Restate the outcome in one sentence.
   - State the do-nothing baseline.

2. Build the evidence base
   - Read existing patterns, architecture invariants, prior decisions and ADRs,
     configuration limits, and benchmarks.
   - For a third-party dependency, check the provider's current documented capability.
   - Record the source for each fact.
   - Never ask the user for a fact you can read.

3. Diverge deliberately
   - Generate at least three options, including do-nothing, before judging any.
   - Apply two techniques: decomposition, first principles, constraints removal,
     pre-mortem or inversion, an analogous system, or a red team.
   - Group options by the axis each group decides.

4. Set criteria before scoring
   - Name three to five criteria with weights.
   - Include security, operability, reversibility, and delivery cost.
   - Apply disqualifiers first: a security or license violation removes an option
     regardless of its score. Record why it was disqualified.

5. Compare
   - Table: option, criteria scores, evidence, failure mode, blast radius, reversal cost.
   - Run a sensitivity check: which score change would flip the recommendation?
   - Name anchoring on the first option and any false dichotomy you see.

6. Track assumptions
   - Each assumption: statement, confidence, cheapest falsifying test, owner.
   - An assumption that cannot change the choice needs no test; say why.

7. Recommend
   - One recommendation, the reason, and the consequences accepted.
   - State what would change the decision and the review date.

8. Record
   - Decision record: problem, options, criteria, choice, consequences,
     reversibility, review date.
   - Propose an ADR only for a consequential, hard-to-reverse tradeoff with
     non-obvious rationale. A reversible choice stays in the record.

9. Interaction protocol
   - Ask one question at a time. Give a recommended answer, alternatives, and the tradeoff.
   - On "I don't know", propose the cheapest experiment that would answer it.
   - Do not reopen a settled decision without new evidence.
   - Name scope creep when a new question arrives mid-session.

10. Stop and confirm
   - Stop when no open decision can change the outcome.
   - Ask for explicit confirmation of shared understanding.
   - Do not edit code, skills, or plans before that confirmation.

Quality gate (satisfy all before you present a recommendation)
   - At least three options, including do-nothing.
   - Criteria and weights named before any score.
   - Every option has a failure mode and a reversal cost.
   - The recommendation names what would change it.
   - Every assumption has a falsifying test or a stated reason not to test it.
   - No settled decision is reopened without new evidence.
   - An ADR is proposed only for a consequential, hard-to-reverse tradeoff.

Anti-patterns (do not do)
   - Solution first, options later.
   - One option presented as a choice.
   - A survey of options with no recommendation.
   - False dichotomy, anchoring, or bikeshedding.
   - A hidden constraint that appears after the choice.
   - Reopening a settled decision to avoid a hard recommendation.

Canonical prompt (short):
"Brainstorm {topic}. Read the facts first, then run a decision session with at least
three options, criteria before scores, and a recommendation. Change nothing before I
confirm."

Examples
- "#brainstorm how should portal scopes be stored"
- "#brainstorm options for the request analyzer cache"
- "#brainstorm choose a migration form for the storage split"

Boundaries
- `requirements-analysis` formalizes requirements and acceptance criteria.
- `plan` sequences the work into a phase plan.
- `requirements-interview` is the runtime thin front-end; `brainstorm` is the
  development-root identifier.

Do / Don't
- ✅ Classify reversible versus irreversible before comparing options.
- ✅ Read the repository fact that answers a question.
- ✅ Give one recommendation with its consequences.
- ❌ Ask for a fact you can read.
- ❌ Score options before naming the criteria.
- ❌ Reopen a settled decision without new evidence.
- ❌ Edit code, skills, or plans before confirmation.
```

## Output format

1. Decision frame: type, owner, deadline, cost of delay, blast radius.
1. Evidence with sources.
1. Options grouped by axis, including do-nothing.
1. Criteria, weights, and disqualifiers.
1. Option table with failure mode, blast radius, and reversal cost.
1. Assumption ledger with falsifying tests.
1. Recommendation, consequences, and what would change it.
1. Decision record, plus an ADR candidate only when it qualifies.
1. Open questions and the confirmation request.

## Examples

- `#brainstorm how should portal scopes be stored`
- `#brainstorm options for the request analyzer cache`
- `#brainstorm choose a migration form for the storage split`
