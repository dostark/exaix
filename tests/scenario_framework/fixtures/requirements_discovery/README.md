# Requirements discovery outcome controls

`records.json` holds six positive records: five initial cases and the later retention answer.
Each `bad` item contains explicit path/value changes to its positive record. The test helper materializes a fresh counterexample.
The representation avoids copying the unchanged fields of every record. It does not change the original counterexamples.

The requests and portal facts are frozen separately. Do not deliver these expected records or controls to the role under test.
The scenarios use an isolated Blueprint root and the explicitly requested `requirements-analysis` skill.
Step 8 must verify the actual injected root and revision before crediting a live case.

The deterministic oracle checks request identity, record structure, pending and resolved states, and the stated domain outcomes.
It does not establish arbitrary semantic correctness or a benefit from the skill.
For the storage ADR case, the additional fixed review rubric is:

- Both stated alternatives are considered.
- The reason connects independent history reconstruction to the chosen ledger and its requirement.
- Historical migration and the derived read model are acknowledged as costs.
- The label decision receives no ADR, and no unapproved ADR or glossary file is created.

Require all rubric items and the deterministic checks. A generic statement that the choice is consequential is insufficient.
Keep that review, actual model behavior, and live delivery pending until Step 8 executes them.
Paired value trials remain Step 9 work. Oracle unit tests do not prove a live outcome.
