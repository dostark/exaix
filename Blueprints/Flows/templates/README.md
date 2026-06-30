# Flow Templates

This directory contains **abstract flow patterns** — structural starting points
for authoring new concrete flows. They are not runnable as-is: each agent slot is
a `{{placeholder}}` token you replace with a real identity id.

## Available templates

### 1. Pipeline (`pipeline.flow.template.yaml`)

**Pattern:** Linear sequence (step 1 → step 2 → step 3 → …).
**Use case:** Data processing, multi-stage transformation/validation.
**Slots:** `{{coordinator}}`, `{{processor}}`, `{{refiner}}`, `{{summarizer}}`.

### 2. Fan-out/Fan-in (`fan-out-fan-in.flow.template.yaml`)

**Pattern:** Parallel specialists followed by a synthesis step.
**Use case:** Comprehensive reviews, multi-perspective analysis.
**Slots:** `{{coordinator}}`, `{{specialist_1..3}}`, `{{synthesizer}}` — fan out
via `dependsOn`, aggregate with `input.source: aggregate`.

### 3. Self-Correcting (`self-correcting.flow.template.yaml`)

**Pattern:** Generate → judge → refine (the Reflexion loop).
**Use case:** High-quality generation that must meet a quality bar.
**Slots:** `{{generator}}`, `{{refiner}}` (the judge slot uses the real
`quality-judge` identity). Pair with the `reflexive-critique` skill on the
generator/refiner identities.

## How to use

1. Copy a template into the flows directory and rename it to a `*.flow.yaml`:

   ```bash
   cp templates/pipeline.flow.template.yaml ../my-process.flow.yaml
   ```

1. Customize it:
   - Update `id`, `name`, `description`.
   - Replace every `{{placeholder}}` agent slot with a real identity id (see
     `Blueprints/Identities/`).
   - Configure each step's `input` (how data flows in).

1. Validate — once the placeholders are real identities, the integrity gate
   requires them to exist:

   ```bash
   exactl flow validate my-process
   deno task check:blueprint-integrity
   ```
