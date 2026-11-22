import { describe, it, expect } from 'vitest';
import {
  descendantIds,
  flattenTree,
  parentOptions,
  pathLabel,
} from '../../../admin/src/ecommerce/utils/categoryTree';
import type { CategoryTreeNode } from '../../../admin/src/ecommerce/organizationTypes';

const node = (id: number, name: string, children: CategoryTreeNode[] = [], parentId: number | null = null) => ({
  id,
  parentId,
  position: 0,
  active: true,
  name,
  slug: name.toLowerCase(),
  productCount: 0,
  children,
});

// Clothing (1) > Shirts (2) > Linen (4); Clothing > Trousers (3); Shoes (5)
const TREE: CategoryTreeNode[] = [
  node(1, 'Clothing', [node(2, 'Shirts', [node(4, 'Linen', [], 2)], 1), node(3, 'Trousers', [], 1)]),
  node(5, 'Shoes'),
];

describe('flattenTree', () => {
  it('lists every category depth-first with its depth and place among its siblings', () => {
    expect(flattenTree(TREE).map((r) => [r.node.id, r.depth, r.index, r.siblingCount])).toEqual([
      [1, 0, 0, 2],
      [2, 1, 0, 2],
      [4, 2, 0, 1],
      [3, 1, 1, 2],
      [5, 0, 1, 2],
    ]);
  });

  it('is empty for an empty tree', () => {
    expect(flattenTree([])).toEqual([]);
  });
});

describe('pathLabel', () => {
  it('joins the ancestors names with " > "', () => {
    expect(pathLabel(TREE, 4)).toBe('Clothing > Shirts > Linen');
    expect(pathLabel(TREE, 5)).toBe('Shoes');
  });

  it('is empty for an unknown id', () => {
    expect(pathLabel(TREE, 99)).toBe('');
  });
});

describe('descendantIds', () => {
  it('lists every category below, at any depth, without the category itself', () => {
    expect(descendantIds(TREE, 1).sort()).toEqual([2, 3, 4]);
    expect(descendantIds(TREE, 2)).toEqual([4]);
    expect(descendantIds(TREE, 5)).toEqual([]);
  });

  it('is empty for an unknown id', () => {
    expect(descendantIds(TREE, 99)).toEqual([]);
  });
});

describe('parentOptions', () => {
  it('offers every category with its full path, in tree order', () => {
    expect(parentOptions(TREE).map((o) => o.label)).toEqual([
      'Clothing',
      'Clothing > Shirts',
      'Clothing > Shirts > Linen',
      'Clothing > Trousers',
      'Shoes',
    ]);
  });

  it('leaves out the category itself and its descendants', () => {
    expect(parentOptions(TREE, 2).map((o) => o.id)).toEqual([1, 3, 5]);
    expect(parentOptions(TREE, 1).map((o) => o.id)).toEqual([5]);
  });
});
