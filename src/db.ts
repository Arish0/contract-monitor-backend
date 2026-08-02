import type { Env } from "./types";

export interface TimeRange {
  fromTs: number | null;
  toTs: number | null;
}

function rangeClause(range: TimeRange, alias = "block_time"): { clause: string; params: number[] } {
  const parts: string[] = [];
  const params: number[] = [];
  if (range.fromTs != null) {
    parts.push(`${alias} >= ?`);
    params.push(range.fromTs);
  }
  if (range.toTs != null) {
    parts.push(`${alias} <= ?`);
    params.push(range.toTs);
  }
  return { clause: parts.length ? parts.join(" AND ") : "1=1", params };
}

export interface AuthRecord {
  email: string;
  password_hash: string;
  password_salt: string;
}

export async function getAuth(env: Env): Promise<AuthRecord | null> {
  return env.DB.prepare(`SELECT email, password_hash, password_salt FROM auth WHERE id = 1`).first<AuthRecord>();
}

export async function insertAuth(env: Env, email: string, passwordHash: string, passwordSalt: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO auth (id, email, password_hash, password_salt) VALUES (1, ?, ?, ?)`)
    .bind(email, passwordHash, passwordSalt)
    .run();
}

export async function updateAuth(env: Env, email: string, passwordHash: string, passwordSalt: string): Promise<void> {
  await env.DB.prepare(`UPDATE auth SET email = ?, password_hash = ?, password_salt = ? WHERE id = 1`)
    .bind(email, passwordHash, passwordSalt)
    .run();
}

export async function logEvent(
  env: Env,
  event: {
    txHash: string | null;
    functionName: string;
    fromAddress: string;
    status: "success" | "reverted" | "failed_premine";
    gasUsed: number | null;
    gasPrice: string | null;
    blockTime: number | null;
    revertReason: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (tx_hash, function_name, from_address, status, gas_used, gas_price, block_time, revert_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event.txHash,
      event.functionName,
      event.fromAddress,
      event.status,
      event.gasUsed,
      event.gasPrice,
      event.blockTime,
      event.revertReason,
    )
    .run();
}

export async function trafficByHour(env: Env, range: TimeRange) {
  const { clause, params } = rangeClause(range);
  const { results } = await env.DB.prepare(
    `SELECT strftime('%Y-%m-%dT%H:00:00Z', block_time, 'unixepoch') AS bucket, COUNT(*) AS tx_count
     FROM events
     WHERE ${clause}
     GROUP BY bucket ORDER BY bucket`,
  )
    .bind(...params)
    .all();
  return results;
}

export async function gasByHour(env: Env, range: TimeRange) {
  const { clause, params } = rangeClause(range);
  const { results } = await env.DB.prepare(
    `SELECT strftime('%Y-%m-%dT%H:00:00Z', block_time, 'unixepoch') AS bucket,
            AVG(gas_used) AS avg_gas_used,
            SUM(gas_used) AS total_gas_used
     FROM events
     WHERE ${clause} AND gas_used IS NOT NULL
     GROUP BY bucket ORDER BY bucket`,
  )
    .bind(...params)
    .all();
  return results;
}

export async function byFunction(env: Env, range: TimeRange) {
  const { clause, params } = rangeClause(range);
  const { results } = await env.DB.prepare(
    `SELECT function_name,
            COUNT(*) AS total_calls,
            SUM(CASE WHEN status = 'reverted' THEN 1 ELSE 0 END) AS reverts,
            SUM(CASE WHEN status = 'failed_premine' THEN 1 ELSE 0 END) AS premine_failures,
            AVG(gas_used) AS avg_gas_used
     FROM events
     WHERE ${clause}
     GROUP BY function_name
     ORDER BY total_calls DESC`,
  )
    .bind(...params)
    .all();
  return results;
}

export async function topWallets(env: Env, range: TimeRange, limit = 20) {
  const { clause, params } = rangeClause(range);
  const { results } = await env.DB.prepare(
    `SELECT from_address, COUNT(*) AS tx_count
     FROM events
     WHERE ${clause}
     GROUP BY from_address
     ORDER BY tx_count DESC
     LIMIT ?`,
  )
    .bind(...params, limit)
    .all();
  return results;
}

export interface NotificationSettings {
  notify_success: boolean;
  notify_revert: boolean;
  notify_failure: boolean;
}

export async function getSettings(env: Env): Promise<NotificationSettings> {
  const row = await env.DB.prepare(
    `SELECT notify_success, notify_revert, notify_failure FROM settings WHERE id = 1`,
  ).first<{ notify_success: number; notify_revert: number; notify_failure: number }>();

  if (!row) return { notify_success: true, notify_revert: true, notify_failure: true };

  return {
    notify_success: row.notify_success === 1,
    notify_revert: row.notify_revert === 1,
    notify_failure: row.notify_failure === 1,
  };
}

export async function updateSettings(env: Env, patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
  const current = await getSettings(env);
  const next: NotificationSettings = { ...current, ...patch };

  await env.DB.prepare(`UPDATE settings SET notify_success = ?, notify_revert = ?, notify_failure = ? WHERE id = 1`)
    .bind(next.notify_success ? 1 : 0, next.notify_revert ? 1 : 0, next.notify_failure ? 1 : 0)
    .run();

  return next;
}

export async function summary(env: Env, range: TimeRange) {
  const { clause, params } = rangeClause(range);
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total_events,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS total_success,
       SUM(CASE WHEN status = 'reverted' THEN 1 ELSE 0 END) AS total_reverted,
       SUM(CASE WHEN status = 'failed_premine' THEN 1 ELSE 0 END) AS total_failed_premine,
       COUNT(DISTINCT from_address) AS unique_wallets,
       AVG(gas_used) AS avg_gas_used
     FROM events
     WHERE ${clause}`,
  )
    .bind(...params)
    .first();

  const earliest = await env.DB.prepare(`SELECT MIN(block_time) AS earliest_event_time FROM events`).first<{
    earliest_event_time: number | null;
  }>();

  return { ...row, earliest_event_time: earliest?.earliest_event_time ?? null };
}

export interface EventRow {
  id: number;
  tx_hash: string | null;
  function_name: string;
  from_address: string;
  status: "success" | "reverted" | "failed_premine";
  gas_used: number | null;
  block_time: number | null;
  revert_reason: string | null;
}

export async function listEvents(env: Env, range: TimeRange, limit: number, offset: number) {
  const { clause, params } = rangeClause(range);
  const { results } = await env.DB.prepare(
    `SELECT id, tx_hash, function_name, from_address, status, gas_used, block_time, revert_reason
     FROM events
     WHERE ${clause}
     ORDER BY block_time DESC, id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<EventRow>();
  return results;
}

export async function countEvents(env: Env, range: TimeRange): Promise<number> {
  const { clause, params } = rangeClause(range);
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM events WHERE ${clause}`)
    .bind(...params)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function heatmap(env: Env, range: TimeRange) {
  const { clause, params } = rangeClause(range);
  const { results } = await env.DB.prepare(
    `SELECT strftime('%w', block_time, 'unixepoch') AS day_of_week,
            strftime('%H', block_time, 'unixepoch') AS hour_of_day,
            COUNT(*) AS tx_count
     FROM events
     WHERE ${clause} AND block_time IS NOT NULL
     GROUP BY day_of_week, hour_of_day`,
  )
    .bind(...params)
    .all();
  return results;
}
