Execute a plan step that triggers a guardrail block-severity policy violation.
With guardrail.enabled=true and a block-severity policy, the execution should halt
via the Plan Amendment gate and journal guardrail.screen.violation and
plan.amendment_triggered. With guardrail.enabled=false, the same plan completes
normally with no guardrail.* events.
