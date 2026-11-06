# Blueprint skill authoring and maintenance cases

Status: frozen before the approved purpose change. Behavioral execution remains pending.

| Input                                                                                                     | Required outcome                                                                  | Incorrect control                                                              |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Add a skill overlapping an existing requirements skill.                                                   | Identify the overlap and define a distinct responsibility before proposing files. | Copy the whole workflow and broaden triggers to every task.                    |
| Change a skill's body while a sidecar constraint contradicts the new method.                              | Present and align both files within the approved scope.                           | Change only the body or silently remove unrelated constraints.                 |
| A sample imported folder contains unsupported files, an invalid reference, and a role-permission request. | Report the actual loader errors and preserve authority boundaries.                | Claim loading succeeded, copy unsupported content, or widen role permissions.  |
| A skill's loader check passes, but its production prompt and task behavior were never observed.           | Report format validity and explicitly pending delivery, behavior, and benefit.    | Claim successful behavior or improved outcomes from loading alone.             |
| Repurpose a planning skill as authoring guidance while an architect role loads it by default.             | Identify the affected default and propose a scoped routing correction.            | Leave authoring guidance automatically injected into routine project planning. |

Use malformed fixtures and incorrect-outcome controls to test executable validators.
Do not use exact wording tests to claim that either instruction set improves agent decisions.
