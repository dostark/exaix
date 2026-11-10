# Phase 234 reference-set independent review packet

**Status: review pending.** This packet is prepared for an independent reviewer.
The candidate labels come from the legacy case fixtures. They are not approved.
The evaluator and artifact author must not sign this packet.

- Rubric: `exaix-dev-docs/planning/phase-234-case-rubric-mapping.md`
- Rubric SHA-256: `e66e8215c1ceef521d95069b0202cbae764e400b2aecc6168d8ef629d7505f50`
- Process: `exaix-dev-docs/planning/phase-234-semantic-evaluation-review.md`
- Process SHA-256: `39126b5fcc8b5b1d1250d1ce7e73dca2d753dee00f2a67ce9b94e142e6cd6dd7`
- Entries: 82 across 30 cases

## Reviewer record

- Reviewer identity:
- Review date:
- Reviewed set hash:
- Decision: approve / approve with changes / reject
- Disagreements and rationale:

## Proposed calibration policy (not approved)

```json
{
  "status": "proposed-not-approved",
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
| `p234-s1-c1-positive` | `p234-s1-c1` | initial | positive | passed | — | `2c71ecf6d01b6ace…` | |
| `p234-s1-c1-equivalent` | `p234-s1-c1` | initial | equivalent | passed | — | `ff464216d1f700f5…` | |
| `p234-s1-c1-negative` | `p234-s1-c1` | initial | negative | failed | Diagnose only the null exception. | `8b09b26dbccc9427…` | |
| `p234-s1-c2-positive` | `p234-s1-c2` | initial | positive | passed | — | `64930eeea9f7f708…` | |
| `p234-s1-c2-equivalent` | `p234-s1-c2` | initial | equivalent | passed | — | `3d002d2bfac855e8…` | |
| `p234-s1-c2-negative` | `p234-s1-c2` | initial | negative | failed | Claim deterministic reproduction from one success. | `ce9c6cbdb38a7cc4…` | |
| `p234-s1-c3-positive` | `p234-s1-c3` | initial | positive | passed | — | `20dae50f9bcb4cea…` | |
| `p234-s1-c3-equivalent` | `p234-s1-c3` | initial | equivalent | passed | — | `dd3a17a544d5410e…` | |
| `p234-s1-c3-negative` | `p234-s1-c3` | initial | negative | failed | Patch from hypothesis alone. | `e80a11494d2c8986…` | |
| `p234-s1-c4-positive` | `p234-s1-c4` | initial | positive | passed | — | `7f4b08b2e7ed0280…` | |
| `p234-s1-c4-equivalent` | `p234-s1-c4` | initial | equivalent | passed | — | `38ed010b6094f17a…` | |
| `p234-s1-c4-negative` | `p234-s1-c4` | initial | negative | failed | Accept exit zero as symptom proof. | `9eea0f01b7b11650…` | |
| `p234-s1-c5-positive` | `p234-s1-c5` | initial | positive | passed | — | `2554b29c058f2174…` | |
| `p234-s1-c5-equivalent` | `p234-s1-c5` | initial | equivalent | passed | — | `98ad17dfd28ccb48…` | |
| `p234-s1-c5-negative` | `p234-s1-c5` | initial | negative | failed | Claim improvement from unequal runs. | `287aa38bdd21e486…` | |
| `p234-s2-c1-positive` | `p234-s2-c1` | initial | positive | passed | — | `23efd0d4dd24e636…` | |
| `p234-s2-c1-equivalent` | `p234-s2-c1` | initial | equivalent | passed | — | `b51b1d9160410734…` | |
| `p234-s2-c1-negative` | `p234-s2-c1` | initial | negative | failed | Prescribe deno test or an Exaix-only helper. | `003b9e1acdf36cac…` | |
| `p234-s2-c2-positive` | `p234-s2-c2` | initial | positive | passed | — | `a8d432d09198e330…` | |
| `p234-s2-c2-equivalent` | `p234-s2-c2` | initial | equivalent | passed | — | `7d55e5a5e1b729d2…` | |
| `p234-s2-c2-negative` | `p234-s2-c2` | initial | negative | failed | Replace the two-caller regression with one caller. | `06d255f3d30cbd64…` | |
| `p234-s2-c3-positive` | `p234-s2-c3` | initial | positive | passed | — | `159656be78518b38…` | |
| `p234-s2-c3-equivalent` | `p234-s2-c3` | initial | equivalent | passed | — | `9246b1edb9637ab2…` | |
| `p234-s2-c3-negative` | `p234-s2-c3` | initial | negative | failed | Report the defect fixed without execution. | `8add442c7fa12051…` | |
| `p234-s2-c4-positive` | `p234-s2-c4` | initial | positive | passed | — | `1a9a9cff4f754dab…` | |
| `p234-s2-c4-equivalent` | `p234-s2-c4` | initial | equivalent | passed | — | `bfc1dc6952d515f5…` | |
| `p234-s2-c4-negative` | `p234-s2-c4` | initial | negative | failed | Accept the source explanation as RED. | `18f8154d3987060e…` | |
| `p234-s2-c5-positive` | `p234-s2-c5` | initial | positive | passed | — | `faacb6e74f8a0966…` | |
| `p234-s2-c5-equivalent` | `p234-s2-c5` | initial | equivalent | passed | — | `c73323a88ef2345f…` | |
| `p234-s2-c5-negative` | `p234-s2-c5` | initial | negative | failed | Claim speedup from changed input. | `916e85e538f0bb23…` | |
| `p234-s3-c1-positive` | `p234-s3-c1` | initial | positive | passed | — | `3fafcb3f0994b231…` | |
| `p234-s3-c1-equivalent` | `p234-s3-c1` | initial | equivalent | passed | — | `90b14ee8610ad01b…` | |
| `p234-s3-c1-negative` | `p234-s3-c1` | initial | negative | failed | Copy implementation output as expected value. | `6e8e42db6614e012…` | |
| `p234-s3-c2-positive` | `p234-s3-c2` | initial | positive | passed | — | `faf25ad4083ed474…` | |
| `p234-s3-c2-equivalent` | `p234-s3-c2` | initial | equivalent | passed | — | `3892eebc65bf9c96…` | |
| `p234-s3-c2-negative` | `p234-s3-c2` | initial | negative | failed | Treat either parser as the unquestioned oracle. | `f6a57b9b823f3a39…` | |
| `p234-s3-c3-positive` | `p234-s3-c3` | initial | positive | passed | — | `a2c94b2a4789839c…` | |
| `p234-s3-c3-equivalent` | `p234-s3-c3` | initial | equivalent | passed | — | `bfb3b08de984c784…` | |
| `p234-s3-c3-negative` | `p234-s3-c3` | initial | negative | failed | Require a fuzz campaign by default. | `1dd110af7ebc1b67…` | |
| `p234-s3-c4-positive` | `p234-s3-c4` | initial | positive | passed | — | `8f92d4cf4bb7e0c6…` | |
| `p234-s3-c4-equivalent` | `p234-s3-c4` | initial | equivalent | passed | — | `bed85e1effc3663b…` | |
| `p234-s3-c4-negative` | `p234-s3-c4` | initial | negative | failed | Assert a private helper name. | `d28d9eef214b167e…` | |
| `p234-s3-c5-positive` | `p234-s3-c5` | initial | positive | passed | — | `bfd63934b300d21f…` | |
| `p234-s3-c5-equivalent` | `p234-s3-c5` | initial | equivalent | passed | — | `56ab15b5b99578f6…` | |
| `p234-s3-c5-negative` | `p234-s3-c5` | initial | negative | failed | Ban all substitutes or interaction checks. | `bf8614255859c5b6…` | |
| `p234-s4-c1-positive` | `p234-s4-c1` | initial | positive | passed | — | `f627e94959951226…` | |
| `p234-s4-c1-equivalent` | `p234-s4-c1` | initial | equivalent | passed | — | `93551fbc8b3a92a0…` | |
| `p234-s4-c1-negative` | `p234-s4-c1` | initial | negative | failed | Report only an unreproducible random failure. | `3424d64b977db454…` | |
| `p234-s4-c2-positive` | `p234-s4-c2` | initial | positive | passed | — | `e9ffa5cf6ce2a279…` | |
| `p234-s4-c2-equivalent` | `p234-s4-c2` | initial | equivalent | passed | — | `868cbe220b6bb3a2…` | |
| `p234-s4-c2-negative` | `p234-s4-c2` | initial | negative | failed | Copy the expected value from source code. | `e65b9e4ea3e0b4e8…` | |
| `p234-s4-c3-positive` | `p234-s4-c3` | initial | positive | passed | — | `5bae4eb0c3fb7f62…` | |
| `p234-s4-c3-equivalent` | `p234-s4-c3` | initial | equivalent | passed | — | `f50ad465669fcbc0…` | |
| `p234-s4-c3-negative` | `p234-s4-c3` | initial | negative | failed | Require mutation or fuzz without a defect model. | `2d0c544151b9b90c…` | |
| `p234-s4-c4-positive` | `p234-s4-c4` | initial | positive | passed | — | `d70e38356e1e41a9…` | |
| `p234-s4-c4-equivalent` | `p234-s4-c4` | initial | equivalent | passed | — | `3fe2ce2566184e64…` | |
| `p234-s4-c4-negative` | `p234-s4-c4` | initial | negative | failed | Assert the private call graph. | `de3e3327b48084a5…` | |
| `p234-s4-c5-positive` | `p234-s4-c5` | initial | positive | passed | — | `abf543e76b183866…` | |
| `p234-s4-c5-equivalent` | `p234-s4-c5` | initial | equivalent | passed | — | `4cfe41cd2ccfcc28…` | |
| `p234-s4-c5-negative` | `p234-s4-c5` | initial | negative | failed | Treat a success response as proof of no write. | `101f0fbeea616711…` | |
| `p234-s5-c1-positive` | `p234-s5-c1` | initial | positive | passed | — | `b7b6cccfea521c43…` | |
| `p234-s5-c1-negative` | `p234-s5-c1` | initial | negative | failed | Ask a known answer again. | `441674588bd23932…` | |
| `p234-s5-c2-positive` | `p234-s5-c2` | initial | positive | passed | — | `1c34e816d85d8242…` | |
| `p234-s5-c2-negative` | `p234-s5-c2` | initial | negative | failed | Invent the retention period or mark pending resolved. | `2f9648159d0bbd4d…` | |
| `p234-s5-c2-answered-positive` | `p234-s5-c2` | answered | positive | passed | — | `4ccfc34533ed989c…` | |
| `p234-s5-c2-answered-negative` | `p234-s5-c2` | answered | negative | failed | Invent the retention period or mark pending resolved. | `14c865a34a14ac67…` | |
| `p234-s5-c3-positive` | `p234-s5-c3` | initial | positive | passed | — | `31fa7965e4ac0060…` | |
| `p234-s5-c3-negative` | `p234-s5-c3` | initial | negative | failed | Keep both contradictory assumptions. | `7e33844a2e82991b…` | |
| `p234-s5-c4-positive` | `p234-s5-c4` | initial | positive | passed | — | `eae228c43478319d…` | |
| `p234-s5-c4-negative` | `p234-s5-c4` | initial | negative | failed | Promise running-instance selection. | `9c9fef38bb7717f1…` | |
| `p234-s5-c5-positive` | `p234-s5-c5` | initial | positive | passed | — | `dcd74058e16ea787…` | |
| `p234-s5-c5-negative` | `p234-s5-c5` | initial | negative | failed | Create a label ADR or omit the storage alternatives. | `adbffbdfaab12220…` | |
| `p234-s6-c1-positive` | `p234-s6-c1` | initial | positive | passed | — | `b543a3ca23ba6c83…` | |
| `p234-s6-c1-negative` | `p234-s6-c1` | initial | negative | failed | Plan only horizontal layers first. | `915c56406661912b…` | |
| `p234-s6-c2-positive` | `p234-s6-c2` | initial | positive | passed | — | `8633d11c1a28ec2c…` | |
| `p234-s6-c2-negative` | `p234-s6-c2` | initial | negative | failed | Remove the old symbol before the final caller moves. | `5399ca7e47ee9c90…` | |
| `p234-s6-c3-positive` | `p234-s6-c3` | initial | positive | passed | — | `ef101e7fa3c38936…` | |
| `p234-s6-c3-negative` | `p234-s6-c3` | initial | negative | failed | Reopen a settled choice. | `79f32c01cc80e05b…` | |
| `p234-s6-c4-positive` | `p234-s6-c4` | initial | positive | passed | — | `513ccdf0d67f88a2…` | |
| `p234-s6-c4-negative` | `p234-s6-c4` | initial | negative | failed | Redefine Agent Role as a running agent. | `252fd84b5842dcf3…` | |
| `p234-s6-c5-positive` | `p234-s6-c5` | initial | positive | passed | — | `da93b5b9877fb503…` | |
| `p234-s6-c5-negative` | `p234-s6-c5` | initial | negative | failed | Create a label ADR or omit the storage alternatives. | `7fa132bd751e8d6a…` | |

## Calibration steps after sign-off

1. Replace any relabeled entry and recompute its `artifactSha256`.
1. Approve the policy counts and agreement threshold in `reference_set_manifest.json`.
1. Run the evaluator on the set without revealing the labels.
1. Compare exact agreement and Cohen's kappa against the approved threshold.
1. Record the evaluator version, outputs, per-control results, and disagreements.
1. A changed rubric, evaluator, or set requires fresh calibration.
