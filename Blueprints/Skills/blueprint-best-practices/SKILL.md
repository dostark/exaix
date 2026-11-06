---
name: blueprint-best-practices
description: Create, review, or maintain Blueprint skill files and sidecars. Use for skill authoring and catalog maintenance rather than ordinary implementation planning.
---

# Blueprint Skill Authoring and Maintenance

Write skills that improve decisions for a defined task. Keep instructions accurate, discoverable, and testable.
Use the catalog's current authoring format and production loader as the format contract.

## Define the skill boundary

State the skill's purpose, intended requests, and expected deliverable.
Check existing skills before adding another. Separate distinct responsibilities without duplicating whole workflows.
Keep task instructions in the skill and persona, model, and tool authority in the agent role.
Do not turn one failure or example into a universal rule.

## Write useful instructions

Use a precise name and description that help select the skill for the right task.
Include decision criteria, relevant constraints, expected evidence, and stopping conditions where they affect correctness.
Scale detail to the task. Avoid generic advice, repeated policies, and speculative requirements.
Use the required instruction-prose standard. Preserve literal commands, identifiers, and quotations.
Put substantial conditional detail in supported references and explain when to read them.
Keep shared guidance in one maintained location. Do not require unavailable skills or tools.

## Keep files and metadata consistent

Use the supported folder structure, frontmatter, sidecar fields, and reference-link rules.
Keep the folder name, declared name, description, triggers, constraints, and outputs consistent.
Do not broaden triggers to unrelated tasks merely to improve discovery.
Preserve existing identifiers, role permissions, and quality weights unless their change is part of the approved scope.
Align sidecar constraints with body changes in the same review.
Check role defaults and callers when changing a skill's purpose, name, or expected output.

## Validate behavior and delivery

Use representative requests with independently defined outcomes and plausible incorrect controls.
Test the decisions the skill should improve rather than matching its words or headings.
Run changed executable helpers and prove that meaningful failures are detected.
Load the folder through the production catalog validator and run applicable prose, reference, and size checks.
Treat advisory size findings separately from blocking format or policy failures.

Distinguish format validity, actual prompt delivery, task behavior, and measured benefit.
Record the loaded source and revision when testing delivery.
Do not infer behavioral success from a loader pass or benefit from additional instructions.
Use controlled task comparisons for benefit claims, or state the precise reason measurement remains pending.

## Maintain approved revisions

Before a change, record current behavior, proposed wording, sidecar changes, validation cases, and exclusions.
Follow the applicable review and approval policy. Approval of one skill does not authorize edits to another.
Preserve unrelated work. Update required catalog metadata and affected fixtures with the approved change.
Check revision and approval state after editing. Do not represent a stale approved revision as the changed content.
Report validation results and unresolved limits. Do not publish or change role permissions without applicable authorization.
