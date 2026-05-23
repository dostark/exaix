/**
 * @module TuiTestHelpers
 * @path packages/tui/tests/helpers.ts
 * @description Test utilities for @exaix/tui helpers tests.
 * @architectural-layer TUI
 * @related-files []
 */
import type { ITreeNode } from "@exaix/tui/helpers/tree_view.ts";

export function createTestTree(): ITreeNode[] {
  return [
    {
      id: "root1",
      label: "Root 1",
      type: "root",
      expanded: true,
      children: [
        {
          id: "child1-1",
          label: "Child 1.1",
          type: "item",
          expanded: false,
          children: [],
        },
        {
          id: "child1-2",
          label: "Child 1.2",
          type: "item",
          expanded: true,
          children: [
            {
              id: "grandchild1-2-1",
              label: "Grandchild 1.2.1",
              type: "leaf",
              expanded: false,
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "root2",
      label: "Root 2",
      type: "root",
      expanded: false,
      children: [
        {
          id: "child2-1",
          label: "Child 2.1",
          type: "item",
          expanded: false,
          children: [],
        },
      ],
    },
  ];
}

export function createMockDialogRenderOptions(
  width: number = 60,
  height: number = 20,
): {
  useColors: boolean;
  width: number;
  height: number;
} {
  return { useColors: false, width, height };
}
