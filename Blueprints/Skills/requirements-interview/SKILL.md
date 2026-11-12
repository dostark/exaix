---
name: requirements-interview
description: "Resolve requirement decisions interactively with a ranked decision frontier, explicit alternatives, and staleness handling"
---

# Requirements Interview

Resolve the requirement decisions that block a specification. This skill owns the interview
and decision mechanics. `requirements-analysis` owns the record format, formalization,
glossary, and ADR threshold; link to it and do not restate it.

## Frame the requirement decision

- Name the requirement and the acceptance criteria it affects.
- Classify each choice: a reversible product choice or an irreversible contract.
- Name the decision owner, the deadline, and the cost of delay.
- State the baseline: what the specification says today.

## Build the evidence base

- Read the request, project terminology, configuration, accepted decisions, and code facts.
- Cite the source for each fact.
- Never ask for a fact you can read.

## Keep the decision ledger

- Facts: resolved from the request, the repository, or configuration.
- Decisions: answered by the user, with the reason.
- Assumptions: believed but unconfirmed.
- Pending: material questions with no answer yet.

## Rank the decision frontier

- List each unresolved decision with the requirement and criteria it blocks.
- Record its dependents: decisions, assumptions, and criteria that change with it.
- Rank by effect on acceptance criteria, then by cost of delay.
- Ask only about the highest-ranked decision.

## Present options for each question

- Offer at least two feasible answers, including "keep current behavior" when it exists.
- Name the criteria before the recommendation: acceptance-criteria impact, risk,
  reversibility, delivery cost, and user impact.
- Recommend one answer with its reason and the consequence accepted.
- Ask one question about one decision. It must be a choice only the user can make, and no
  repository fact may answer it.

## Track assumptions

- Each assumption: statement, confidence, cheapest falsifying evidence, and owner.
- An assumption that cannot change the criteria needs no test; say why.

## Handle answers

- Recorded: add it to Decisions and update dependent assumptions and criteria.
- Changed: mark every dependent decision, assumption, and criterion stale; list them; re-ask
  only what the change invalidates.
- "I don't know": offer the cheapest evidence step. If none exists, record
  `PENDING USER DECISION` with the affected criteria.
- Conflicting answers: surface both, name the conflict, and ask one disambiguating question.
- New scope mid-interview: park it in Open questions; do not switch branches.

## Record each decision

- Requirement, decision, alternatives, criteria, reason, consequences, affected criteria,
  and the review trigger.
- Write it in the `requirements-analysis` record format. Delegate the glossary and the ADR
  threshold to that skill; create no parallel format.

## Quality gate

Satisfy all before you recommend an answer:

- The question is the highest-impact open decision.
- At least two feasible answers, including keep-current where it exists.
- Criteria named before the recommendation.
- The recommendation names its consequence and the affected criteria.
- Every assumption has falsifying evidence or a stated reason.
- A changed answer produced a staleness list.
- No settled decision is reopened without new evidence.
- No invented answer: an unanswered question stays `PENDING USER DECISION`.

## Stop rule

Stop when no remaining uncertainty can change the required behavior, or when every material
question is answered or marked `PENDING USER DECISION`. Ask for explicit confirmation of shared
understanding. Change nothing before it.

## Boundaries

- `requirements-analysis`: record format, formalization, glossary, and ADR practice.
- `implementation-plan`: sequences the work.
- `brainstorm` (development root): owns that identifier. This skill uses
  `requirements-interview`, `grill-me`, and `requirements-elicitation`.

## Read-only by default

Do not edit code or documentation without authorization.

## Output

1. Requirement, affected criteria, and baseline.
1. Evidence with a source per fact.
1. Decision ledger: facts, decisions, assumptions, pending.
1. Ranked decision frontier with dependents.
1. One question with at least two answers, criteria, and a recommendation.
1. Staleness list after a changed answer.
1. Decision record in the `requirements-analysis` format.
1. Pending questions and the confirmation request.
