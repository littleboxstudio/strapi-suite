import type { CategoryTreeNode } from '../organizationTypes';

export type FlatCategory = {
  node: CategoryTreeNode;
  depth: number;
  /** Place among its siblings (0 = first). */
  index: number;
  siblingCount: number;
};

/** Every category, depth-first in tree order, with its depth (roots: 0). */
export function flattenTree(roots: CategoryTreeNode[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (nodes: CategoryTreeNode[], depth: number) => {
    nodes.forEach((node, index) => {
      out.push({ node, depth, index, siblingCount: nodes.length });
      walk(node.children ?? [], depth + 1);
    });
  };
  walk(roots, 0);
  return out;
}

/** The chain from a root down to `id` (empty when not found). */
function chainTo(roots: CategoryTreeNode[], id: number): CategoryTreeNode[] {
  for (const node of roots) {
    if (node.id === id) return [node];
    const below = chainTo(node.children ?? [], id);
    if (below.length) return [node, ...below];
  }
  return [];
}

/** "Clothing > Shirts > Linen"; empty for an unknown id. */
export function pathLabel(roots: CategoryTreeNode[], id: number): string {
  return chainTo(roots, id)
    .map((n) => n.name)
    .join(' > ');
}

/** Ids of every category below `id`, at any depth (not `id` itself). */
export function descendantIds(roots: CategoryTreeNode[], id: number): number[] {
  const self = chainTo(roots, id).pop();
  return self ? flattenTree(self.children ?? []).map((r) => r.node.id) : [];
}

/**
 * The categories a category may be moved under, labelled with their full path, in tree order:
 * all of them except `excludeId` and its descendants (which would make a cycle).
 */
export function parentOptions(roots: CategoryTreeNode[], excludeId?: number): { id: number; label: string }[] {
  const excluded = new Set(excludeId === undefined ? [] : [excludeId, ...descendantIds(roots, excludeId)]);
  const out: { id: number; label: string }[] = [];
  const walk = (nodes: CategoryTreeNode[], prefix: string) => {
    for (const node of nodes) {
      if (excluded.has(node.id)) continue;
      const label = prefix ? `${prefix} > ${node.name}` : node.name;
      out.push({ id: node.id, label });
      walk(node.children ?? [], label);
    }
  };
  walk(roots, '');
  return out;
}
