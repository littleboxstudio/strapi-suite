import { describe, it, expect } from 'vitest';
import {
  listExample,
  shouldBlockNavigation,
  variableTag,
} from '../../../admin/src/ecommerce/utils/emailTemplateEditor';

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

describe('shouldBlockNavigation', () => {
  const at = (pathname: string, search = '') => ({ pathname, search });
  it('blocks leaving the editor while there are unsaved changes', () => {
    expect(
      shouldBlockNavigation(true, at('/s/email-templates/X/en'), at('/s/email-templates'))
    ).toBe(true);
    expect(
      shouldBlockNavigation(true, at('/s/email-templates/X/en'), at('/s/email-templates/X/pt'))
    ).toBe(true);
    expect(shouldBlockNavigation(true, at('/s/a'), at('/s/a', '?x=1'))).toBe(true);
  });
  it('never blocks when clean or when staying on the same location', () => {
    expect(shouldBlockNavigation(false, at('/s/a'), at('/s/b'))).toBe(false);
    expect(shouldBlockNavigation(true, at('/s/a', '?q'), at('/s/a', '?q'))).toBe(false);
  });
});
