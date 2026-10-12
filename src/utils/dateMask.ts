/**
 * Formats typed digits as DD/MM/YYYY, inserting the slashes automatically.
 * A trailing slash is only added while typing forward, so backspacing over it works.
 */
export function maskDateDDMMYYYY(next: string, previous = ''): string {
  const digits = next.replace(/\D/g, '').slice(0, 8);
  const typingForward = next.length > previous.length;

  let out = digits.slice(0, 2);
  if (digits.length > 2) out += '/' + digits.slice(2, 4);
  if (digits.length > 4) out += '/' + digits.slice(4, 8);

  if (typingForward && (digits.length === 2 || digits.length === 4)) out += '/';
  return out;
}

/** Shows stored dates as DD/MM/YYYY (older records were saved as YYYY-MM-DD). */
export function toDisplayDate(value?: string): string {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}

/** True for a complete, real calendar date in DD/MM/YYYY. */
export function isValidDDMMYYYY(value: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) return false;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export function todayDDMMYYYY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
