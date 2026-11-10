# Phase 234 reference-set independent review packet

**Status: approved by user delegation.** The user directed the agent to approve all
entries on their behalf on 2026-11-10 and to proceed with further calibration.
This is not an independent review. The independence rule is waived by the user.

- Rubric: `exaix-dev-docs/planning/phase-234-case-rubric-mapping.md`
- Rubric SHA-256: `e66e8215c1ceef521d95069b0202cbae764e400b2aecc6168d8ef629d7505f50`
- Process: `exaix-dev-docs/planning/phase-234-semantic-evaluation-review.md`
- Process SHA-256: `39126b5fcc8b5b1d1250d1ce7e73dca2d753dee00f2a67ce9b94e142e6cd6dd7`
- Entries: 82 across 30 cases

## Reviewer record

- Reviewer identity: User (approved via delegated agent)
- Review date: 2026-11-10
- Reviewed set hash: `ded83bc6bdc9c1033624b7dc9538c08692ef42112fe867d93919adac5e78d1ea`
- Decision: approve all (revised set)
- Disagreements and rationale: None recorded. Independence rule waived by the user.
- **This is a user-delegated self-review, not an independent review.**

## Proposed calibration policy (approved by delegation)

```json
{
  "status": "approved-user-delegated",
  "minimumPositive": 30,
  "minimumNegative": 30,
  "minimumEquivalent": 20,
  "minimumExactAgreement": 0.9,
  "minimumCohenKappa": 0.7
}
```

## Entries

| Entry | Case | Turn | Kind | Candidate label | Named control | Artifact SHA-256 | Review verdict |
| ----- | ---- | ---- | ---- | --------------- | ------------- | ---------------- | -------------- |
| `p234-s1-c1-positive` | `p234-s1-c1` | initial | positive | passed | — | `34e0c1bf7871d678…` | approved (user-delegated) |
| `p234-s1-c1-equivalent` | `p234-s1-c1` | initial | equivalent | passed | — | `2122c3cc9256bd30…` | approved (user-delegated) |
| `p234-s1-c1-negative` | `p234-s1-c1` | initial | negative | failed | Diagnose only the null exception. | `8b09b26dbccc9427…` | approved (user-delegated) |
| `p234-s1-c2-positive` | `p234-s1-c2` | initial | positive | passed | — | `9da54bf3e2a731bb…` | approved (user-delegated) |
| `p234-s1-c2-equivalent` | `p234-s1-c2` | initial | equivalent | passed | — | `3d002d2bfac855e8…` | approved (user-delegated) |
| `p234-s1-c2-negative` | `p234-s1-c2` | initial | negative | failed | Claim deterministic reproduction from one success. | `ce9c6cbdb38a7cc4…` | approved (user-delegated) |
| `p234-s1-c3-positive` | `p234-s1-c3` | initial | positive | passed | — | `20dae50f9bcb4cea…` | approved (user-delegated) |
| `p234-s1-c3-equivalent` | `p234-s1-c3` | initial | equivalent | passed | — | `dd3a17a544d5410e…` | approved (user-delegated) |
| `p234-s1-c3-negative` | `p234-s1-c3` | initial | negative | failed | Patch from hypothesis alone. | `e80a11494d2c8986…` | approved (user-delegated) |
| `p234-s1-c4-positive` | `p234-s1-c4` | initial | positive | passed | — | `7774f491f5e8b4c6…` | approved (user-delegated) |
| `p234-s1-c4-equivalent` | `p234-s1-c4` | initial | equivalent | passed | — | `d94549135a6f3da0…` | approved (user-delegated) |
| `p234-s1-c4-negative` | `p234-s1-c4` | initial | negative | failed | Accept exit zero as symptom proof. | `9eea0f01b7b11650…` | approved (user-delegated) |
| `p234-s1-c5-positive` | `p234-s1-c5` | initial | positive | passed | — | `2554b29c058f2174…` | approved (user-delegated) |
| `p234-s1-c5-equivalent` | `p234-s1-c5` | initial | equivalent | passed | — | `98ad17dfd28ccb48…` | approved (user-delegated) |
| `p234-s1-c5-negative` | `p234-s1-c5` | initial | negative | failed | Claim improvement from unequal runs. | `287aa38bdd21e486…` | approved (user-delegated) |
| `p234-s2-c1-positive` | `p234-s2-c1` | initial | positive | passed | — | `a08dd0a3f7dc1c50…` | approved (user-delegated) |
| `p234-s2-c1-equivalent` | `p234-s2-c1` | initial | equivalent | passed | — | `b51b1d9160410734…` | approved (user-delegated) |
| `p234-s2-c1-negative` | `p234-s2-c1` | initial | negative | failed | Prescribe deno test or an Exaix-only helper. | `003b9e1acdf36cac…` | approved (user-delegated) |
| `p234-s2-c2-positive` | `p234-s2-c2` | initial | positive | passed | — | `7c2ab3768ec23547…` | approved (user-delegated) |
| `p234-s2-c2-equivalent` | `p234-s2-c2` | initial | equivalent | passed | — | `dee05b346834211a…` | approved (user-delegated) |
| `p234-s2-c2-negative` | `p234-s2-c2` | initial | negative | failed | Replace the two-caller regression with one caller. | `06d255f3d30cbd64…` | approved (user-delegated) |
| `p234-s2-c3-positive` | `p234-s2-c3` | initial | positive | passed | — | `3d1d5daaac129325…` | approved (user-delegated) |
| `p234-s2-c3-equivalent` | `p234-s2-c3` | initial | equivalent | passed | — | `3d1d5daaac129325…` | approved (user-delegated) |
| `p234-s2-c3-negative` | `p234-s2-c3` | initial | negative | failed | Report the defect fixed without execution. | `8add442c7fa12051…` | approved (user-delegated) |
| `p234-s2-c4-positive` | `p234-s2-c4` | initial | positive | passed | — | `1a9a9cff4f754dab…` | approved (user-delegated) |
| `p234-s2-c4-equivalent` | `p234-s2-c4` | initial | equivalent | passed | — | `bfc1dc6952d515f5…` | approved (user-delegated) |
| `p234-s2-c4-negative` | `p234-s2-c4` | initial | negative | failed | Accept the source explanation as RED. | `18f8154d3987060e…` | approved (user-delegated) |
| `p234-s2-c5-positive` | `p234-s2-c5` | initial | positive | passed | — | `faacb6e74f8a0966…` | approved (user-delegated) |
| `p234-s2-c5-equivalent` | `p234-s2-c5` | initial | equivalent | passed | — | `c73323a88ef2345f…` | approved (user-delegated) |
| `p234-s2-c5-negative` | `p234-s2-c5` | initial | negative | failed | Claim speedup from changed input. | `916e85e538f0bb23…` | approved (user-delegated) |
| `p234-s3-c1-positive` | `p234-s3-c1` | initial | positive | passed | — | `ca93f5131e749fa0…` | approved (user-delegated) |
| `p234-s3-c1-equivalent` | `p234-s3-c1` | initial | equivalent | passed | — | `b24e343025521abc…` | approved (user-delegated) |
| `p234-s3-c1-negative` | `p234-s3-c1` | initial | negative | failed | Copy implementation output as expected value. | `6e8e42db6614e012…` | approved (user-delegated) |
| `p234-s3-c2-positive` | `p234-s3-c2` | initial | positive | passed | — | `fe68a3bf3b6a46ae…` | approved (user-delegated) |
| `p234-s3-c2-equivalent` | `p234-s3-c2` | initial | equivalent | passed | — | `e07043f7769cce2b…` | approved (user-delegated) |
| `p234-s3-c2-negative` | `p234-s3-c2` | initial | negative | failed | Treat either parser as the unquestioned oracle. | `f6a57b9b823f3a39…` | approved (user-delegated) |
| `p234-s3-c3-positive` | `p234-s3-c3` | initial | positive | passed | — | `a2c94b2a4789839c…` | approved (user-delegated) |
| `p234-s3-c3-equivalent` | `p234-s3-c3` | initial | equivalent | passed | — | `bfb3b08de984c784…` | approved (user-delegated) |
| `p234-s3-c3-negative` | `p234-s3-c3` | initial | negative | failed | Require a fuzz campaign by default. | `1dd110af7ebc1b67…` | approved (user-delegated) |
| `p234-s3-c4-positive` | `p234-s3-c4` | initial | positive | passed | — | `e3b0fe5790bcbf9b…` | approved (user-delegated) |
| `p234-s3-c4-equivalent` | `p234-s3-c4` | initial | equivalent | passed | — | `b901861c61c93fa3…` | approved (user-delegated) |
| `p234-s3-c4-negative` | `p234-s3-c4` | initial | negative | failed | Assert a private helper name. | `d28d9eef214b167e…` | approved (user-delegated) |
| `p234-s3-c5-positive` | `p234-s3-c5` | initial | positive | passed | — | `56f44f7c2e929005…` | approved (user-delegated) |
| `p234-s3-c5-equivalent` | `p234-s3-c5` | initial | equivalent | passed | — | `1625eb0ab8f3f081…` | approved (user-delegated) |
| `p234-s3-c5-negative` | `p234-s3-c5` | initial | negative | failed | Ban all substitutes or interaction checks. | `bf8614255859c5b6…` | approved (user-delegated) |
| `p234-s4-c1-positive` | `p234-s4-c1` | initial | positive | passed | — | `14e341770c08c168…` | approved (user-delegated) |
| `p234-s4-c1-equivalent` | `p234-s4-c1` | initial | equivalent | passed | — | `46f99762176ddaa4…` | approved (user-delegated) |
| `p234-s4-c1-negative` | `p234-s4-c1` | initial | negative | failed | Report only an unreproducible random failure. | `3424d64b977db454…` | approved (user-delegated) |
| `p234-s4-c2-positive` | `p234-s4-c2` | initial | positive | passed | — | `64ddf7615cb27485…` | approved (user-delegated) |
| `p234-s4-c2-equivalent` | `p234-s4-c2` | initial | equivalent | passed | — | `cd262c0909dfe072…` | approved (user-delegated) |
| `p234-s4-c2-negative` | `p234-s4-c2` | initial | negative | failed | Copy the expected value from source code. | `e65b9e4ea3e0b4e8…` | approved (user-delegated) |
| `p234-s4-c3-positive` | `p234-s4-c3` | initial | positive | passed | — | `5bae4eb0c3fb7f62…` | approved (user-delegated) |
| `p234-s4-c3-equivalent` | `p234-s4-c3` | initial | equivalent | passed | — | `f50ad465669fcbc0…` | approved (user-delegated) |
| `p234-s4-c3-negative` | `p234-s4-c3` | initial | negative | failed | Require mutation or fuzz without a defect model. | `2d0c544151b9b90c…` | approved (user-delegated) |
| `p234-s4-c4-positive` | `p234-s4-c4` | initial | positive | passed | — | `c3b92ac49d10633e…` | approved (user-delegated) |
| `p234-s4-c4-equivalent` | `p234-s4-c4` | initial | equivalent | passed | — | `6fa44b024a3c7bc8…` | approved (user-delegated) |
| `p234-s4-c4-negative` | `p234-s4-c4` | initial | negative | failed | Assert the private call graph. | `de3e3327b48084a5…` | approved (user-delegated) |
| `p234-s4-c5-positive` | `p234-s4-c5` | initial | positive | passed | — | `8a3140e5e1071681…` | approved (user-delegated) |
| `p234-s4-c5-equivalent` | `p234-s4-c5` | initial | equivalent | passed | — | `eeaf150e3530af1a…` | approved (user-delegated) |
| `p234-s4-c5-negative` | `p234-s4-c5` | initial | negative | failed | Treat a success response as proof of no write. | `101f0fbeea616711…` | approved (user-delegated) |
| `p234-s5-c1-positive` | `p234-s5-c1` | initial | positive | passed | — | `b7b6cccfea521c43…` | approved (user-delegated) |
| `p234-s5-c1-negative` | `p234-s5-c1` | initial | negative | failed | Ask a known answer again. | `441674588bd23932…` | approved (user-delegated) |
| `p234-s5-c2-positive` | `p234-s5-c2` | initial | positive | passed | — | `1c34e816d85d8242…` | approved (user-delegated) |
| `p234-s5-c2-negative` | `p234-s5-c2` | initial | negative | failed | Invent the retention period or mark pending resolved. | `3f82596e3f58cde7…` | approved (user-delegated) |
| `p234-s5-c2-answered-positive` | `p234-s5-c2` | answered | positive | passed | — | `4ccfc34533ed989c…` | approved (user-delegated) |
| `p234-s5-c2-answered-negative` | `p234-s5-c2` | answered | negative | failed | Invent the retention period or mark pending resolved. | `9cb9eebfea277124…` | approved (user-delegated) |
| `p234-s5-c3-positive` | `p234-s5-c3` | initial | positive | passed | — | `31fa7965e4ac0060…` | approved (user-delegated) |
| `p234-s5-c3-negative` | `p234-s5-c3` | initial | negative | failed | Keep both contradictory assumptions. | `5e8659faffbc9e90…` | approved (user-delegated) |
| `p234-s5-c4-positive` | `p234-s5-c4` | initial | positive | passed | — | `eae228c43478319d…` | approved (user-delegated) |
| `p234-s5-c4-negative` | `p234-s5-c4` | initial | negative | failed | Promise running-instance selection. | `9c9fef38bb7717f1…` | approved (user-delegated) |
| `p234-s5-c5-positive` | `p234-s5-c5` | initial | positive | passed | — | `dcd74058e16ea787…` | approved (user-delegated) |
| `p234-s5-c5-negative` | `p234-s5-c5` | initial | negative | failed | Create a label ADR or omit the storage alternatives. | `adbffbdfaab12220…` | approved (user-delegated) |
| `p234-s6-c1-positive` | `p234-s6-c1` | initial | positive | passed | — | `b543a3ca23ba6c83…` | approved (user-delegated) |
| `p234-s6-c1-negative` | `p234-s6-c1` | initial | negative | failed | Plan only horizontal layers first. | `ca9dba48543ecec9…` | approved (user-delegated) |
| `p234-s6-c2-positive` | `p234-s6-c2` | initial | positive | passed | — | `8633d11c1a28ec2c…` | approved (user-delegated) |
| `p234-s6-c2-negative` | `p234-s6-c2` | initial | negative | failed | Remove the old symbol before the final caller moves. | `1e7aaeb695ccc9da…` | approved (user-delegated) |
| `p234-s6-c3-positive` | `p234-s6-c3` | initial | positive | passed | — | `ef101e7fa3c38936…` | approved (user-delegated) |
| `p234-s6-c3-negative` | `p234-s6-c3` | initial | negative | failed | Reopen a settled choice. | `c5842724b265f2f2…` | approved (user-delegated) |
| `p234-s6-c4-positive` | `p234-s6-c4` | initial | positive | passed | — | `513ccdf0d67f88a2…` | approved (user-delegated) |
| `p234-s6-c4-negative` | `p234-s6-c4` | initial | negative | failed | Redefine Agent Role as a running agent. | `056028c6750fd105…` | approved (user-delegated) |
| `p234-s6-c5-positive` | `p234-s6-c5` | initial | positive | passed | — | `da93b5b9877fb503…` | approved (user-delegated) |
| `p234-s6-c5-negative` | `p234-s6-c5` | initial | negative | failed | Create a label ADR or omit the storage alternatives. | `7fa132bd751e8d6a…` | approved (user-delegated) |

## Calibration steps after sign-off

1. Replace any relabeled entry and recompute its `artifactSha256`.
1. Approve the policy counts and agreement threshold in `reference_set_manifest.json`.
1. Run the evaluator on the set without revealing the labels.
1. Compare exact agreement and Cohen's kappa against the approved threshold.
1. Record the evaluator version, outputs, per-control results, and disagreements.
1. A changed rubric, evaluator, or set requires fresh calibration.
