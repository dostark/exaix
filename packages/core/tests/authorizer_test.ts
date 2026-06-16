/**
 * @module AuthorizerTest
 * @path packages/core/tests/authorizer_test.ts
 * @description Unit tests for IAuthorizer and AllowAllAuthorizer (Phase 115 Step 5).
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { AllowAllAuthorizer, type IAuthorizationContext, type IAuthorizer } from "../mod.ts";
import { SoloComposer } from "../src/composer/mod.ts";

describe("AllowAllAuthorizer", () => {
  it("permits every action unconditionally", () => {
    const auth: IAuthorizer = new AllowAllAuthorizer();
    const result = auth.authorize("any-action", "any-resource");
    assertEquals(result.allowed, true);
  });

  it("permits with default context (undefined)", () => {
    const auth = new AllowAllAuthorizer();
    const result = auth.authorize("delete", "system/config");
    assertEquals(result.allowed, true);
  });

  it("permits with explicit context", () => {
    const auth = new AllowAllAuthorizer();
    const ctx: IAuthorizationContext = { identity: "admin", attributes: { role: "superuser" } };
    const result = auth.authorize("admin.action", "enterprise.policy", ctx);
    assertEquals(result.allowed, true);
  });

  it("returns a reason string", () => {
    const auth = new AllowAllAuthorizer();
    const result = auth.authorize("x", "y");
    assertEquals(typeof result.reason, "string");
    assertEquals(result.reason!.includes("AllowAllAuthorizer"), true);
  });
});

describe("SoloComposer authorizer integration", () => {
  it("SoloComposer holds a concrete AllowAllAuthorizer", () => {
    const composer = new SoloComposer();
    const result = composer.authorizer.authorize("test", "test");
    assertEquals(result.allowed, true);
  });
});
