/**
 * @module TreeView
 * @path packages/tui/src/helpers/tree_view.ts
 * @description TUI Tree View rendering utilities for hierarchical data.
 * @architectural-layer Helpers
 * @related-files ["packages/tui/src/helpers/keyboard.ts", "packages/tui/src/helpers/colors.ts"]
 */

import { colorize, getTheme, padEnd, visibleLength } from "./colors.ts";
import { TUI_TREE_ICONS } from "./constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

// ===== Tree Node Types =====

export interface ITreeNode<T = unknown> {
  id: string;
  label: string;
  type: string;
  expanded: boolean;
  children: ITreeNode<T>[];
  data?: T;
  badge?: number | string;
  icon?: string;
  selected?: boolean;
  disabled?: boolean;
}

export interface TreeRenderOptions {
  useColors: boolean;
  showIcons: boolean;
  showBadges: boolean;
  indentSize: number;
  maxWidth: number;
  selectedId?: string;
  focusedId?: string;
}

export const defaultTreeOptions: TreeRenderOptions = {
  useColors: true,
  showIcons: true,
  showBadges: true,
  indentSize: 2,
  maxWidth: 50,
  selectedId: undefined,
  focusedId: undefined,
};

// ===== Tree Icons =====

export const TREE_ICONS = {
  expanded: TUI_TREE_ICONS.expanded,
  collapsed: TUI_TREE_ICONS.collapsed,
  leaf: TUI_TREE_ICONS.leaf,
  file: TUI_TREE_ICONS.file,
  folder: TUI_TREE_ICONS.folder,
  folderOpen: TUI_TREE_ICONS.folderOpen,
  root: TUI_TREE_ICONS.root,
  project: TUI_TREE_ICONS.project,
  execution: TUI_TREE_ICONS.execution,
  pattern: TUI_TREE_ICONS.pattern,
  decision: TUI_TREE_ICONS.decision,
  learning: TUI_TREE_ICONS.learning,
  pending: TUI_TREE_ICONS.pending,
  search: TUI_TREE_ICONS.search,
  global: TUI_TREE_ICONS.global,
  agent: TUI_TREE_ICONS.agent,
  portal: TUI_TREE_ICONS.portal,
  daemon: TUI_TREE_ICONS.daemon,
  request: TUI_TREE_ICONS.request,
  log: TUI_TREE_ICONS.log,
} as const;

export type TreeIconType = keyof typeof TREE_ICONS;

// ===== Flat Node (for rendering) =====

export interface IFlatTreeNode<T = unknown> {
  node: ITreeNode<T>;
  depth: number;
  isLast: boolean;
  prefix: string;
  index: number;
}

// ===== Tree Line Characters =====

const TREE_CHARS = {
  vertical: "│",
  horizontal: "─",
  corner: "└",
  tee: "├",
  space: " ",
} as const;

// ===== Tree Utilities =====

/**
 * Flatten tree to array for rendering
 */
export function flattenTree<T>(
  nodes: ITreeNode<T>[],
  depth: Opt<number, Reason.RecursiveOmit> = 0,
  prefix: Opt<string, Reason.RecursiveOmit> = "",
  isParentLast: Opt<boolean, Reason.RecursiveOmit> = true,
): IFlatTreeNode<T>[] {
  const result: IFlatTreeNode<T>[] = [];
  let globalIndex = 0;

  function flatten(
    currentNodes: ITreeNode<T>[],
    currentDepth: number,
    currentPrefix: string,
    _parentIsLast: boolean,
  ): void {
    currentNodes.forEach((node, index) => {
      const isLast = index === currentNodes.length - 1;
      const nodePrefix = currentDepth === 0 ? "" : currentPrefix;

      result.push({
        node,
        depth: currentDepth,
        isLast,
        prefix: nodePrefix,
        index: globalIndex++,
      });

      if (node.expanded && node.children.length > 0) {
        const childPrefix = currentDepth === 0 ? "" : nodePrefix + (isLast ? "  " : TREE_CHARS.vertical + " ");
        flatten(node.children, currentDepth + 1, childPrefix, isLast);
      }
    });
  }

  flatten(nodes, depth, prefix, isParentLast);
  return result;
}

/**
 * Get a node by ID from tree
 */
export function findNode<T>(
  nodes: ITreeNode<T>[],
  id: string,
): ITreeNode<T> | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children.length > 0) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get parent of a node by ID
 */
export function findParent<T>(
  nodes: ITreeNode<T>[],
  id: string,
  parent: ITreeNode<T> | null = null,
): ITreeNode<T> | null {
  for (const node of nodes) {
    if (node.id === id) return parent;
    if (node.children.length > 0) {
      const found = findParent(node.children, id, node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Toggle node expanded state (immutable)
 */
export function toggleNode<T>(nodes: ITreeNode<T>[], id: string): ITreeNode<T>[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, expanded: !node.expanded };
    }
    if (node.children.length > 0) {
      return { ...node, children: toggleNode(node.children, id) };
    }
    return node;
  });
}

/**
 * Expand all nodes (immutable)
 */
export function expandAll<T>(nodes: ITreeNode<T>[]): ITreeNode<T>[] {
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    expanded: node.children.length > 0 ? true : false,
    children: node.children.length > 0 ? expandAll(node.children) : [],
    data: node.data,
    badge: node.badge,
    icon: node.icon,
    selected: node.selected,
    disabled: node.disabled,
  }));
}

/**
 * Collapse all nodes (immutable)
 */
export function collapseAll<T>(nodes: ITreeNode<T>[]): ITreeNode<T>[] {
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    expanded: false,
    children: node.children.length > 0 ? collapseAll(node.children) : [],
    data: node.data,
    badge: node.badge,
    icon: node.icon,
    selected: node.selected,
    disabled: node.disabled,
  }));
}

/**
 * Expand path to node (immutable)
 */
export function expandTo<T>(nodes: ITreeNode<T>[], id: string): ITreeNode<T>[] {
  function findPath(
    nodes: ITreeNode<T>[],
    id: string,
    path: string[] = [],
  ): string[] | null {
    for (const node of nodes) {
      if (node.id === id) return [...path, node.id];
      if (node.children.length > 0) {
        const found = findPath(node.children, id, [...path, node.id]);
        if (found) return found;
      }
    }
    return null;
  }

  const path = findPath(nodes, id);
  if (!path) return nodes;

  function expandPath(nodes: ITreeNode<T>[], path: string[]): ITreeNode<T>[] {
    return nodes.map((node) => {
      const inPath = path.includes(node.id);
      return {
        ...node,
        expanded: inPath ? true : node.expanded,
        children: node.children.length > 0 ? expandPath(node.children, path) : [],
      };
    });
  }

  return expandPath(nodes, path);
}

/**
 * Count visible (expanded) nodes
 */
export function countVisibleNodes<T>(nodes: ITreeNode<T>[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.expanded && node.children.length > 0) {
      count += countVisibleNodes(node.children);
    }
  }
  return count;
}

/**
 * Get node at visible index
 */
export function getNodeAtIndex<T>(
  nodes: ITreeNode<T>[],
  index: number,
): ITreeNode<T> | null {
  const flat = flattenTree(nodes);
  return flat[index]?.node ?? null;
}

/**
 * Get index of node in flattened tree
 */
export function getNodeIndex<T>(nodes: ITreeNode<T>[], id: string): number {
  const flat = flattenTree(nodes);
  return flat.findIndex((f) => f.node.id === id);
}

// ===== Rendering =====

/**
 * Render a tree node line
 */
export function renderTreeLine<T>(
  flat: IFlatTreeNode<T>,
  options: TreeRenderOptions,
): string {
  const theme = getTheme(options.useColors);
  const { node, depth, isLast, prefix } = flat;
  const { showIcons, showBadges, maxWidth, selectedId } = options;

  const parts: string[] = [];

  // Prefix (tree lines)
  if (depth > 0) {
    const connector = isLast ? TREE_CHARS.corner : TREE_CHARS.tee;
    const connectorColored = colorize(
      prefix + connector + TREE_CHARS.horizontal,
      theme.border,
      theme.reset,
    );
    parts.push(connectorColored);
  }

  // Expand/collapse indicator
  if (node.children.length > 0) {
    const expandIcon = node.expanded ? TREE_ICONS.expanded : TREE_ICONS.collapsed;
    const expandColor = node.expanded ? theme.treeExpanded : theme.treeCollapsed;
    parts.push(colorize(expandIcon, expandColor, theme.reset));
  } else if (showIcons && node.icon) {
    parts.push(node.icon);
  } else {
    parts.push(colorize(TREE_ICONS.leaf, theme.treeLeaf, theme.reset));
  }

  // Label
  const isSelected = node.id === selectedId;
  let label = " " + node.label;

  if (isSelected) {
    label = colorize(label, theme.treeSelected, theme.reset);
  } else if (node.disabled) {
    label = colorize(label, theme.textDim, theme.reset);
  }
  parts.push(label);

  // Badge
  if (showBadges && node.badge !== undefined) {
    const badgeStr = typeof node.badge === "number" ? "(" + node.badge + ")" : "[" + node.badge + "]";
    const badgeColored = colorize(badgeStr, theme.textDim, theme.reset);
    parts.push(" " + badgeColored);
  }

  let line = parts.join("");

  // Truncate if too long
  if (visibleLength(line) > maxWidth) {
    const truncated = truncateLine(line, maxWidth - 1);
    line = truncated + colorize("…", theme.textDim, theme.reset);
  }

  return line;
}

/**
 * Truncate a line with ANSI codes to visible length
 */
function truncateLine(line: string, maxLength: number): string {
  let visibleLen = 0;
  let i = 0;

  while (i < line.length && visibleLen < maxLength) {
    if (line[i] === "\x1b" && line[i + 1] === "[") {
      let j = i + 2;
      while (j < line.length && line[j] !== "m") j++;
      i = j + 1;
    } else {
      visibleLen++;
      i++;
    }
  }

  return line.slice(0, i);
}

/**
 * Render entire tree to array of lines
 */
export function renderTree<T>(
  nodes: ITreeNode<T>[],
  options: Partial<TreeRenderOptions> = {},
): string[] {
  const opts = { ...defaultTreeOptions, ...options };
  const flat = flattenTree(nodes);
  return flat.map((f) => renderTreeLine(f, opts));
}

/**
 * Render tree panel with border
 */
export function renderTreePanel<T>(
  nodes: ITreeNode<T>[],
  options: Partial<TreeRenderOptions> & {
    title?: string;
    height?: number;
    scrollOffset?: number;
  } = {},
): string[] {
  const {
    title,
    height = 20,
    scrollOffset = 0,
    ...treeOptions
  } = options;

  const opts = { ...defaultTreeOptions, ...treeOptions };
  const theme = getTheme(opts.useColors);
  const width = opts.maxWidth;

  const lines: string[] = [];

  // Top border with title
  const titleStr = title ? " " + title + " " : "";
  const topBorder = TREE_CHARS.corner + titleStr +
    TREE_CHARS.horizontal.repeat(Math.max(0, width - titleStr.length - 2));
  lines.push(colorize(topBorder, theme.border, theme.reset));

  // Tree content
  const treeLines = renderTree(nodes, opts);
  const visibleLines = treeLines.slice(scrollOffset, scrollOffset + height - 2);

  for (const line of visibleLines) {
    lines.push(padEnd(line, width));
  }

  // Pad remaining height
  const emptyLines = height - 2 - visibleLines.length;
  for (let i = 0; i < emptyLines; i++) {
    lines.push(" ".repeat(width));
  }

  // Bottom border
  const bottomBorder = TREE_CHARS.corner +
    TREE_CHARS.horizontal.repeat(width - 1);
  lines.push(colorize(bottomBorder, theme.border, theme.reset));

  return lines;
}

// ===== Navigation Helpers =====

/**
 * Get next visible node ID
 */
export function getNextNodeId<T>(
  nodes: ITreeNode<T>[],
  currentId: string,
): string | null {
  const flat = flattenTree(nodes);
  const currentIndex = flat.findIndex((f) => f.node.id === currentId);
  if (currentIndex === -1 || currentIndex >= flat.length - 1) return null;
  return flat[currentIndex + 1].node.id;
}

/**
 * Get previous visible node ID
 */
export function getPrevNodeId<T>(
  nodes: ITreeNode<T>[],
  currentId: string,
): string | null {
  const flat = flattenTree(nodes);
  const currentIndex = flat.findIndex((f) => f.node.id === currentId);
  if (currentIndex <= 0) return null;
  return flat[currentIndex - 1].node.id;
}

/**
 * Get first visible node ID
 */
export function getFirstNodeId<T>(nodes: ITreeNode<T>[]): string | null {
  const flat = flattenTree(nodes);
  return flat.length > 0 ? flat[0].node.id : null;
}

/**
 * Get last visible node ID
 */
export function getLastNodeId<T>(nodes: ITreeNode<T>[]): string | null {
  const flat = flattenTree(nodes);
  return flat.length > 0 ? flat[flat.length - 1].node.id : null;
}

// ===== Factory Functions =====

/**
 * Create a tree node
 */
export function createNode<T>(
  id: string,
  label: string,
  type: string,
  options: Partial<ITreeNode<T>> = {},
): ITreeNode<T> {
  return {
    id,
    label,
    type,
    expanded: false,
    children: [],
    ...options,
  };
}

/**
 * Create a group node (with children)
 */
export function createGroupNode<T>(
  id: string,
  label: string,
  type: string,
  children: ITreeNode<T>[],
  options: Partial<ITreeNode<T>> = {},
): ITreeNode<T> {
  return {
    id,
    label,
    type,
    expanded: true,
    children,
    ...options,
  };
}
