import { describe, expect, it } from 'vitest';
import { calculateOrderQuantity, resolveOrderQuantity } from '@/utils/auto-plan';

describe('calculateOrderQuantity', () => {
  it('rounds the average usage × interval up', () => {
    expect(calculateOrderQuantity(600, 12, 3)).toBe(150);
    expect(calculateOrderQuantity(500, 12, 3)).toBe(125);
    expect(calculateOrderQuantity(1, 12, 3)).toBe(1);
  });

  it('returns 0 when the inputs cannot produce a quantity', () => {
    expect(calculateOrderQuantity(0, 12, 3)).toBe(0);
    expect(calculateOrderQuantity(-1, 12, 3)).toBe(0);
    expect(calculateOrderQuantity(600, 0, 3)).toBe(0);
    expect(calculateOrderQuantity(600, 12, 0)).toBe(0);
    expect(calculateOrderQuantity(Number.NaN, 12, 3)).toBe(0);
  });
});

describe('resolveOrderQuantity', () => {
  const base = {
    usage_quantity: 600,
    usage_months: 12,
    interval_months: 3,
  };

  it('uses the calculated quantity when no override is set', () => {
    expect(resolveOrderQuantity(base)).toBe(150);
    expect(resolveOrderQuantity({ ...base, order_quantity: null })).toBe(150);
  });

  it('uses a positive override', () => {
    expect(resolveOrderQuantity({ ...base, order_quantity: 200 })).toBe(200);
    expect(resolveOrderQuantity({ ...base, order_quantity: 187.5 })).toBe(187.5);
  });

  it('falls back to the calculation for invalid overrides', () => {
    expect(resolveOrderQuantity({ ...base, order_quantity: 0 })).toBe(150);
    expect(resolveOrderQuantity({ ...base, order_quantity: -10 })).toBe(150);
    expect(resolveOrderQuantity({ ...base, order_quantity: Number.NaN })).toBe(150);
  });
});
