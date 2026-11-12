---
name: technical-writing
description: "Author grounded user-facing technical documents with standards-based structure, plain language, and verifiable examples"
---

# Technical Writing

Write documents a reader can act on. Every claim comes from the code, configuration, or an
existing document. Structure follows the document type, and every example can be run.

## Reader and task

- Name the reader: their role, prior knowledge, and goal.
- Name the task the document must complete.
- State what the document does not cover.
- Resolve a factual question from the repository before asking the reader.

## Document types and required sections

| Type      | Purpose                     | Required sections                                             |
| --------- | --------------------------- | ------------------------------------------------------------- |
| Tutorial  | Teach a beginner            | Goal, prerequisites, steps, result, next step                 |
| How-to    | Complete one task           | Task, prerequisites, steps, expected output, failure recovery |
| Reference | Look up facts               | Parameters, returns, errors, limits, defaults                 |
| Concept   | Explain a model             | Purpose, mental model, boundaries, examples                   |
| README    | Orient a newcomer           | Purpose, install, quick start, links                          |
| Changelog | Announce user-facing change | Change, one sentence, affected version                        |
| Glossary  | Fix the meaning of a term   | Term, definition, scope, synonyms                             |

## Structure

- Put the task first. Put prerequisites before the steps that need them.
- One topic per section; one idea per paragraph.
- Use progressive disclosure: the shortest path first, then detail.
- Order steps by execution. Show the expected result after the steps.
- Use headings that name the reader's task, not the author's activity.

## Style

- Use the second person, active voice, and present tense.
- Keep sentences short and direct. Give one instruction per sentence.
- Define an abbreviation or term on first use.
- Avoid marketing adjectives and words such as "simply", "just", or "obviously".
- Use one term for one concept. Do not rotate synonyms.
- Keep numbers, units, dates, and code formatting consistent with the project.

## Terminology and glossary

- Reuse the project glossary. Add a term only when the project has no entry.
- Define each term once, then use it unchanged.
- Record synonyms only to redirect the reader, not to introduce a second meaning.
- Do not redefine a project term inside one document.

## Code samples and examples

- Provide a complete, runnable example for every procedure.
- State the environment, version, and prerequisites the example assumes.
- Show the expected output, or state why none exists.
- Include one failure or edge case with its observable result.
- Keep the example minimal; remove unrelated setup.
- Never present untested code as runnable.

## Reference documents

- Name every parameter, its type, default, and valid range.
- Name return values, error conditions, and limits.
- Use the published OpenAPI document when the project has one; otherwise cite the code and
  configuration that define the endpoint.
- Keep the reference exhaustive; keep the how-to short.

## Changelogs and versioning

- Write for the user, not for the implementer.
- One sentence per change. Name the affected version or release.
- Record deprecations and removals explicitly, with the replacement.
- Do not include internal refactors, test changes, or file paths.

## Links, navigation, and docs-as-code

- Update the index, navigation, and cross-links when you add or move a document.
- Prefer relative links inside the repository. Mark an external link as external.
- Change the source document, not the generated copy.
- Check every link target and anchor before you finish.

## Accessibility and localization

- Give every image alternative text that carries its meaning.
- Do not rely on color alone to carry meaning.
- Use descriptive link text, not "click here".
- Avoid idioms, humor, and culture-specific references.
- Keep sentences short and terms consistent to support translation.

## Review and validation

- Run every example and compare the output with what the document states.
- Check every link, anchor, and navigation entry.
- Verify every behavioral claim against its source.
- Confirm the terminology against the project glossary.
- Record the applicable standards and the sections that satisfy them.
- Ask a second reader to review a user-facing document when one is available.

## Standards map

| Standard              | Informs                         | Sections                  |
| --------------------- | ------------------------------- | ------------------------- |
| ISO/IEC/IEEE 26514    | Structure and content for users | Document types, Structure |
| ISO/IEC/IEEE 82079-1  | Instructions for use            | How-to, Examples          |
| ISO 24495-1           | Plain language                  | Style                     |
| ISO 704, ISO 1087     | Terminology and glossary        | Terminology and glossary  |
| ISO/IEC/IEEE 26513    | Review and validation           | Review and validation     |
| ISO/IEC/IEEE 26515    | Agile delivery                  | Changelogs, docs-as-code  |
| OpenAPI Specification | API reference                   | Reference documents       |

Name the applicable standard for the document type. State "none applies" with a reason when it
does not. Do not claim conformance without evidence.

## Boundaries

- This skill owns language-neutral user-facing documents.
- `documentation-driven` owns the doc-first design workflow.
- `commit-message` owns commit text; `implementation-plan` owns phase plans.
- `.copilot/skills/doc` owns Exaix repository documentation targets and sync commands.
- Follow the project's conventions and terminology. Do not impose Exaix prose rules on a portal.

## Read-only by default

- Documentation edits need explicit authorization.
- Do not publish, deploy, or open a pull request from this skill.

## Output

1. Document type, reader, and task.
1. Source grounding for each behavioral claim.
1. The document, or the exact blocker.
1. Standards applied, or why none applies.
1. Example and link check results.
1. Index and navigation updates.
1. Unverified claims, stated separately.
