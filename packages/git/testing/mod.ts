/**
 * @module GitTestingPackage
 * @path packages/git/testing/mod.ts
 * @description Public test-support surface for git package helpers shared across workspace tests.
 */

export { TEST_DEFAULT_BRANCH } from "./helpers/constants.ts";
export { createMockConfig } from "./helpers/config.ts";
export { initTestDbService } from "./helpers/db.ts";
export type { IGitTestContext } from "./helpers/git_test_helper.ts";
export { createGitTestContext, GitTestHelper, setupGitRepo } from "./helpers/git_test_helper.ts";
export type { IPortalGitRepoSetup } from "./helpers/portal_test_utils.ts";
export { setupPortalGitRepos } from "./helpers/portal_test_utils.ts";
