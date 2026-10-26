/**
 * Shared number-formatting utilities.
 */

const moneyFormatter = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Placeholder shown when a value is missing (null, undefined, or NaN). */
const MISSING_VALUE = '-';

/**
 * Formats a numeric value as Thai-locale money with two decimals.
 * Returns a dash when the value is missing so it is never mistaken for 0.00.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value == null)
    return MISSING_VALUE;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? moneyFormatter.format(numeric) : MISSING_VALUE;
}

const quantityFormatter = new Intl.NumberFormat('th-TH');

/**
 * Formats a numeric quantity with Thai-locale grouping.
 * Returns a dash when the value is missing so it is never mistaken for 0.
 */
export function formatQuantity(value: number | null | undefined): string {
  if (value == null)
    return MISSING_VALUE;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? quantityFormatter.format(numeric) : MISSING_VALUE;
}
