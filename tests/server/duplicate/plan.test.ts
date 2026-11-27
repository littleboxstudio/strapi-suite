import { describe, it, expect } from 'vitest';
import { buildPlan } from '../../../server/src/services/modules/duplicate/domain/plan';

const e = (from: string, to: string, path: string) => ({ from, to, path });

describe('buildPlan', () => {
  it('a chain is created from the leaf up, with no fix', () => {
    expect(buildPlan(['A', 'B', 'C'], [e('A', 'B', 'x'), e('B', 'C', 'y')])).toEqual([
      { kind: 'create', key: 'C', deferred: [] },
      { kind: 'create', key: 'B', deferred: [] },
      { kind: 'create', key: 'A', deferred: [] },
    ]);
  });

  it('independent nodes come in key order', () => {
    expect(buildPlan(['b', 'a', 'c'], [])).toEqual([
      { kind: 'create', key: 'a', deferred: [] },
      { kind: 'create', key: 'b', deferred: [] },
      { kind: 'create', key: 'c', deferred: [] },
    ]);
  });

  it('a two-node cycle: one side created without the relation, the other plain, then the fix', () => {
    expect(buildPlan(['A', 'B'], [e('A', 'B', 'friend'), e('B', 'A', 'friend')])).toEqual([
      { kind: 'create', key: 'A', deferred: ['friend'] },
      { kind: 'create', key: 'B', deferred: [] },
      { kind: 'fix', key: 'A', paths: ['friend'] },
    ]);
  });

  it('a self-relation is a cycle of one', () => {
    expect(buildPlan(['A'], [e('A', 'A', 'related')])).toEqual([
      { kind: 'create', key: 'A', deferred: ['related'] },
      { kind: 'fix', key: 'A', paths: ['related'] },
    ]);
  });

  it('defers the side whose closing relation is not required', () => {
    const required = (key: string, path: string) => key === 'A' && path === 'owner';
    expect(buildPlan(['A', 'B'], [e('A', 'B', 'owner'), e('B', 'A', 'link')], required)).toEqual([
      { kind: 'create', key: 'B', deferred: ['link'] },
      { kind: 'create', key: 'A', deferred: [] },
      { kind: 'fix', key: 'B', paths: ['link'] },
    ]);
  });

  it('dependencies outside the cycle come before it; dependants after', () => {
    const plan = buildPlan(
      ['A', 'B', 'D', 'Z'],
      [e('A', 'B', 'r'), e('B', 'A', 'r'), e('A', 'D', 'author'), e('Z', 'A', 'page')]
    );
    expect(plan).toEqual([
      { kind: 'create', key: 'D', deferred: [] },
      { kind: 'create', key: 'A', deferred: ['r'] },
      { kind: 'create', key: 'B', deferred: [] },
      { kind: 'fix', key: 'A', paths: ['r'] },
      { kind: 'create', key: 'Z', deferred: [] },
    ]);
  });

  it('a three-node cycle defers only one edge', () => {
    const plan = buildPlan(['A', 'B', 'C'], [e('A', 'B', 'n'), e('B', 'C', 'n'), e('C', 'A', 'n')]);
    expect(plan).toEqual([
      { kind: 'create', key: 'A', deferred: ['n'] },
      { kind: 'create', key: 'C', deferred: [] },
      { kind: 'create', key: 'B', deferred: [] },
      { kind: 'fix', key: 'A', paths: ['n'] },
    ]);
  });

  it('every created relation points at something already created', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'];
    const edges = [
      e('A', 'B', 'x'),
      e('B', 'C', 'x'),
      e('C', 'A', 'y'),
      e('C', 'D', 'z'),
      e('D', 'E', 'x'),
      e('E', 'D', 'x'),
      e('E', 'E', 'self'),
      e('B', 'A', 'w'),
    ];
    const plan = buildPlan(nodes, edges);
    const created = new Set<string>();
    const deferred = new Map<string, string[]>();
    const fixed = new Set<string>();
    for (const step of plan) {
      if (step.kind === 'create') {
        for (const edge of edges.filter((x) => x.from === step.key)) {
          if (step.deferred.includes(edge.path)) continue;
          expect(created.has(edge.to)).toBe(true);
        }
        created.add(step.key);
        deferred.set(step.key, step.deferred);
      } else {
        for (const edge of edges.filter((x) => x.from === step.key && step.paths.includes(x.path))) {
          expect(created.has(edge.to)).toBe(true);
        }
        fixed.add(`${step.key}:${step.paths.join(',')}`);
      }
    }
    expect([...created].sort()).toEqual(nodes);
    for (const [key, paths] of deferred) {
      if (paths.length) expect(fixed.has(`${key}:${paths.join(',')}`)).toBe(true);
    }
  });

  it('edges to or from unknown keys are ignored', () => {
    expect(buildPlan(['A'], [e('A', 'X', 'r'), e('X', 'A', 'r')])).toEqual([
      { kind: 'create', key: 'A', deferred: [] },
    ]);
  });

  it('is deterministic whatever the input order', () => {
    const edges = [e('A', 'B', 'r'), e('B', 'A', 's'), e('C', 'A', 't'), e('B', 'B', 'u')];
    const one = buildPlan(['A', 'B', 'C'], edges);
    const two = buildPlan(['C', 'B', 'A'], [...edges].reverse());
    expect(two).toEqual(one);
  });

  it('a path with several targets is deferred once', () => {
    expect(
      buildPlan(['A', 'B', 'C'], [e('A', 'B', 'tags'), e('A', 'C', 'tags'), e('B', 'A', 'r'), e('C', 'A', 'r')])
    ).toEqual([
      { kind: 'create', key: 'A', deferred: ['tags'] },
      { kind: 'create', key: 'B', deferred: [] },
      { kind: 'create', key: 'C', deferred: [] },
      { kind: 'fix', key: 'A', paths: ['tags'] },
    ]);
  });
});
