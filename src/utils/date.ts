/**
 * Shared date-formatting utilities used across multiple views.
 */

/**
 * Formats an ISO date string into a Thai locale short date.
 * Returns an em-dash when the value is falsy.
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString)
    return '-';

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };

  return new Date(dateString).toLocaleDateString('th-TH', options);
}
