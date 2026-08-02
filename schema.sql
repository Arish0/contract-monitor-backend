CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash TEXT,
  function_name TEXT NOT NULL,
  from_address TEXT NOT NULL,
  status TEXT NOT NULL,        -- 'success' | 'reverted' | 'failed_premine'
  gas_used INTEGER,
  gas_price TEXT,              -- wei, stored as text to avoid precision loss
  block_time INTEGER,          -- unix timestamp (seconds)
  revert_reason TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_block_time ON events(block_time);
CREATE INDEX IF NOT EXISTS idx_events_function ON events(function_name);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_from ON events(from_address);

CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  notify_success INTEGER NOT NULL DEFAULT 1,
  notify_revert INTEGER NOT NULL DEFAULT 1,
  notify_failure INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO settings (id, notify_success, notify_revert, notify_failure) VALUES (1, 1, 1, 1);
