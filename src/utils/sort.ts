type Sortable = { id?: string | number; createdAt?: string };

const text = (v: unknown) => (v == null ? '' : String(v));

/**
 * Every list in the app shows newest first.
 * Order: createdAt (ledger imports set it to the ledger date), then the record's own date,
 * then id (ledger ids end in the S.No, so later rows sort first).
 */
export function newestFirst<T extends Sortable>(items: T[], dateOf?: (item: T) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const da = dateOf ? text(dateOf(a)) : '';
    const db = dateOf ? text(dateOf(b)) : '';
    return (
      (text(b.createdAt) || db).localeCompare(text(a.createdAt) || da) ||
      db.localeCompare(da) ||
      text(b.id).localeCompare(text(a.id), undefined, { numeric: true })
    );
  });
}
