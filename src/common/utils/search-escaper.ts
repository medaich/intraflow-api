/**
 * Escapes SQL LIKE special wildcard characters (% and _) and backslashes.
 */
export function escapeLikeString(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
