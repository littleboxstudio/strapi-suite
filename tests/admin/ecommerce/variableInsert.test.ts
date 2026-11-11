import { describe, it, expect } from 'vitest';
import {
  insertAtCursor,
  listExample,
  variableTag,
} from '../../../admin/src/ecommerce/utils/emailTemplateEditor';

describe('insertAtCursor', () => {
  it('inserts the snippet at the cursor and moves the cursor after it', () => {
    expect(insertAtCursor('Hello !', 6, '{{customer.firstName}}')).toEqual({
      text: 'Hello {{customer.firstName}}!',
      cursor: 28,
    });
  });

  it('inserts at the start and at the end', () => {
    expect(insertAtCursor('abc', 0, 'X')).toEqual({ text: 'Xabc', cursor: 1 });
    expect(insertAtCursor('abc', 3, 'X')).toEqual({ text: 'abcX', cursor: 4 });
  });

  it('inserts into empty text', () => {
    expect(insertAtCursor('', 0, '{{a}}')).toEqual({ text: '{{a}}', cursor: 5 });
  });

  it('clamps a cursor outside the text', () => {
    expect(insertAtCursor('abc', 99, 'X')).toEqual({ text: 'abcX', cursor: 4 });
    expect(insertAtCursor('abc', -5, 'X')).toEqual({ text: 'Xabc', cursor: 1 });
  });

  it('appends when the cursor is unknown (NaN)', () => {
    expect(insertAtCursor('abc', Number.NaN, 'X')).toEqual({ text: 'abcX', cursor: 4 });
  });
});

describe('variableTag', () => {
  it('wraps the path in double braces', () => {
    expect(variableTag('order.reference')).toBe('{{order.reference}}');
  });
});

describe('listExample', () => {
  it('shows an each block with every item field', () => {
    expect(
      listExample({
        path: 'shipment.items',
        description: 'Items',
        kind: 'list',
        itemFields: ['name', 'quantity'],
      })
    ).toBe('{{#each shipment.items}}\n  {{this.name}} {{this.quantity}}\n{{/each}}');
  });

  it('uses {{this}} when the list has no item fields', () => {
    expect(listExample({ path: 'tags', description: 'Tags', kind: 'list' })).toBe(
      '{{#each tags}}\n  {{this}}\n{{/each}}'
    );
  });
});
