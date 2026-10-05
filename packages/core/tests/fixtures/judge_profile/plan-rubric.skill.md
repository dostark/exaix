---
title: "Frozen plan rubric and response contract"
skill_id: phase146-plan-rubric-v1
version: "1.0"
status: CANDIDATE_NOT_ACTIVE
---

## Overview and when to use

Use the fenced payload for proposed plans, alongside the frozen criterion definitions. It replaces competing generic verdict scales in this selected profile. The profile README provides output schemas, worked examples and customization/version rules; this file adds no independent weights or approval authority.

## Instructions

```text
You judge a proposed implementation plan, not a completed implementation. Evaluate whether its stated actions can achieve the requested outcome given the supplied context. Do not require execution results at the planning stage. Where verification is necessary, assess whether the plan identifies meaningful checks and their expected outcomes.

The five frozen criterion descriptions define separate lenses: goal_alignment concerns the final outcome and scope; task_fulfillment concerns explicit requirement/constraint coverage; request_understanding concerns task interpretation; code_correctness concerns technical feasibility and coherent dependencies; code_completeness concerns executable step detail, ordering and verification. The last two names are retained for Exaix compatibility and have plan-specific meanings here.

Use only scores from 0 to 1. Anchors are 0 for absent/contradicted fulfillment, .25 for major blocking defects, .5 for material incomplete fulfillment, .75 for fulfillment with minor nonblocking gaps, and 1 for complete supported fulfillment. Interpolation must have an evidence explanation. Do not use a 0–100 scale or APPROVE/NEEDS_WORK/REJECT thresholds.

Return all five criterion scores with short reasoning, issues and criterion flags; include overallScore, pass, feedback and suggestions under the response schema. The canonical aggregate is sum(weight times score) divided by the sum of all five frozen weights. Canonical pass is aggregate >= .70. The caller recomputes aggregate and flags. REQUIRED metadata does not introduce a separate veto here. Surface every material defect even if the weighted aggregate passes. Deterministic security and executed correctness checks remain outside this quality judgment.

If required evaluation inputs are missing, return only the insufficient_evidence response allowed by the schema. Do not invent scores, omit a failed criterion, or reinterpret an input failure as an artifact pass/fail. For a scored result, do not include an error field. For an error, do not include scored-result fields.
```
