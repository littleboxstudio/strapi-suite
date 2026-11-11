import { describe, it, expect } from 'vitest';
import { formatCents, parseMoneyToCents } from '../../../admin/src/ecommerce/utils/money';

describe('money', () => {
  it('formats cents (non-breaking space before the euro sign)', () => {
    expect(formatCents(2990, 'pt-PT')).toBe('29,90 €');
  });
  it('parses user input to cents', () => {
    expect(parseMoneyToCents('29,90')).toBe(2990);
    expect(parseMoneyToCents('29.9')).toBe(2990);
    expect(parseMoneyToCents('1 299,00')).toBe(129900);
    expect(parseMoneyToCents('1,299.50')).toBe(129950);
    expect(parseMoneyToCents('5')).toBe(500);
  });
  it('rejects invalid input', () => {
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('-1')).toBeNull();
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('1,234')).toBeNull();
  });
});
