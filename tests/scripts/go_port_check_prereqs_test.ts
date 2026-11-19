/**
 * @module GoPortCheckPrereqsTest
 * @path tests/scripts/go_port_check_prereqs_test.ts
 * @description Validates the Phase 245 owner-prerequisite record, its budgets, branches and protection shape.
 * @architectural-layer Test
 * @dependencies [@std/assert, zod]
 * @related-files [scripts/go_port/check_prereqs.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  checkBranches,
  type IPrerequisites,
  parsePrerequisites,
  validatePrerequisites,
  validateProtectionShape,
} from "../../scripts/go_port/check_prereqs.ts";

interface IRecordOverrides {
  readonly owner?: string;
  readonly reviewers?: IPrerequisites["reviewers"];
  readonly budget?: IPrerequisites["budget"];
  readonly d24_rule?: string;
  readonly w0a_budget?: IPrerequisites["w0a_budget"];
  readonly repositories?: IPrerequisites["repositories"];
  readonly protection?: IPrerequisites["protection"];
  readonly ci_approval?: IPrerequisites["ci_approval"];
}

function record(overrides: IRecordOverrides = {}): IPrerequisites {
  return {
    owner: "dostark",
    reviewers: { capacity: "owner + agent judge", names: ["dostark"] },
    budget: { hours: 160, spend_usd: 100 },
    d24_rule: "both",
    w0a_budget: { weeks: 1 },
    repositories: {
      exaix_go: "https://github.com/dostark/exaix-go",
      go_port: { parent: "1d6c0dea7", team: "bfb945d8f" },
    },
    protection: {
      parent: { attestation: "attested", evidence: "gh api read on 2026-11-19" },
      team: {
        attestation: "owner-exception",
        reason: "private free repository; branch protection is unavailable",
        approved_by: "dostark",
        date: "2026-11-19",
      },
    },
    ci_approval: {
      approved: true,
      approver: "dostark",
      date: "2026-11-19",
      evidence: "user selected Phase 245 and directed next-steps",
    },
    ...overrides,
  };
}

function valid(overrides: IRecordOverrides = {}): IPrerequisites {
  return parsePrerequisites(record(overrides));
}

Deno.test("go-port-prereqs-schema: missing or empty required fields fail", () => {
  assertThrows(() => parsePrerequisites(record({ owner: "" })), Error, "owner");
  assertThrows(() => parsePrerequisites(record({ reviewers: { capacity: "", names: [] } })), Error);
  assertThrows(() => parsePrerequisites({ ...record(), repositories: { exaix_go: "x" } }), Error);
});

Deno.test("go-port-prereqs-budget: hours, spend and the both-metric rule are required", () => {
  const zeroHours = validatePrerequisites(valid({ budget: { hours: 0, spend_usd: 100 } }));
  assertEquals(zeroHours.some((error) => error.includes("budget.hours")), true);
  const badRule = validatePrerequisites(valid({ d24_rule: "spend-only" }));
  assertEquals(badRule.some((error) => error.includes("d24_rule")), true);
  const zeroSpend = validatePrerequisites(valid({ budget: { hours: 160, spend_usd: 0 } }));
  assertEquals(zeroSpend.some((error) => error.includes("budget.spend_usd")), true);
});

Deno.test("go-port-prereqs-branches: both go-port refs must exist", () => {
  const both = valid();
  const roots = { parent: "/parent", team: "/team" };
  assertEquals(checkBranches(both, (cwd) => cwd === "/parent" || cwd === "/team", roots), []);
  const missing = checkBranches(both, (cwd) => cwd === "/parent", roots);
  assertEquals(missing.some((error) => error.includes("/team")), true);
});

Deno.test("go-port-prereqs-protection: parent attestation and the team exception are required", () => {
  const pending = validatePrerequisites(
    valid({
      protection: {
        parent: { attestation: "pending-owner", evidence: "" },
        team: {
          attestation: "owner-exception",
          reason: "private free repository; branch protection is unavailable",
          approved_by: "dostark",
          date: "2026-11-19",
        },
      },
    }),
  );
  assertEquals(pending.some((error) => error.includes("protection.parent")), true);
  const missingTeamApproval = validatePrerequisites(
    valid({
      protection: {
        parent: { attestation: "attested", evidence: "x" },
        team: { attestation: "owner-exception", reason: "x", approved_by: "", date: "2026-11-19" },
      },
    }),
  );
  assertEquals(missingTeamApproval.some((error) => error.includes("protection.team")), true);
  assertEquals(validatePrerequisites(valid()), []);
});

Deno.test("go-port-prereqs-protection-shape: live protection needs reviews and linear history", () => {
  assertEquals(
    validateProtectionShape({
      required_pull_request_reviews: { required_approving_review_count: 0 },
      required_linear_history: { enabled: true },
    }),
    [],
  );
  const missingLinear = validateProtectionShape({
    required_pull_request_reviews: { required_approving_review_count: 0 },
  });
  assertEquals(missingLinear.some((error) => error.includes("required_linear_history")), true);
  const disabledLinear = validateProtectionShape({
    required_pull_request_reviews: { required_approving_review_count: 0 },
    required_linear_history: { enabled: false },
  });
  assertEquals(disabledLinear.some((error) => error.includes("required_linear_history")), true);
});
