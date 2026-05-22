/**
 * @module TUITreeViewTest
 * @path tests/tui/utils/tree_view_test.ts
 * @description Verifies the logic for hierarchical data presentation in the TUI,
 * ensuring correct node nesting, expansion states, and interactive navigation.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  collapseAll,
  countVisibleNodes,
  createGroupNode,
  createNode,
  expandAll,
  expandTo,
  findNode,
  findParent,
  flattenTree,
  getFirstNodeId,
  getLastNodeId,
  getNextNodeId,
  getNodeAtIndex,
  getNodeIndex,
  getPrevNodeId,
  type ITreeNode,
  renderTree,
  renderTreeLine,
  toggleNode,
  TREE_ICONS,
} from "@exaix/tui/helpers/tree_view.ts";
import { createTestTree } from "../helpers.ts";

// ===== Tree Icons Tests =====

Deno.test("TREE_ICONS: has all required icons", () => {
  assertEquals(TREE_ICONS.expanded, "▼");
  assertEquals(TREE_ICONS.collapsed, "▶");
  assertEquals(TREE_ICONS.leaf, "•");
});

// ===== Create Node Tests =====

Deno.test("createNode: creates basic node", () => {
  const node = createNode("test-id", "Test Label", "item");
  assertEquals(node.id, "test-id");
  assertEquals(node.label, "Test Label");
  assertEquals(node.type, "item");
  assertEquals(node.expanded, false);
  assertEquals(node.children, []);
});

Deno.test("createNode: accepts options", () => {
  const node = createNode("test", "Test", "folder", {
    expanded: true,
    badge: 5,
    icon: "📁",
  });
  assertEquals(node.type, "folder");
  assertEquals(node.expanded, true);
  assertEquals(node.badge, 5);
  assertEquals(node.icon, "📁");
});

Deno.test("createGroupNode: creates node with children", () => {
  const children = [
    createNode("child1", "Child 1", "item"),
    createNode("child2", "Child 2", "item"),
  ];
  const group = createGroupNode("group", "Group", "group", children);
  assertEquals(group.id, "group");
  assertEquals(group.type, "group");
  assertEquals(group.children.length, 2);
  assertEquals(group.expanded, true); // Default expanded
});

// ===== Flatten Tree Tests =====

Deno.test("flattenTree: flattens simple tree", () => {
  const tree = createTestTree();
  const flat = flattenTree(tree);

  // Should have: root1, child1-1, child1-2, grandchild1-2-1, root2
  // (root2's child is not visible because root2 is collapsed)
  assertEquals(flat.length, 5);
  assertEquals(flat[0].node.id, "root1");
  assertEquals(flat[0].depth, 0);
});

Deno.test("flattenTree: includes depth information", () => {
  const tree = createTestTree();
  const flat = flattenTree(tree);

  assertEquals(flat[0].depth, 0); // root1
  assertEquals(flat[1].depth, 1); // child1-1
  assertEquals(flat[3].depth, 2); // grandchild1-2-1
});

Deno.test("flattenTree: tracks isLast correctly", () => {
  const tree = createTestTree();
  const flat = flattenTree(tree);

  // root2 should be last at depth 0
  const root2 = flat.find((f: { node: { id: string } }) => f.node.id === "root2");
  assertExists(root2);
  assertEquals(root2.isLast, true);
});

Deno.test("flattenTree: respects expanded state", () => {
  const tree: ITreeNode[] = [
    createGroupNode("parent", "Parent", "group", [
      createNode("child", "Child", "item"),
    ], { expanded: false }),
  ];

  const flat = flattenTree(tree);
  assertEquals(flat.length, 1); // Only parent, child not visible

  // Expand and re-flatten
  const expanded = toggleNode(tree, "parent");
  const flatExpanded = flattenTree(expanded);
  assertEquals(flatExpanded.length, 2);
});

// ===== Find Node Tests =====

Deno.test("findNode: finds node by id", () => {
  const tree = createTestTree();
  const node = findNode(tree, "child1-2");
  assertExists(node);
  assertEquals(node.label, "Child 1.2");
});

Deno.test("findNode: finds nested node", () => {
  const tree = createTestTree();
  const node = findNode(tree, "grandchild1-2-1");
  assertExists(node);
  assertEquals(node.label, "Grandchild 1.2.1");
});

Deno.test("findNode: returns null for non-existent id", () => {
  const tree = createTestTree();
  const node = findNode(tree, "non-existent");
  assertEquals(node, null);
});

// ===== Find Parent Tests =====

Deno.test("findParent: finds parent of child", () => {
  const tree = createTestTree();
  const parent = findParent(tree, "child1-1");
  assertExists(parent);
  assertEquals(parent.id, "root1");
});

Deno.test("findParent: finds parent of grandchild", () => {
  const tree = createTestTree();
  const parent = findParent(tree, "grandchild1-2-1");
  assertExists(parent);
  assertEquals(parent.id, "child1-2");
});

Deno.test("findParent: returns null for root nodes", () => {
  const tree = createTestTree();
  const parent = findParent(tree, "root1");
  assertEquals(parent, null);
});

// ===== Toggle Node Tests =====

Deno.test("toggleNode: expands collapsed node", () => {
  const tree = createTestTree();
  const toggled = toggleNode(tree, "root2");
  const node = findNode(toggled, "root2");
  assertExists(node);
  assertEquals(node.expanded, true);
});

Deno.test("toggleNode: collapses expanded node", () => {
  const tree = createTestTree();
  const toggled = toggleNode(tree, "root1");
  const node = findNode(toggled, "root1");
  assertExists(node);
  assertEquals(node.expanded, false);
});

Deno.test("toggleNode: does not mutate original tree", () => {
  const tree = createTestTree();
  const originalRoot1Expanded = findNode(tree, "root1")?.expanded;
  toggleNode(tree, "root1");
  assertEquals(findNode(tree, "root1")?.expanded, originalRoot1Expanded);
});

// ===== Expand/Collapse All Tests =====

Deno.test("expandAll: expands all nodes with children", () => {
  const tree = createTestTree();
  const expanded = expandAll(tree);

  const root1 = findNode(expanded, "root1");
  const root2 = findNode(expanded, "root2");
  const child12 = findNode(expanded, "child1-2");

  assertEquals(root1?.expanded, true);
  assertEquals(root2?.expanded, true);
  assertEquals(child12?.expanded, true);
});

Deno.test("collapseAll: collapses all nodes", () => {
  const tree = createTestTree();
  const collapsed = collapseAll(tree);

  const root1 = findNode(collapsed, "root1");
  const root2 = findNode(collapsed, "root2");

  assertEquals(root1?.expanded, false);
  assertEquals(root2?.expanded, false);
});

// ===== Expand To Tests =====

Deno.test("expandTo: expands ancestors of target", () => {
  let tree = createTestTree();
  // First collapse everything
  tree = collapseAll(tree);

  // Now expand to grandchild
  tree = expandTo(tree, "grandchild1-2-1");

  // root1 and child1-2 should be expanded
  assertEquals(findNode(tree, "root1")?.expanded, true);
  assertEquals(findNode(tree, "child1-2")?.expanded, true);
  // root2 should still be collapsed
  assertEquals(findNode(tree, "root2")?.expanded, false);
});

// ===== Count Visible Nodes Tests =====

Deno.test("countVisibleNodes: counts expanded nodes", () => {
  const tree = createTestTree();
  const count = countVisibleNodes(tree);
  assertEquals(count, 5); // root1, child1-1, child1-2, grandchild, root2
});

Deno.test("countVisibleNodes: handles collapsed tree", () => {
  const tree = collapseAll(createTestTree());
  const count = countVisibleNodes(tree);
  assertEquals(count, 2); // Only root1 and root2
});

// ===== Node Index Tests =====

Deno.test("getNodeAtIndex: gets node at valid index", () => {
  const tree = createTestTree();
  const node = getNodeAtIndex(tree, 0);
  assertExists(node);
  assertEquals(node.id, "root1");
});

Deno.test("getNodeAtIndex: returns null for invalid index", () => {
  const tree = createTestTree();
  const node = getNodeAtIndex(tree, 100);
  assertEquals(node, null);
});

Deno.test("getNodeIndex: gets index of node", () => {
  const tree = createTestTree();
  const index = getNodeIndex(tree, "root2");
  assertEquals(index, 4);
});

Deno.test("getNodeIndex: returns -1 for non-existent node", () => {
  const tree = createTestTree();
  const index = getNodeIndex(tree, "non-existent");
  assertEquals(index, -1);
});

// ===== Navigation Tests =====

Deno.test("getNextNodeId: gets next visible node", () => {
  const tree = createTestTree();
  const next = getNextNodeId(tree, "root1");
  assertEquals(next, "child1-1");
});

Deno.test("getNextNodeId: returns null at end", () => {
  const tree = createTestTree();
  const next = getNextNodeId(tree, "root2");
  assertEquals(next, null);
});

Deno.test("getPrevNodeId: gets previous visible node", () => {
  const tree = createTestTree();
  const prev = getPrevNodeId(tree, "child1-1");
  assertEquals(prev, "root1");
});

Deno.test("getPrevNodeId: returns null at start", () => {
  const tree = createTestTree();
  const prev = getPrevNodeId(tree, "root1");
  assertEquals(prev, null);
});

Deno.test("getFirstNodeId: gets first node", () => {
  const tree = createTestTree();
  const first = getFirstNodeId(tree);
  assertEquals(first, "root1");
});

Deno.test("getLastNodeId: gets last visible node", () => {
  const tree = createTestTree();
  const last = getLastNodeId(tree);
  assertEquals(last, "root2");
});

// ===== Render Tests =====

Deno.test("renderTreeLine: renders node with expand indicator", () => {
  const tree = createTestTree();
  const flat = flattenTree(tree);
  const line = renderTreeLine(flat[0], {
    useColors: false,
    showIcons: true,
    showBadges: true,
    indentSize: 2,
    maxWidth: 50,
    selectedId: undefined,
    focusedId: undefined,
  });

  // Should contain expand indicator and label
  assertEquals(line.includes("Root 1"), true);
  assertEquals(line.includes("▼"), true); // expanded
});

Deno.test("renderTree: renders full tree", () => {
  const tree = createTestTree();
  const lines = renderTree(tree, { useColors: false });

  assertEquals(lines.length, 5);
  assertEquals(lines[0].includes("Root 1"), true);
});
