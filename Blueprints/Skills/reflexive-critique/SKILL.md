---
name: reflexive-critique
description: "The Reflexion pattern — generate, critique your own draft against accuracy/completeness/quality/safety, then refine until a confidence threshold is met"
---
# Reflexive Self-Critique

Apply the **Reflexion pattern**: never return your first draft unreviewed. Generate, critique your own work, and refine until a quality threshold is met.

## Step 1 — Generate a draft

Produce your best initial response to the request.

## Step 2 — Self-critique the draft

Evaluate the draft against four lenses, noting concrete defects, not vague unease:

1. **Accuracy**: verify every fact and claim; catch hallucinations and unstated assumptions; confirm the logic is sound and internally consistent.
2. **Completeness**: address every requirement; catch missed edge cases; provide enough context for the reader to act.
3. **Quality**: check structure, wording, and the requested format.
4. **Safety** (when applicable): check for security, privacy, or data-handling issues.

## Step 3 — Assess confidence

Rate confidence 0-100 from the critique findings:

- **90-100**: High — no significant issues remain.
- **70-89**: Moderate — minor improvements still possible.
- **Below 70**: Low — a material defect remains; refine before emitting.

## Step 4 — Refine and repeat

Fix the defects the critique named, then re-critique. Stop when confidence clears the threshold or further passes stop changing anything material. State any concern you could not resolve under the plan's risks rather than dropping it silently.
