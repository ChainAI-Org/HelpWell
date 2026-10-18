/**
 * Turning identifiers into something a person reads.
 *
 * Its own module, with no filesystem and no database, because both the content
 * layer and the repo layer need it: the first when reading a folder that has
 * no _meta.json, the second when reading a row that predates one.
 */

/** `admin-and-billing` -> `Admin and billing`. */
export function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
