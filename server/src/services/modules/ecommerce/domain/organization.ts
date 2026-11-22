export const MAX_CATEGORY_DEPTH = 5;

/** Comparison key for names: trimmed, inner whitespace collapsed, lowercased. '' when blank. */
export function nameKey(name: string): string {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export type CategoryNode = { id: number; parentId: number | null; position: number };

const byId = (nodes: CategoryNode[]) => new Map(nodes.map((node) => [node.id, node]));

/** Root = 1. Cycle-safe: stops if a node is revisited. */
export function categoryDepth(nodes: CategoryNode[], id: number): number {
  return categoryPath(nodes, id).length;
}

/** Ids from the root down to `id`. */
export function categoryPath(nodes: CategoryNode[], id: number): number[] {
  const map = byId(nodes);
  const path: number[] = [];
  const seen = new Set<number>();
  let current: CategoryNode | undefined = map.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentId == null ? undefined : map.get(current.parentId);
  }
  return path;
}

const childrenMap = (nodes: CategoryNode[]) => {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentId == null) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  return children;
};

/** `id` plus all its descendants, any depth. */
export function subtreeIds(nodes: CategoryNode[], id: number): number[] {
  const children = childrenMap(nodes);
  const result: number[] = [];
  const seen = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop() as number;
    if (seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    stack.push(...(children.get(current) ?? []));
  }
  return result;
}

/** Number of levels in the subtree rooted at `id`; 1 for a leaf. */
export function subtreeHeight(nodes: CategoryNode[], id: number): number {
  const children = childrenMap(nodes);
  const seen = new Set<number>();
  const walk = (current: number): number => {
    if (seen.has(current)) return 0;
    seen.add(current);
    let deepest = 0;
    for (const child of children.get(current) ?? []) deepest = Math.max(deepest, walk(child));
    return 1 + deepest;
  };
  return walk(id);
}

export function moveError(
  nodes: CategoryNode[],
  id: number,
  newParentId: number | null,
): 'CATEGORY_CYCLE' | 'CATEGORY_TOO_DEEP' | null {
  if (newParentId == null) return null;
  if (subtreeIds(nodes, id).includes(newParentId)) return 'CATEGORY_CYCLE';
  if (categoryDepth(nodes, newParentId) + subtreeHeight(nodes, id) > MAX_CATEGORY_DEPTH) return 'CATEGORY_TOO_DEEP';
  return null;
}
