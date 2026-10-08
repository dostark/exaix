---
title: "Advanced flow cutover evidence"
description: "Compiled edition, provider input, request trace and regression evidence for Phase 205 integration."
---

Verified on 2026-10-08. Step 9 is complete. Step 10 documentation remains pending.

Runtime source revision: `3d414f23c70ed502577c7c4936cd4c56f135a9f0`. Team submodule revision: `4add90ca1182f6e5dd0aea29dc31d9e0b2a6f66f`.
The archive includes 283 source and fixture SHA-256 digests, full scenario and daemon output, request-scoped journal rows, configs, locks, immutable run overlays and HTTP inputs. Source digests include the uncommitted Step 9 test harness at validation time.

[Download raw evidence](phase205-advanced-flows-cutover-evidence.json.gz) (gzip JSON; SHA-256 `a46785ef31f7da58fece962922b0dd3f71c9e030ac6de9b7957a8588f9e727b0`).

```bash
gzip -dc docs/phase205-advanced-flows-cutover-evidence.json.gz > /tmp/phase205-cutover-evidence.json
```

## Executed checks

All final commands exited 0. Final full command: `env -u CI DENO_JOBS=4 deno task test_all:team`. The combined matrix executed 28 tests, with zero failures and zero ignored selected cases. It contains 14 advanced controls, one mixed-model run and all 13 prior blueprint regressions.

```text
Check tests/scenario_framework/tests/integration/advanced_flow_controls_test.ts
Check tests/scenario_framework/tests/integration/advanced_flows_cutover_test.ts
running 14 tests from ./tests/scenario_framework/tests/integration/advanced_flow_controls_test.ts
[phase205 step1] gate-halt real solo daemon ... ok (13s)
[phase205 step1] gate-continue-warning real solo daemon ... ok (10s)
[phase205 step2] gate-retry real solo daemon ... ok (10s)
[phase205 step2] gate-retry-exhausted real solo daemon ... ok (11s)
[phase205 step2] gate-retry-budget real solo daemon ... ok (10s)
[phase205 step3] branch-routing real solo daemon ... ok (10s)
[phase205 step4] architecture-decision real team daemon ... ok (14s)
[phase205 step4] architecture-decision-solo real solo daemon ... ok (11s)
[phase205 step5] self-correcting-implementation real solo daemon ... ok (12s)
[phase205 step6] triage-router real solo daemon ... ok (11s)
[phase205 step6] triage-router-docs real solo daemon ... ok (11s)
[phase205 step7] parallel-research real team daemon ... ok (12s)
[phase205 step8] guarded-change real team daemon ... ok (16s)
[phase205 step8] guarded-change-pass real team daemon ... ok (16s)
running 14 tests from ./tests/scenario_framework/tests/integration/advanced_flows_cutover_test.ts
[phase205 cutover] compiled Solo retry loop uses an immutable gate overlay and mock body ... ok (14s)
[phase205 cutover regression] migration_planning compiled solo ... ok (8s)
[phase205 cutover regression] security_audit compiled solo ... ok (8s)
[phase205 cutover regression] analyze-codebase compiled team ... ok (9s)
[phase205 cutover regression] api_design compiled solo ... ok (7s)
[phase205 cutover regression] feature_development compiled solo ... ok (8s)
[phase205 cutover regression] dogfood_context compiled solo ... ok (8s)
[phase205 cutover regression] pr_review compiled solo ... ok (8s)
[phase205 cutover regression] dogfood_loop compiled solo ... ok (7s)
[phase205 cutover regression] test_generation compiled solo ... ok (8s)
[phase205 cutover regression] onboarding_docs compiled solo ... ok (8s)
[phase205 cutover regression] bug_investigation compiled solo ... ok (8s)
[phase205 cutover regression] refactoring compiled solo ... ok (8s)
[phase205 cutover regression] api_documentation compiled solo ... ok (8s)

ok | 28 passed | 0 failed (4m57s)
```

| Check                                                  | Result                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Solo and Team build tasks with `--compile`             | Both CLI/daemon pairs compiled and validated                                     |
| Repository `deno task check`                           | Passed; subsequent flow repair also passed static CI type checking               |
| Static CI after runtime and isolation repairs          | Passed with zero style errors                                                    |
| Isolation, fixture coverage and edition registration   | 40 passed, including seven Solo/Team/Enterprise registration tests               |
| Gate terminal behavior, replay and judge forwarding    | 36 passed                                                                        |
| Clock rollback, checkpoints, branch routing and runner | 89 passed                                                                        |
| Security suite                                         | 122 passed, zero failed, two baseline ignored                                    |
| Fixture security validation                            | One additional test passed                                                       |
| Deployment supplement with CI and DENO_JOBS unset      | Six passed, zero failed, zero ignored                                            |
| Integration duplication                                | 3.7535385387178843%, below 3.8%                                                  |
| Event coverage                                         | Advisory: no missing logger on visible classes; no new production event boundary |

## Binary identity

| Binary                                 | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `exactl-solo-x86_64-unknown-linux-gnu` | `02d97c69ea6c7a565f7c8613129a21dd92d2a491500e1c63285e6c69969dea5d` |
| `exactl-team-x86_64-unknown-linux-gnu` | `24b77f0c76c37e46f629e01d559d21f53b3d152a6359871cff397b2f0e93fd15` |
| `exaix-team-x86_64-unknown-linux-gnu`  | `20331d3fbdc1c9939e20c50c8bf588d40c05fcf91a9c4aa413f95caae57dfad2` |
| `exaix-x86_64-unknown-linux-gnu`       | `53d54127939357c96ffc44dfdcefadb3ca6e7a2831580ab4e3b4c299286e9ddb` |

Edition selection uses the scenario harness binary naming pattern. Every case checks that both edition binaries exist. Team capability registration uses the actual bootstrap seam, also tested for Enterprise.

## Request and flow identity

Counts use the actual SQLite `trace_id` column of the submitted CLI request. All full rows and expected-call manifests are retained in the archive. The non-flow `dogfood_context` regression has no flow run. CLI delegate rows consume protocol fixtures and have no `llm.call.completed` events.

| Case                             | Edition | Request trace                          | Flow run                               | Model completions | Gates | Loops |
| -------------------------------- | ------- | -------------------------------------- | -------------------------------------- | ----------------- | ----- | ----- |
| `gate-halt`                      | solo    | `a8c23ad1-c497-4a3a-b9eb-7b1ed19f7dad` | `234facd5-5227-480d-ab6a-a9bd8abe9a3b` | 1                 | 1     | 0     |
| `gate-continue-warning`          | solo    | `1bac03d3-5a77-4f90-8824-4b3e84c4af0c` | `a0c0111b-128c-41d7-9fe8-9a4748c43463` | 2                 | 1     | 0     |
| `gate-retry`                     | solo    | `72f473ec-8b97-42ed-91aa-59ee3f75473d` | `ae58e86d-b904-4572-9a11-5374795d9749` | 5                 | 2     | 1     |
| `gate-retry-exhausted`           | solo    | `1f7ec6a7-f73e-40ec-9431-8cbaf98c003d` | `1db2a9b7-2cdd-4983-921d-b7b6a639e52a` | 6                 | 3     | 2     |
| `gate-retry-budget`              | solo    | `0573ea82-c6b1-4ccf-a4d0-58a699713f2b` | `24532fd4-269d-40f3-a4c5-6e37e04f9e6d` | 2                 | 1     | 0     |
| `branch-routing`                 | solo    | `ba573073-baf2-41a6-8604-cae7a734d70d` | `b1f82314-8d13-4c0b-bb75-7fdb24734360` | 4                 | 0     | 0     |
| `architecture-decision`          | team    | `711b858f-a5d4-48c8-830a-4ee7f5d93146` | `fe3aa655-b074-45e8-a523-477fbee20747` | 5                 | 0     | 0     |
| `architecture-decision-solo`     | solo    | `ad460a8d-bea7-4fb5-a8b7-7b09b3a5ff33` | `ad1eebe7-99f0-464c-9443-e8ec51ead346` | 0                 | 0     | 0     |
| `self-correcting-implementation` | solo    | `d3a5ab5c-aa29-406b-a890-a2915472de3f` | `d3bee2e4-813b-40b1-9c52-087b5a0c012d` | 9                 | 2     | 1     |
| `triage-router`                  | solo    | `fe3a7972-307a-4236-a90a-69cc390d52a3` | `41289fe0-6b03-4055-ac39-bf66a61336fd` | 4                 | 0     | 0     |
| `triage-router-docs`             | solo    | `1d35194f-ff32-4f21-9b11-152abbcda89f` | `9490e074-1258-4295-abd5-4c81d0b82439` | 3                 | 0     | 0     |
| `parallel-research`              | team    | `5e642856-142b-4830-b664-c324c8dc605b` | `2590b1f0-dde5-474d-ab82-5ec53e6003fb` | 5                 | 1     | 0     |
| `guarded-change`                 | team    | `f3f66e0b-a3d8-4dc4-a693-7bd58ad72103` | `935beae8-3eac-4f17-8d5a-44587f3c6637` | 4                 | 1     | 0     |
| `guarded-change-pass`            | team    | `f446d4cb-5ef8-40c4-a112-0bafb42f3476` | `519d415e-da7e-46ae-b610-a6828e68607b` | 5                 | 1     | 0     |
| `mixed-model`                    | solo    | `43aae723-4e69-4c4f-947e-b94f3096f675` | `b56f410b-eece-4522-9093-553a6dd87789` | 9                 | 2     | 1     |
| `migration_planning`             | solo    | `738f58a5-ac24-44d7-97be-7848b310fe0e` | `09ecbc84-3fec-441b-88ce-e19ebcf645d2` | 9                 | 0     | 0     |
| `security_audit`                 | solo    | `529138e7-dae1-4bd2-ad22-65c584d88b34` | `15183fac-9eed-409a-a8b9-6dab21591110` | 8                 | 0     | 0     |
| `analyze-codebase`               | team    | `bbd1be27-b092-4325-b822-45e8fdc955ae` | `33ebbdd6-7fdb-44c1-90f5-a0973de75e65` | 2                 | 0     | 0     |
| `api_design`                     | solo    | `3f5598b4-a645-4ec0-8d60-09d23734339d` | `218eee90-9479-45ed-944f-21985457f0ba` | 8                 | 0     | 0     |
| `feature_development`            | solo    | `daadffb8-cbb8-4b43-8667-fb3322be2f45` | `78e9a569-2ba8-40a4-acd7-d35e7e8d71ea` | 0                 | 0     | 0     |
| `dogfood_context`                | solo    | `f58bffce-3c46-471e-bb42-9fb5217a6a3e` | `none`                                 | 1                 | 0     | 0     |
| `pr_review`                      | solo    | `fc38e6ea-e259-42f4-bd4e-7751a3fe647f` | `33be5a97-3686-4a13-b73d-981e42d913a6` | 8                 | 0     | 0     |
| `dogfood_loop`                   | solo    | `432a1744-9c0d-4c40-8e9f-1dc374ba8a0f` | `4d7f2db2-f0b7-4c2c-ba9c-42e359f60216` | 0                 | 0     | 0     |
| `test_generation`                | solo    | `d66dc610-083d-469b-9e81-15fc2e046960` | `7c00e938-268d-42a1-83e5-5a252a73e1e8` | 8                 | 0     | 0     |
| `onboarding_docs`                | solo    | `1facc940-6cac-4292-b5ff-b62cafe65a8b` | `94a04672-27aa-4452-b800-f86707be8d7e` | 8                 | 0     | 0     |
| `bug_investigation`              | solo    | `9fa5152a-4886-40d9-9e42-37deb3d6225f` | `6de1bb62-a774-4a12-b57f-23cf78046694` | 7                 | 0     | 0     |
| `refactoring`                    | solo    | `3f2fefa6-8e99-4fd8-b354-3f23eda9daa6` | `8a6b0a40-d23c-445b-bddc-0bdd11635d44` | 0                 | 0     | 0     |
| `api_documentation`              | solo    | `018ec8d2-12c0-4faf-9b2d-0cfaf1c4741a` | `d5422af9-be9c-4b3f-a1fa-bdadae69f32a` | 6                 | 0     | 0     |

## Mixed-model snapshot and provider consumption

Trace `43aae723-4e69-4c4f-947e-b94f3096f675` retained one immutable overlay with SHA-256 `51a276a5b59ebf8ee443a2d8d0d46a98884178ea89731660e33e73b3ba8b0614`. The CLI source overlay was emptied after submission. Both attempts still resolved the gate to `compat-fixture`; the other four steps resolved to mock. The retry produced eight binding resolutions, two gate evaluations, one loop iteration and nine model completions: seven mock calls and two HTTP calls.

The HTTP fixture returns the two committed raw judge JSON responses. Attempt 1 receives IMPLEMENTATION V1 and TESTS V1; attempt 2 receives V2 and excludes V1. The report provider input contains IMPLEMENTATION V2 and TESTS V2. Full HTTP messages and report inputs are retained in the archive.

```json
[
  {
    "action_type": "binding.snapshot.created",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "lock_path": "/tmp/phase205-self-correcting-implementation-3921e391f6789f1f/.exa/bindings/43aae723-4e69-4c4f-947e-b94f3096f675.lock.json",
      "lock_sha256": "c185a207c271ccac9f775643b9ac978c8f0d1fe80a1e5870e1f2c56f7ba76085",
      "entries": 5,
      "issues": 0,
      "hosts": [
        "127.0.0.1:36719"
      ],
      "config_checksum": "3609b3b982a481260a6deef16e3136ae7bbaf132cf6ee1880f846fe618fc9a30",
      "overlay_sha256": [
        "51a276a5b59ebf8ee443a2d8d0d46a98884178ea89731660e33e73b3ba8b0614"
      ],
      "run_overlays": 1,
      "env_ignored": true,
      "replayed": false
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "plan",
      "agent_role": "software-architect",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "mock",
      "model_provider": "mock",
      "model": "mock/phase205-fixture",
      "service_model_id": "phase205-fixture",
      "transport": "local",
      "interface": "api",
      "adapter": "mock",
      "sources": {
        "service": {
          "layer": "config",
          "selector": "default"
        },
        "model": {
          "layer": "config",
          "selector": "default"
        },
        "model_provider": {
          "layer": "config",
          "selector": "default"
        },
        "service_model_id": {
          "layer": "config",
          "selector": "default"
        },
        "transport": {
          "layer": "config",
          "selector": "default"
        },
        "interface": {
          "layer": "config",
          "selector": "default"
        }
      },
      "fingerprint": "dd4440ad9118a66ab725b2ba1aa6d40052dd3940ffd92b9b7120e11c1ea1960c"
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "implement",
      "agent_role": "senior-coder",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "mock",
      "model_provider": "mock",
      "model": "mock/phase205-fixture",
      "service_model_id": "phase205-fixture",
      "transport": "local",
      "interface": "api",
      "adapter": "mock",
      "sources": {
        "service": {
          "layer": "config",
          "selector": "default"
        },
        "model": {
          "layer": "config",
          "selector": "default"
        },
        "model_provider": {
          "layer": "config",
          "selector": "default"
        },
        "service_model_id": {
          "layer": "config",
          "selector": "default"
        },
        "transport": {
          "layer": "config",
          "selector": "default"
        },
        "interface": {
          "layer": "config",
          "selector": "default"
        }
      },
      "fingerprint": "dd4440ad9118a66ab725b2ba1aa6d40052dd3940ffd92b9b7120e11c1ea1960c"
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "write-tests",
      "agent_role": "test-engineer",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "mock",
      "model_provider": "mock",
      "model": "mock/phase205-fixture",
      "service_model_id": "phase205-fixture",
      "transport": "local",
      "interface": "api",
      "adapter": "mock",
      "sources": {
        "service": {
          "layer": "config",
          "selector": "default"
        },
        "model": {
          "layer": "config",
          "selector": "default"
        },
        "model_provider": {
          "layer": "config",
          "selector": "default"
        },
        "service_model_id": {
          "layer": "config",
          "selector": "default"
        },
        "transport": {
          "layer": "config",
          "selector": "default"
        },
        "interface": {
          "layer": "config",
          "selector": "default"
        }
      },
      "fingerprint": "dd4440ad9118a66ab725b2ba1aa6d40052dd3940ffd92b9b7120e11c1ea1960c"
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "quality-gate",
      "agent_role": "quality-judge",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "compat-fixture",
      "model_provider": "openai",
      "model": "openai/compat-fixture-v1",
      "service_model_id": "compat-fixture-v1",
      "transport": "local",
      "interface": "api",
      "adapter": "openai-chat",
      "sources": {
        "service": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "model": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "model_provider": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "service_model_id": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "transport": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "interface": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        }
      },
      "fingerprint": "98c9c305e96381958f68926dccb758b45ba637f89d494afc8c1562c090a69978"
    }
  },
  {
    "action_type": "flow.gate.evaluated",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flowRunId": "b56f410b-eece-4522-9093-553a6dd87789",
      "stepId": "quality-gate",
      "traceId": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "requestId": "request-43aae723",
      "score": 0.20000000000000004,
      "threshold": 0.8,
      "passed": false,
      "action": "retry",
      "attempt": 1
    }
  },
  {
    "action_type": "flow.loop.iteration",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flowRunId": "b56f410b-eece-4522-9093-553a6dd87789",
      "gateStepId": "quality-gate",
      "backTo": "implement",
      "iteration": 1,
      "maxRetries": 2,
      "bodyStepIds": [
        "implement",
        "write-tests"
      ],
      "previousScore": 0.20000000000000004,
      "traceId": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "requestId": "request-43aae723"
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "implement",
      "agent_role": "senior-coder",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "mock",
      "model_provider": "mock",
      "model": "mock/phase205-fixture",
      "service_model_id": "phase205-fixture",
      "transport": "local",
      "interface": "api",
      "adapter": "mock",
      "sources": {
        "service": {
          "layer": "config",
          "selector": "default"
        },
        "model": {
          "layer": "config",
          "selector": "default"
        },
        "model_provider": {
          "layer": "config",
          "selector": "default"
        },
        "service_model_id": {
          "layer": "config",
          "selector": "default"
        },
        "transport": {
          "layer": "config",
          "selector": "default"
        },
        "interface": {
          "layer": "config",
          "selector": "default"
        }
      },
      "fingerprint": "dd4440ad9118a66ab725b2ba1aa6d40052dd3940ffd92b9b7120e11c1ea1960c"
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "write-tests",
      "agent_role": "test-engineer",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "mock",
      "model_provider": "mock",
      "model": "mock/phase205-fixture",
      "service_model_id": "phase205-fixture",
      "transport": "local",
      "interface": "api",
      "adapter": "mock",
      "sources": {
        "service": {
          "layer": "config",
          "selector": "default"
        },
        "model": {
          "layer": "config",
          "selector": "default"
        },
        "model_provider": {
          "layer": "config",
          "selector": "default"
        },
        "service_model_id": {
          "layer": "config",
          "selector": "default"
        },
        "transport": {
          "layer": "config",
          "selector": "default"
        },
        "interface": {
          "layer": "config",
          "selector": "default"
        }
      },
      "fingerprint": "dd4440ad9118a66ab725b2ba1aa6d40052dd3940ffd92b9b7120e11c1ea1960c"
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "quality-gate",
      "agent_role": "quality-judge",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "compat-fixture",
      "model_provider": "openai",
      "model": "openai/compat-fixture-v1",
      "service_model_id": "compat-fixture-v1",
      "transport": "local",
      "interface": "api",
      "adapter": "openai-chat",
      "sources": {
        "service": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "model": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "model_provider": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "service_model_id": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "transport": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        },
        "interface": {
          "layer": "run",
          "selector": "flow:self-correcting-implementation/step:quality-gate"
        }
      },
      "fingerprint": "98c9c305e96381958f68926dccb758b45ba637f89d494afc8c1562c090a69978"
    }
  },
  {
    "action_type": "flow.gate.evaluated",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flowRunId": "b56f410b-eece-4522-9093-553a6dd87789",
      "stepId": "quality-gate",
      "traceId": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "requestId": "request-43aae723",
      "score": 1,
      "threshold": 0.8,
      "passed": true,
      "action": "passed",
      "attempt": 2
    }
  },
  {
    "action_type": "binding.resolved",
    "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
    "payload": {
      "flow_id": "self-correcting-implementation",
      "step_id": "report",
      "agent_role": "technical-writer",
      "trace_id": "43aae723-4e69-4c4f-947e-b94f3096f675",
      "service": "mock",
      "model_provider": "mock",
      "model": "mock/phase205-fixture",
      "service_model_id": "phase205-fixture",
      "transport": "local",
      "interface": "api",
      "adapter": "mock",
      "sources": {
        "service": {
          "layer": "config",
          "selector": "default"
        },
        "model": {
          "layer": "config",
          "selector": "default"
        },
        "model_provider": {
          "layer": "config",
          "selector": "default"
        },
        "service_model_id": {
          "layer": "config",
          "selector": "default"
        },
        "transport": {
          "layer": "config",
          "selector": "default"
        },
        "interface": {
          "layer": "config",
          "selector": "default"
        }
      },
      "fingerprint": "dd4440ad9118a66ab725b2ba1aa6d40052dd3940ffd92b9b7120e11c1ea1960c"
    }
  }
]
```

## Namespace and guarded-change consumers

The Team compose provider prompt contains both successful explorer sentinels and their findings keys. It contains neither the failed explorer sentinel nor its findings key. The actual namespace read requests all three keys; only two successful explorers write values.

Both Team guarded cases activate the real session cycle and complete one approved implementation review. Before shutdown, the fixture checks the delegated parent trace, worktree root, two permitted paths, exact returned paths, changed proof file, passing proof test and absence of writes in the plain portal. The failing flow security gate blocks validate; the passing gate reaches validate. Full parent journal rows and captured delegated trace identity are retained.

## Runtime correction and reachability

An initial compiled run observed a wall clock correction of about 900 ms. Its negative step duration failed checkpoint validation. A regression test reproduced the same undefined-wave-result error. The separate runtime repair clamps computed flow, step, transform and durability durations at zero; it preserves wall timestamps and does not alter control routing. This avoids invalid checkpoint values when the wall clock moves backwards. The regression passes and both binaries were rebuilt.

Production wiring was checked in `apps/daemon/main.ts` (`FlowRunner` construction), `FlowRunner.executeStepLogic`, `GateStepHandler.evaluateGate`, `GateEvaluator.evaluate`, `JudgeEvaluator.evaluate` and `JudgeAgentRunner.run`. The real daemon cases verify terminal halt and judge metadata forwarding to the bound provider. Both pending ledger rows are closed. The voting module forwards its logger to the registered handler; actual voting start, result and consensus events appear on the request trace. The advisory registration warning does not identify a missing runtime event.

The original scenario YAML files are unchanged. The legacy `dogfood_context` request had no keyed strict recording; its new planning fixture lets the existing scenario run in strict mode. The three legacy CLI delegate cases are feature development, refactoring and the dogfood loop.

## Full Team validation

The first full run reported 12,895 passed, two failures and six ignored. Both failures passed in isolation, including Team-mode documentation execution. A second run passed the CLI case but found a wall-clock ordering failure in the writer stability test. A forced backward-clock regression reproduces that false partial-file verdict. Monotonic measurements, precise CLI exit diagnostics and isolated placement of both pressure-sensitive files passed 46 focused tests. The final full suite passes after these fixture repairs. The third full run passed 12,897 tests and failed only the existing foreign skill daemon scenario in the parallel batch. It passed unchanged in isolation. Its daemon/CLI boundary is now isolated with the other process-environment and port-sensitive tests. The final full command uses DENO_JOBS=4 to bound parallel workers and retains every test. DENO_JOBS also triggers the existing deployment-file skip wrapper even in its isolated batch. All six deployment tests therefore ran separately with CI and DENO_JOBS unset and passed with no ignores. The full run has 12,892 passed, zero failed and 12 ignored; the six supplemental passes leave only the six existing baseline ignores uncovered. Initial failure output and isolation output are retained in the archive.

```text
  ✅ model_registry_team_cost_source_test.ts                  2       0       0      24s
  ✅ model_registry_team_edition_sweep_test.ts                2       0       0      12s
  ✅ model_registry_team_cutover_test.ts                      1       0       0      12s
  ✅ daemon_net_policy_enforcement_test.ts                    2       0       0       3s
  ✅ db_cache_schema_upgrade_test.ts                         10       0       0      21s
  ✅ mcp_server_spec_compliance_cutover_test.ts               4       0       0      30s
  ✅ assertions_evidence_test.ts                             29       0       1      17s
  ✅ agent_runner_daemon_cutover_test.ts                     17       0       0    1m13s
  ✅ memory_pipeline_test.ts                                  1       0       0      43s
  ✅ skill_commands_cli_test.ts                               4       0       0      38s
  ✅ self_hosted_split_bindings_test.ts                       3       0       0    1m03s
  ✅ skill_folder_performance_test.ts                         2       0       0      22s
  ✅ binding_evidence_cli_test.ts                             4       0       0    1m17s
  ✅ mcp_handshake_test.ts                                    2       0       0       8s
  ✅ learning_effectiveness_live_test.ts                      0       0       1       --
  ✅ calibration_sandbox_security_test.ts                     7       0       2      10s
  ✅ deploy_workspace_test.ts                                 0       0       6       --
  ✅ build_test.ts                                            1       0       0       7s
  ✅ exactl_edition_build_test.ts                             1       0       0       1s
  ✅ model_registry_route_admit_live_test.ts                  2       0       0      10s
────────────────────────────────────────────────────────────────────────────────────────
  ✅ Containered Batch total                                442       0      12    8m48s
════════════════════════════════════════════════════════════════════════════════════════
  ✅ GRAND TOTAL                                          12892       0      12   19m02s
════════════════════════════════════════════════════════════════════════════════════════

🎉  All batches passed.
```
