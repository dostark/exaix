# Specification-Driven Development in Exaix

**Specification-Driven Development (SDD)** is an approach to building applications with AI agents where a structured specification is written _before_ code generation begins, and that specification serves as both the execution guide and the evaluation rubric. Rather than iterating on generated code ("generate → fix → regenerate"), SDD iterates on the _specification_ until it is well-defined, then generates code from a solid foundation.

## Core Principles

| # | Principle                            | Description                                                                                                         |
| - | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1 | **Write a spec before code**         | A structured specification (goals, success criteria, scope, constraints) is produced before any agent executes work |
| 2 | **Spec defines acceptance criteria** | The specification explicitly states what "done" looks like — these criteria become the evaluation rubric            |
| 3 | **Iterate on the spec, not on code** | Multi-turn refinement improves the specification; code generation starts only when the spec is clear                |
| 4 | **Spec is the contract**             | The finalized specification persists as ground truth for the entire execution and evaluation lifecycle              |
| 5 | **Grounded in reality**              | Specifications are written with awareness of the actual codebase — architecture, conventions, and existing patterns |
| 6 | **Spec as evaluation rubric**        | Quality gates evaluate output against spec-derived criteria, not generic heuristics                                 |
| 7 | **Change the spec, not the code**    | When requirements shift, the specification is updated first; execution follows the revised spec                     |

## The SDD Pipeline

```
SPECIFICATION PHASE
  Request
    → Quality assessment: is this specific enough?
    → [if not] Refinement loop: agent asks questions, user answers,
      specification is synthesized, quality reassessed
    → [if yes] Structured intent extraction
    → Result: a complete specification (goals + criteria + scope + constraints)

KNOWLEDGE PHASE
  Codebase context gathering
    → Architecture overview, key files, conventions, dependencies
    → Feeds into: refinement questions, auto-enrichment, execution context

EXECUTION PHASE
  Agent execution
    → Agent works with the specification and codebase context
    → Self-critique against specification goals
    → Confidence scoring for goal alignment

EVALUATION PHASE
  Quality gates
    → Goal alignment: does the output satisfy specification goals?
    → Task fulfillment: are all requirements addressed?
    → Intent understanding: does the output match the original request intent?
```

## Beyond Vanilla SDD

### Assisted Specification Writing

In pure SDD, the human writes the full specification manually. This requires skill — knowing what to specify, how to structure it, and what level of detail agents need. Exaix lowers this barrier through guided, collaborative specification:

- An agent identifies what is missing, vague, or ambiguous
- It generates categorized questions (goal, scope, constraint, acceptance, context)
- Each question includes a rationale explaining _why_ it matters
- Answers are synthesized into a structured specification automatically
- Users do not need to know how to write a good spec — the system guides them there

### Progressive Depth

SDD typically applies the same rigor uniformly — every task gets a full spec. Exaix adapts the specification effort to the request:

- **Clear, well-bounded requests** (e.g., "add a `--verbose` flag") skip the refinement loop entirely — the quality assessment scores them above threshold and they proceed directly to execution
- **Ambiguous requests** (e.g., "make the UI better") trigger the full refinement loop
- **Moderate requests** get auto-enriched via the LLM without user interaction

This avoids the friction of over-specifying trivial tasks while ensuring complex tasks are well-defined.

### Codebase-Grounded Specifications

Traditional SDD specs are written by humans who know the codebase. When working with AI agents, this assumption breaks down — neither the agent writing the spec nor (sometimes) the user has deep codebase familiarity.

Exaix addresses this by providing the agent with actual codebase context before specification begins:

- Architecture layers and key files
- Detected code conventions and patterns
- Dependency information and tech stack
- File significance ranking

The agent can reference this knowledge when generating questions: _"The codebase uses the service pattern with constructor-based dependency injection. Should the new feature follow this pattern?"_ — producing specifications that are feasible and convention-aligned.

### Spec-to-Evaluation Traceability

The most distinctive aspect: the specification does not just guide execution — it **becomes** the evaluation rubric. The quality gates verify output against the specification, not generic heuristics.

```
Specification → Execution → Evaluation against Specification → Pass/Fail
```

Without this, evaluation answers "is this good code?" — with it, evaluation answers "does this code do what was specified?"

## Known Gap: Re-Refinement During Execution

SDD emphasizes spec versioning and change management — if requirements are discovered to be infeasible mid-execution, the specification should be updated first, then execution resumes from the revised spec.

Current design finalizes the specification before execution and does not revisit it during the agent's work. If an agent discovers during self-critique that a requirement is infeasible, it retries with feedback but does not return to the user to revise the specification. This can result in suboptimal output as the agent tries to satisfy an infeasible requirement rather than flagging it for spec revision.

A future improvement would add a "return to refinement" path from the execution phase back to the specification phase, where the agent can trigger a revision with the specific infeasibility as context.
