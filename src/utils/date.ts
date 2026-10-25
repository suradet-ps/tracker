/**
 * Shared date-formatting utilities used across multiple views.
 */

// Formatters are expensive to construct; reuse one instance for every call.
const thaiDateFormatter = new Intl.DateTimeFormat('th-TH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const bangkokDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Formats an ISO date string into a Thai locale short date.
 * Returns an em-dash when the value is falsy.
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString)
    return '-';

  return thaiDateFormatter.format(new Date(dateString));
}

/**
 * Today in Asia/Bangkok as `YYYY-MM-DD`, using one cached formatter.
 * Used by receiving/overdue and automatic-plan date comparisons.
 */
export function bangkokTodayIso(): string {
  const parts = bangkokDayFormatter.formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value ?? '1970';
  const month = parts.find(part => part.type === 'month')?.value ?? '01';
  const day = parts.find(part => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}
