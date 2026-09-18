CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL DEFAULT 'analyzing',
  -- analyzing | needs_input | pending | live | sold | archived | error
  photos        TEXT NOT NULL,          -- JSON array of R2 keys
  title         TEXT,
  description   TEXT,
  brand         TEXT,
  brand_source  TEXT,                   -- label | inferred | user
  size          TEXT,
  size_source   TEXT,
  category_id   INTEGER,
  category_path TEXT,
  condition     TEXT,
  color         TEXT,
  material      TEXT,
  est_price     REAL,                   -- fair market estimate
  list_price    REAL,                   -- est * (1 + BUMP_PCT)
  floor_price   REAL,                   -- never go below
  current_price REAL,
  comparables   TEXT,                   -- JSON: what the price is based on
  needs         TEXT,                   -- JSON array of fields awaiting you
  note          TEXT,
  vinted_id     TEXT,
  views         INTEGER DEFAULT 0,
  favourites    INTEGER DEFAULT 0,
  last_drop_at  TEXT,
  posted_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status ON items(status);
