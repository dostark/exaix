/**
 * @module CompatConstants
 * @path tests/compat/harness/compat_constants.ts
 * @description Named limits of the pending-review compatibility harness.
 */

const BYTES_PER_MIB = 1024 * 1024;
const FIXTURE_MAX_MIB = 8;
const LEAK_SCAN_MAX_FILE_MIB = 5;

export const COMPAT_FIXTURE_MAX_BYTES = FIXTURE_MAX_MIB * BYTES_PER_MIB;
export const COMPAT_LEAK_SCAN_MAX_FILE_BYTES = LEAK_SCAN_MAX_FILE_MIB * BYTES_PER_MIB;
