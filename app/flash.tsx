export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function Flash({ params }: { params: Record<string, string | string[] | undefined> }) {
  const ok = typeof params.ok === "string" ? params.ok : null;
  const error = typeof params.error === "string" ? params.error : null;
  if (!ok && !error) return null;
  return <div className={`notice ${error ? "warn" : ""}`}>{error ?? ok}</div>;
}
