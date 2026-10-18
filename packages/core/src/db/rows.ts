/**
 * Normalise a raw `db.execute()` result into plain rows.
 *
 * The two drivers disagree: postgres-js resolves to an array-like of rows,
 * PGlite resolves to `{ rows, fields, affectedRows }`. Everything that runs raw
 * SQL goes through here so no call site has to care which one it is talking to.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

/** The first row, or undefined. */
export function firstRow<T>(result: unknown): T | undefined {
  return rowsOf<T>(result)[0];
}
