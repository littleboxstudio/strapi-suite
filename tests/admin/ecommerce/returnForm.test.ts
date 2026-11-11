import { describe, it, expect } from 'vitest';
import {
  buildReturnInput,
  defaultReturnLines,
  estimatedReturnValue,
  validateReturnForm,
  type ReturnForm,
} from '../../../admin/src/ecommerce/utils/returnForm';

const lines = [
  { id: 1, returnable: 2, unitPrice: 1000, unitDiscount: 100 },
  { id: 2, returnable: 0, unitPrice: 500, unitDiscount: 0 },
  { id: 3, returnable: 1, unitPrice: 2500, unitDiscount: 0 },
];

const form = (overrides: Partial<ReturnForm> = {}): ReturnForm => ({
  lines: [
    { orderLineId: 1, quantity: '1', restock: true },
    { orderLineId: 3, quantity: '0', restock: false },
  ],
  reason: 'Damaged',
  notes: '',
  ...overrides,
});

describe('defaultReturnLines', () => {
  it('lists returnable lines with quantity 0 and restock on', () => {
    expect(defaultReturnLines(lines, 'OPEN')).toEqual([
      { orderLineId: 1, quantity: '0', restock: true },
      { orderLineId: 3, quantity: '0', restock: true },
    ]);
  });

  it('a cancelled order never restocks', () => {
    expect(defaultReturnLines(lines, 'CANCELLED').every((l) => l.restock === false)).toBe(true);
  });
});

describe('validateReturnForm', () => {
  it('accepts a valid return', () => {
    expect(validateReturnForm(form(), lines)).toEqual({});
  });

  it('an empty return is required', () => {
    expect(
      validateReturnForm(
        form({ lines: [{ orderLineId: 1, quantity: '0', restock: true }, { orderLineId: 3, quantity: '', restock: true }] }),
        lines
      )
    ).toEqual({ lines: 'required' });
  });

  it('refuses more than the returnable quantity and non-integers', () => {
    expect(validateReturnForm(form({ lines: [{ orderLineId: 1, quantity: '3', restock: true }] }), lines)).toEqual({
      'lines.1': 'QUANTITY_EXCEEDS_RETURNABLE',
    });
    expect(validateReturnForm(form({ lines: [{ orderLineId: 1, quantity: '-1', restock: true }] }), lines)).toEqual({
      'lines.1': 'invalid_quantity',
    });
  });

  it('requires the reason and limits reason and notes', () => {
    expect(validateReturnForm(form({ reason: ' ' }), lines)).toEqual({ reason: 'required' });
    expect(validateReturnForm(form({ reason: 'x'.repeat(201) }), lines)).toEqual({ reason: 'too_long' });
    expect(validateReturnForm(form({ notes: 'x'.repeat(2001) }), lines)).toEqual({ notes: 'too_long' });
    expect(validateReturnForm(form({ notes: 'x'.repeat(2000) }), lines)).toEqual({});
  });
});

describe('estimatedReturnValue', () => {
  it('sums (unitPrice − unitDiscount) × quantity of valid quantities', () => {
    expect(estimatedReturnValue(form(), lines)).toBe(900);
    expect(
      estimatedReturnValue(
        form({ lines: [{ orderLineId: 1, quantity: '2', restock: true }, { orderLineId: 3, quantity: '1', restock: true }] }),
        lines
      )
    ).toBe(4300);
    expect(estimatedReturnValue(form({ lines: [{ orderLineId: 1, quantity: 'x', restock: true }] }), lines)).toBe(0);
  });
});

describe('buildReturnInput', () => {
  it('sends the lines with a quantity, trimmed reason and optional notes', () => {
    expect(buildReturnInput(form({ reason: ' Damaged ', notes: ' box torn ' }), 'k1')).toEqual({
      lines: [{ orderLineId: 1, quantity: 1, restock: true }],
      reason: 'Damaged',
      notes: 'box torn',
      idempotencyKey: 'k1',
    });
    expect(buildReturnInput(form(), 'k2')).not.toHaveProperty('notes');
  });
});
