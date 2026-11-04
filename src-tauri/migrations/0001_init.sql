-- Pawchive Client schema.
-- Timestamps are Unix seconds unless stated otherwise.

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- The archive exposes its creator directory as one large JSON array. Keeping
-- it locally makes creator search and filtering instant and offline-capable.
CREATE TABLE IF NOT EXISTS creators (
    service   TEXT NOT NULL,
    id        TEXT NOT NULL,
    name      TEXT NOT NULL DEFAULT '',
    public_id TEXT,
    indexed   INTEGER,
    updated   INTEGER,
    favorited INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (service, id)
);
CREATE INDEX IF NOT EXISTS idx_creators_updated   ON creators(updated DESC);
CREATE INDEX IF NOT EXISTS idx_creators_favorited ON creators(favorited DESC);
CREATE INDEX IF NOT EXISTS idx_creators_name      ON creators(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_creators_service   ON creators(service);

CREATE TABLE IF NOT EXISTS playback_progress (
    file_path  TEXT PRIMARY KEY,
    position   REAL NOT NULL DEFAULT 0,
    duration   REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
