CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  user_login TEXT NOT NULL,
  memo TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (repo_full_name, issue_number, user_login)
);

CREATE TABLE IF NOT EXISTS processed_deliveries (
  delivery_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
