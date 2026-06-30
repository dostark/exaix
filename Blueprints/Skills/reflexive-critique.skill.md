---
id: "550e8400-e29b-41d4-a716-446655440026"
created_at: "2026-06-30T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "reflexive-critique"
name: "Reflexive Self-Critique"
version: "1.0.0"
description: "The Reflexion pattern — generate, critique your own draft against accuracy/completeness/quality/safety, then refine until a confidence threshold is met"

triggers:
  tags:
    - reflexion
    - self-critique
    - quality
    - refinement

constraints:
  - "Always critique the draft before emitting it; never return an unreviewed first draft"
  - "Stop refining once the confidence threshold is met or improvements stop being material"
  - "Surface residual low-confidence areas explicitly rather than hiding them"

output_requirements:
  - "A refined response that has passed at least one critique pass"
  - "A confidence assessment (0-100) with the reasoning behind it"
  - "Any unresolved concerns the critique surfaced but could not fix"

quality_criteria:
  - name: "Critique Rigor"
    description: "The self-critique checks accuracy, completeness, quality, and safety, not just surface polish"
    weight: 40
  - name: "Material Improvement"
    description: "Each refinement pass measurably improves the draft against a named criterion"
    weight: 35
  - name: "Honest Confidence"
    description: "The final confidence score reflects the actual residual risk, with caveats stated"
    weight: 25

compatible_with:
  agents:
    - "*"
---

# Reflexive Self-Critique

Apply the **Reflexion pattern**: never return your first draft unreviewed.
Generate, critique your own work, and refine until a quality threshold is met.

## Step 1 — Generate a draft

Produce your best initial response to the request.

## Step 2 — Self-critique the draft

Evaluate the draft against four lenses, noting concrete defects, not vague unease:

1. **Accuracy**: Are all facts and claims verifiable? Any hallucinations or
   unstated assumptions? Is the logic sound and internally consistent?
2. **Completeness**: Did you address every requirement? Any missed edge cases? Is
   enough context provided for the reader to act?
3. **Quality**: Is the output well-structured, clearly worded, and in the
   requested format?
4. **Safety** (when applicable): Any security, privacy, or data-handling issues?

## Step 3 — Assess confidence

Rate confidence 0-100 from the critique findings:

- **90-100**: High — no significant issues remain.
- **70-89**: Moderate — minor improvements still possible.
- **Below 70**: Low — a material defect remains; refine before emitting.

## Step 4 — Refine and repeat

Fix the defects the critique named, then re-critique. Stop when confidence clears
the threshold or further passes stop changing anything material. State any concern
you could not resolve under the plan's risks rather than dropping it silently.
