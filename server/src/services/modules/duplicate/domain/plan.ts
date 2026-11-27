/**
 * The order of a duplication run: every document after the documents it relates to, so a relation
 * always points at a target-locale version that already exists. A dependency cycle is broken by
 * creating one member without the relations that close the cycle and setting them afterwards.
 */

export type NodeKey = string; // `${uid}#${documentId}`

export type PlanStep =
  | { kind: 'create'; key: NodeKey; deferred: string[] } // relation paths to leave empty for now
  | { kind: 'fix'; key: NodeKey; paths: string[] }; // set the deferred relations

export type PlanEdge = { from: NodeKey; to: NodeKey; path: string };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const nodeKey = (uid: string, documentId: string): NodeKey => `${uid}#${documentId}`;

/** Strongly connected components, dependencies first (Tarjan emits a component after all it reaches). */
function components(nodes: NodeKey[], adjacency: Map<NodeKey, PlanEdge[]>): NodeKey[][] {
  const index = new Map<NodeKey, number>();
  const low = new Map<NodeKey, number>();
  const onStack = new Set<NodeKey>();
  const stack: NodeKey[] = [];
  const result: NodeKey[][] = [];
  let counter = 0;

  // Iterative Tarjan: a run may hold thousands of documents in one chain.
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: { node: NodeKey; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1];
      const edges = adjacency.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const to = edges[frame.next].to;
        frame.next += 1;
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter);
          counter += 1;
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const members: NodeKey[] = [];
        let member: NodeKey;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          members.push(member);
        } while (member !== frame.node);
        result.push(members.sort(compare));
      }
    }
  }
  return result;
}

function order(
  nodes: NodeKey[],
  edges: PlanEdge[],
  required: (key: NodeKey, path: string) => boolean,
  deferredOf: Map<NodeKey, string[]>,
  steps: PlanStep[]
): void {
  const adjacency = new Map<NodeKey, PlanEdge[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge);
  }

  for (const members of components(nodes, adjacency)) {
    const single = members.length === 1;
    const inCycle = new Set(members);
    const intra = (key: NodeKey) => (adjacency.get(key) ?? []).filter((edge) => inCycle.has(edge.to));

    if (single && intra(members[0]).length === 0) {
      steps.push({ kind: 'create', key: members[0], deferred: deferredOf.get(members[0]) ?? [] });
      continue;
    }

    // Break the cycle at the member whose closing relations are the least required, then the
    // fewest, then by key.
    const candidates = members.map((key) => {
      const paths = [...new Set(intra(key).map((edge) => edge.path))].sort(compare);
      return { key, paths, required: paths.filter((path) => required(key, path)).length };
    });
    candidates.sort(
      (a, b) => a.required - b.required || a.paths.length - b.paths.length || compare(a.key, b.key)
    );
    const breaker = candidates[0];
    deferredOf.set(breaker.key, breaker.paths);

    const deferredPaths = new Set(breaker.paths);
    const rest = edges.filter(
      (edge) => inCycle.has(edge.from) && inCycle.has(edge.to) && !(edge.from === breaker.key && deferredPaths.has(edge.path))
    );
    order(members, rest, required, deferredOf, steps);
    steps.push({ kind: 'fix', key: breaker.key, paths: breaker.paths });
  }
}

/**
 * Order: dependencies first; cycles broken by deferring the closing edges of one member (the member
 * with the fewest required deferred paths; `required(key, path)` tells if a path is required); a
 * self-relation is a cycle of one. Edges to keys not in `nodes` are ignored (the runner reports
 * them). Deterministic (stable by key).
 */
export function buildPlan(
  nodes: NodeKey[],
  edges: PlanEdge[],
  required: (key: NodeKey, path: string) => boolean = () => false
): PlanStep[] {
  const keys = [...new Set(nodes)].sort(compare);
  const known = new Set(keys);
  const seen = new Set<string>();
  const kept = edges
    .filter((edge) => known.has(edge.from) && known.has(edge.to))
    .filter((edge) => {
      const id = `${edge.from}\u0000${edge.to}\u0000${edge.path}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.path, b.path));

  const steps: PlanStep[] = [];
  order(keys, kept, required, new Map(), steps);
  return steps;
}
