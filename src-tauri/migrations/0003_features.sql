-- Local favorites, playlists and downloads.

CREATE TABLE IF NOT EXISTS favorite_creators (
    service    TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    public_id  TEXT,
    added_at   INTEGER NOT NULL,
    PRIMARY KEY (service, creator_id)
);

CREATE TABLE IF NOT EXISTS playlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id   INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    service       TEXT NOT NULL DEFAULT '',
    creator_id    TEXT NOT NULL DEFAULT '',
    post_id       TEXT NOT NULL DEFAULT '',
    media_path    TEXT NOT NULL,
    media_url     TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    creator_name  TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT,
    media_kind    TEXT NOT NULL DEFAULT '',
    added_at      INTEGER NOT NULL,
    UNIQUE(playlist_id, media_path)
);
CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, added_at);

CREATE TABLE IF NOT EXISTS downloads (
    id               TEXT PRIMARY KEY,
    url              TEXT NOT NULL,
    file_path        TEXT NOT NULL,
    file_name        TEXT NOT NULL,
    media_kind       TEXT NOT NULL DEFAULT '',
    title            TEXT NOT NULL DEFAULT '',
    creator_name     TEXT NOT NULL DEFAULT '',
    service          TEXT NOT NULL DEFAULT '',
    creator_id       TEXT NOT NULL DEFAULT '',
    post_id          TEXT NOT NULL DEFAULT '',
    playlist_id      INTEGER,
    total_bytes      INTEGER,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'queued',
    error            TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at DESC);
