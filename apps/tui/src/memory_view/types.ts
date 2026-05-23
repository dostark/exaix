/**
 * @module MemoryTuiTypes
 * @path apps/tui/src/memory_view/types.ts
 * @description Core types and interfaces for the Memory View TUI components, including ITreeNode and MemoryServiceInterface.
 * @architectural-layer TUI
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/core/src/types/enums.ts"]
 */

import type { TuiNodeType } from "@exaix/tui";
import type { IMemoryService } from "@exaix/core/types";

export type ITreeNodeType = TuiNodeType;

type TreeNodeData = object | string | number | boolean | null;

export interface ITreeNode {
  id: string;
  type: ITreeNodeType;
  label: string;
  expanded: boolean;
  children: ITreeNode[];
  badge?: number;
  data?: TreeNodeData;
}

export type { IMemoryService };
