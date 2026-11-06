# Development planning cases

Step 6 freezes five planning inputs and checks their structured outcomes.
`approved_cases.md` preserves the approved requests, independent expectations,
incorrect controls, and limits. `frozen_manifest.json` records the baseline
commits, approved diff hash, and input hashes captured before the skill edit.

`records.json` contains five acceptable outcomes and 25 explicit mutations that
represent incorrect outcomes. These records test the oracle, not a model.
No expectation is extracted from the skill's wording or the implementation
being planned. Migration checks compare the dependency edges with the fixture's
two independent caller batches, retained API, and required integration checkpoint.

The request and portal files are authored inputs. They are not evidence of a
completed production feature or an executed model case. No scenario YAML is
registered with a runtime-only configuration for this development skill.
Step 8 must materialize `configs/dogfood.toml` for an isolated workspace, select
the development root and approved revision, supply the repository context,
and record actual prompt delivery and plan outcomes.

Step 8 must also bind each result to its submitted request through the existing
request-bound artifact reader. Review the complete plan against its structured
record and inspect actual files for unauthorized ADR creation. An agent's
`created_files` declaration alone cannot establish that no file was created.
The selective ADR rubric checks alternatives, independent-verification rationale,
irreversibility, and read-model and migration consequences. Semantic quality
requires live execution and human or operator review.

Step 9 owns paired value trials. Passing oracle units, catalog checks, prose
checks, or schema checks does not demonstrate improved plan quality.

## Step 6 verification

The user approved revision 1 before the planning guidance was applied, then
approved its separately presented prose correction. The correction retains the
planning method and all reachability gates. YAML quoting and whitespace were
normalized without changing the approved constraint text.

The existing oracle first failed with its missing module, then passed 32 tests.
An always-accept canary failed all 25 incorrect controls. The prose checker
regression first failed when structured examples were treated as prose; its
20 tests now pass while scalar prose still fails the word limit.

The final combined focused run passed 90 tests: requirements/oracle and
request-bound checks, planning controls, prose checker, and catalog regressions.
No observed model outcome is claimed by those tests.

| Case | Deterministic evidence | Model outcome |
| --- | --- | --- |
| p234-s6-c1 | Accepts the vertical production path; rejects five incorrect outcomes | Not run: live execution excluded |
| p234-s6-c2 | Checks compatible API stages, real blocking edges, rollback and integration; rejects five controls | Not run: live execution excluded |
| p234-s6-c3 | Preserves the settled choice and its source; rejects five controls | Not run: live execution excluded |
| p234-s6-c4 | Preserves Agent Role meaning and linked criteria; rejects five controls | Not run: live execution excluded |
| p234-s6-c5 | Checks selective ADR structure; rejects five controls | Not run: live execution and semantic review excluded |

The production prose policy registers only this skill's body and sidecar.
Catalog, index, type, format, prose, duplication and staged static checks pass.
The final combined regression run passed 107 tests. The security suite passed
242 tests, with nine existing opt-in tests ignored. Results are recorded in the phase plan. Live cases remain on its Step 8 ledger.

The additional guidance regressions passed 17 tests. The approved planning
revision has an explicit expectation record; the original dogfood baseline is
unchanged. Frozen conversion tests now construct fixture folders from their
original captured inputs, rather than requiring live skills to retain historical
prose forever. The golden data is unchanged. An instruction mutation failed both
render and field checks, then the restored conversion tests passed.

The skill loads as an active dogfood revision. Its rendered instructions contain
28,299 characters, above the existing 5,000-character advisory threshold.
The baseline at f5afe4d77 contained 25,809 instruction characters. This advisory is not a blocking
gate. The generic size CLI uses Blueprint mode, so its empty result for a dogfood
root is not used as size evidence. The explicit dogfood loader supplied this count.
No runtime budget or skill-loading policy changes in this step.
