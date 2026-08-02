import type { TimeRange } from "./db";

const DAYS_BY_PRESET: Record<string, number> = { week: 7, month: 30, year: 365 };

/** Parses the `?range=` (and `from`/`to` for custom) query params into a concrete unix-second window. */
export function resolveRange(url: URL): TimeRange {
  const range = url.searchParams.get("range") ?? "week";
  const now = Math.floor(Date.now() / 1000);

  if (range === "custom") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    return { fromTs: from ? Number(from) : null, toTs: to ? Number(to) : now };
  }

  if (range === "today") {
    const startOfDay = Math.floor(now / 86400) * 86400;
    return { fromTs: startOfDay, toTs: now };
  }

  const days = DAYS_BY_PRESET[range] ?? 7;
  return { fromTs: now - days * 86400, toTs: now };
}
