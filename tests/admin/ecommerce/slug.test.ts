import { describe, it, expect } from 'vitest';
import { followNameSlug } from '../../../admin/src/ecommerce/utils/slug';

describe('followNameSlug', () => {
  it('follows the name while the slug is empty or matches the previous name', () => {
    expect(followNameSlug('', '', 'Camisas de Linho')).toBe('camisas-de-linho');
    expect(followNameSlug('Camisas', 'camisas', 'Camisas Ação')).toBe('camisas-acao');
  });

  it('keeps a slug edited by hand', () => {
    expect(followNameSlug('Camisas', 'shirts', 'Camisas de linho')).toBe('shirts');
  });

  it('empties the slug when the name is cleared', () => {
    expect(followNameSlug('Camisas', 'camisas', '')).toBe('');
  });
});
