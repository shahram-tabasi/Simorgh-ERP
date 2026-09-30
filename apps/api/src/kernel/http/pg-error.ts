/** The Postgres error behind a (possibly drizzle-wrapped) error, if any. */
export function pgError(err: unknown): { code?: string; constraint?: string; message?: string } | undefined {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string; message?: string } };
  if (e?.cause?.code) return e.cause;
  if (e?.code) return e as { code?: string; constraint?: string; message?: string };
  return undefined;
}
