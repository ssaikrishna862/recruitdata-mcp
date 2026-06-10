-- Proprietary jobs archive: every job we ever fetch is saved with a timestamp.
-- This compounds daily into a historical hiring dataset no competitor can back-fill.
CREATE TABLE IF NOT EXISTS jobs_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  salary TEXT,
  skills TEXT,
  url TEXT,
  keyword TEXT,
  first_seen TEXT NOT NULL,      -- ISO date we first archived it
  fingerprint TEXT UNIQUE        -- source|title|company to dedupe across days
);
CREATE INDEX IF NOT EXISTS idx_company ON jobs_archive(company);
CREATE INDEX IF NOT EXISTS idx_first_seen ON jobs_archive(first_seen);
CREATE INDEX IF NOT EXISTS idx_keyword ON jobs_archive(keyword);
