/**
 * Shared number-formatting utilities.
 */

const moneyFormatter = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats a numeric value as Thai-locale money with two decimals. */
export function formatMoney(value: number | null | undefined): string {
  const numeric = Number(value);
  return moneyFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

const quantityFormatter = new Intl.NumberFormat('th-TH');

/** Formats a numeric quantity with Thai-locale grouping. */
export function formatQuantity(value: number | null | undefined): string {
  const numeric = Number(value);
  return quantityFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}
