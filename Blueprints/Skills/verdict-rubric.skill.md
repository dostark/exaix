---
id: "550e8400-e29b-41d4-a716-446655440020"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "verdict-rubric"
name: "Verdict & Rubric Evaluation"
version: "1.0.0"
description: "Structured scoring criteria and verdict thresholds for LLM-as-a-Judge evaluations"
critical: true

triggers:
  tags:
    - judge
    - evaluation
    - rubric
    - verdict
    - scoring

constraints:
  - "Score each criterion on a defined scale with explicit evidence"
  - "Map overall score to a verdict (PASS/CONDITIONAL/REJECT) at hard thresholds"
  - "Flag blocking issues when any criterion falls below the minimum"

output_requirements:
  - "Per-criterion score with reasoning, issues, and suggestions"
  - "Overall score and verdict"
  - "Critical issues list with severity, location, and recommendation"

quality_criteria:
  - name: "Objectivity"
    description: "Scores and verdicts are grounded in explicit evidence, not intuition"
    weight: 40
  - name: "Specificity"
    description: "Issues reference exact lines, functions, or sections with concrete examples"
    weight: 30
  - name: "Actionability"
    description: "Each finding includes a specific, implementable recommendation"
    weight: 30

compatible_with:
  agents:
    - quality-judge
    - voting-judge
    - "*"
---

# Verdict & Rubric Evaluation

## Standard Scoring Scale (0-100)

| Range  | Label        | Meaning                   |
| ------ | ------------ | ------------------------- |
| 90-100 | Excellent    | Exceeds expectations      |
| 80-89  | Good         | Meets all requirements    |
| 70-79  | Acceptable   | Minor improvements needed |
| 60-69  | Needs Work   | Significant gaps          |
| 0-59   | Unacceptable | Major revision required   |

## Verdict Thresholds

| Verdict        | Condition                                                  |
| -------------- | ---------------------------------------------------------- |
| **APPROVE**    | overall_score >= 80 AND no critical issues                 |
| **NEEDS_WORK** | 50 <= overall_score < 80 OR major issues                   |
| **REJECT**     | overall_score < 50 OR critical security/correctness issues |

## Standard Criteria

### code_correctness (0.0-1.0)

- 1.0: Syntactically valid, logically sound, handles edge cases
- 0.7: Minor issues that don't affect main functionality
- 0.4: Significant bugs or logic errors
- 0.0: Code would not run or produces wrong results

### security (0.0-1.0)

- 1.0: No vulnerabilities, follows best practices
- 0.7: Minor issues (e.g., verbose error messages)
- 0.4: Moderate issues (e.g., weak validation)
- 0.0: Critical vulnerabilities (injection, exposure)

### maintainability (0.0-1.0)

- 1.0: Clear structure, good naming, appropriate abstraction
- 0.7: Mostly clear, minor improvements possible
- 0.4: Hard to understand or modify
- 0.0: Unmaintainable spaghetti code

### completeness (0.0-1.0)

- 1.0: All requirements addressed thoroughly
- 0.7: Main requirements met, minor gaps
- 0.4: Significant requirements missing
- 0.0: Fails to address core request

### test_coverage (0.0-1.0)

- 1.0: Comprehensive tests for all scenarios
- 0.7: Good coverage of main paths
- 0.4: Basic tests only
- 0.0: No tests or tests don't verify behavior

## Evaluation Process

1. **Context Gathering** — read the artifact and requirements
2. **Criterion-by-Criterion Assessment** — score each with evidence
3. **Overall Assessment** — weighted average + blocking issues
4. **Actionable Feedback** — specific, located recommendations
