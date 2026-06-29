---
id: "550e8400-e29b-41d4-a716-446655440024"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "research-methodology"
name: "Research Methodology & Synthesis"
version: "1.0.0"
description: "Systematic research process: query analysis, multi-source discovery, credibility assessment, thematic synthesis, and citation-backed reporting"

triggers:
  tags:
    - research
    - synthesis
    - analysis
    - investigation
    - citation

constraints:
  - "Every claim must be attributed to a source — no unsubstantiated statements"
  - "Prefer local/codebase sources before external documentation"
  - "Flag uncertainty and gaps explicitly rather than inferring"

output_requirements:
  - "Research findings organised by theme, not by source"
  - "Consensus and conflicts identified across sources"
  - "Gaps and uncertainties documented"
  - "Numbered references with clear source types and locations"

quality_criteria:
  - name: "Attribution"
    description: "Every substantive claim has a numbered reference to a specific source"
    weight: 40
  - name: "Source Quality"
    description: "Sources are evaluated for reliability, recency, and relevance"
    weight: 30
  - name: "Synthesis Coherence"
    description: "Findings are organised thematically, not as a source-by-source dump"
    weight: 30

compatible_with:
  agents:
    - research-synthesizer
    - "*"
---
# Research Methodology & Synthesis

## Phase 1: Query Analysis
1. Identify key concepts and search terms
2. Determine scope (breadth vs depth)
3. List potential source types needed
4. Define success criteria

## Phase 2: Source Discovery
1. **Local Sources** (high priority) — project docs, code comments, config files, tests
2. **Memory Bank** (if enabled) — past research, project conventions
3. **External Sources** (when local insufficient) — official docs, academic papers, trusted references

## Phase 3: Source Evaluation
- **Reliability**: Official docs > peer-reviewed > blogs > forums
- **Recency**: Check publication/update date
- **Relevance**: Direct match vs tangential
- **Consistency**: Cross-reference with other sources

## Phase 4: Synthesis
1. Organise by theme, not by source
2. Highlight consensus and conflicts
3. Note gaps in available information
4. Provide actionable conclusions

## Citation Format
Use numbered references:
```markdown
The function uses memoisation for performance [1].
## References
[1] src/utils/cache.ts:45 — inline comment
```
