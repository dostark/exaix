/**
 * @module CorePromptBudgetAllocator
 * @path packages/core/src/context/prompt_budget_allocator.ts
 * @description Compatibility wrapper for the package-owned prompt budget allocator from @exaix/core.
 * @architectural-layer Services
 * @related-files ["packages/core/src/prompt_budget_allocator.ts"]
 */

import {
  type IAllocationHints as ICoreAllocationHints,
  PromptBudgetAllocator as CorePromptBudgetAllocator,
} from "@exaix/core";

export type IAllocationHints = ICoreAllocationHints;
export type PromptBudgetAllocator = InstanceType<typeof CorePromptBudgetAllocator>;

const PromptBudgetAllocator = CorePromptBudgetAllocator;

export { PromptBudgetAllocator };
