# Rank three amendment persistence approaches

Compare the three supplied designs for replacing a small Markdown plan after a schema-validated amendment. The process is single-writer, files are at most 32 KiB, and a failed update must leave the previous plan readable. No database migration is in scope. Do not invent implementation code or claim tests were run.

Return a ranked assessment artifact with a title, description, and an `analysis` object. Put the ranking, tradeoffs, evidence, and required failure tests in `analysis.recommendations`. No execution actions are required for this comparison.

## Approach A

Open the current plan with truncation and write the amended text directly. Validate the resulting file after writing. On failure, emit an error; there is no retained copy of the old bytes.

## Approach B

Validate the amended representation first. Write a temporary sibling file, flush and close it, then rename it over the current plan on the same filesystem. Remove the temporary file on failure. Retain the previous plan if validation or temporary writing fails, and emit an audit event after successful replacement.

## Approach C

Append unvalidated amendment patches to a separate log and replay them whenever a plan is read. Keep the original plan unchanged. Patch ordering and corrupt-record handling are unspecified. This requires changing every reader to reconstruct the current state.

Assess correctness, failure recovery, maintainability, scope, and tests. Include the limits of a same-filesystem rename and distinguish ordinary write failures from power-loss durability.
