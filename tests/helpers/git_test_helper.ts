/**
 * @module GitTestHelpers
 * @path tests/helpers/git_test_helper.ts
 * @description Compatibility shim exporting git test helpers through @exaix/git/testing.
 */

export type { IGitTestContext } from "@exaix/git/testing";
export { createGitTestContext, GitTestHelper, setupGitRepo } from "@exaix/git/testing";
