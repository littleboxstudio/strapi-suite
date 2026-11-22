import { describe, expect, it } from 'vitest';
import {
  categoryDepth,
  categoryPath,
  MAX_CATEGORY_DEPTH,
  moveError,
  nameKey,
  subtreeHeight,
  subtreeIds,
  type CategoryNode,
} from '../../../../server/src/services/modules/ecommerce/domain/organization';

const n = (id: number, parentId: number | null, position = 0): CategoryNode => ({ id, parentId, position });

// 1 > 2 > 3 > 4 (depth 4 chain); 10 > 11 (height 2); 20 root leaf
const nodes: CategoryNode[] = [n(1, null), n(2, 1), n(3, 2), n(4, 3), n(10, null), n(11, 10), n(20, null)];

describe('nameKey', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(nameKey('  Linen   Shirt ')).toBe('linen shirt');
    expect(nameKey('SHIRT')).toBe(nameKey('shirt'));
  });
  it('is empty for blank names', () => {
    expect(nameKey('   ')).toBe('');
    expect(nameKey('')).toBe('');
  });
});

describe('category tree', () => {
  it('max depth is 5', () => expect(MAX_CATEGORY_DEPTH).toBe(5));
  it('depth of a 3-level chain is 3', () => {
    expect(categoryDepth(nodes, 1)).toBe(1);
    expect(categoryDepth(nodes, 3)).toBe(3);
  });
  it('subtreeIds includes a depth-4 grandchild', () => {
    expect(subtreeIds(nodes, 1).sort()).toEqual([1, 2, 3, 4]);
    expect(subtreeIds(nodes, 4)).toEqual([4]);
  });
  it('subtreeHeight is 1 for a leaf', () => {
    expect(subtreeHeight(nodes, 20)).toBe(1);
    expect(subtreeHeight(nodes, 10)).toBe(2);
    expect(subtreeHeight(nodes, 1)).toBe(4);
  });
  it('categoryPath is root to leaf', () => expect(categoryPath(nodes, 4)).toEqual([1, 2, 3, 4]));

  it('moving under own descendant is a cycle', () => {
    expect(moveError(nodes, 1, 3)).toBe('CATEGORY_CYCLE');
    expect(moveError(nodes, 1, 1)).toBe('CATEGORY_CYCLE');
  });
  it('moving a height-2 subtree under a depth-4 node is too deep', () => {
    expect(moveError(nodes, 10, 4)).toBe('CATEGORY_TOO_DEEP');
  });
  it('moving it under a depth-3 node is fine', () => {
    expect(moveError(nodes, 10, 3)).toBeNull();
  });
  it('moving to root is fine', () => expect(moveError(nodes, 3, null)).toBeNull());
});
