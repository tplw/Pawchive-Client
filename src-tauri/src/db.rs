use crate::error::{AppError, AppResult};
use crate::models::{
    now_ts, AppSettings, CreatorSummary, DownloadRecord, PlaybackProgress, Playlist, PlaylistItem,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use std::path::Path;
use std::sync::Mutex;

const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_core_scope.sql"),
    include_str!("../migrations/0003_features.sql"),
    include_str!("../migrations/0004_download_thumbnails.sql"),
];

/// Preserve the raw corrupt settings row before the app falls back to defaults.
/// Keeping one backup avoids silently destroying user preferences while also
/// preventing unbounded growth from repeated failed startups.
fn backup_corrupt_settings(conn: &Connection, raw: &str) {
    let _ = conn.execute("DELETE FROM settings WHERE key LIKE 'app:corrupt:%'", []);
    let key = format!("app:corrupt:{}", now_ts());
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES(?1, ?2)",
        params![key, raw],
    );
}

/// SQLite persistence layer. A single connection guarded by a mutex is plenty
/// for a desktop app; all calls run on a blocking worker thread.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::configure(&conn)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        Self::configure(&conn)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn configure(conn: &Connection) -> AppResult<()> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )?;
        let _ = conn.execute_batch("PRAGMA journal_mode = WAL;");
        Ok(())
    }

    fn migrate(&self) -> AppResult<()> {
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let version = version.max(0) as usize;
        for (index, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (index + 1) as i64)?;
            tx.commit()?;
            tracing::info!(migration = index + 1, "applied database migration");
        }
        Ok(())
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        f(&conn)
    }

    /* ------------------------------- settings ------------------------------ */

    pub fn load_settings(&self) -> AppResult<AppSettings> {
        self.with_conn(|conn| {
            let raw: Option<String> = conn
                .query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| {
                    r.get(0)
                })
                .optional()?;
            let Some(raw) = raw else {
                return Ok(AppSettings::default());
            };
            let parsed = match serde_json::from_str::<AppSettings>(&raw) {
                Ok(settings) => settings,
                Err(error) => {
                    tracing::warn!(%error, "stored settings were unreadable; using defaults");
                    backup_corrupt_settings(conn, &raw);
                    return Ok(AppSettings::default());
                }
            };
            if parsed.validate().is_err() {
                tracing::warn!("stored settings had invalid values; using defaults");
                backup_corrupt_settings(conn, &raw);
                return Ok(AppSettings::default());
            }
            Ok(parsed)
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> AppResult<()> {
        settings.validate()?;
        let raw = serde_json::to_string(settings)
            .map_err(|e| AppError::Internal(format!("could not serialize settings: {e}")))?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO settings(key, value) VALUES('app', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![raw],
            )?;
            Ok(())
        })
    }

    pub fn get_raw_setting(&self, key: &str) -> AppResult<Option<String>> {
        self.with_conn(|conn| {
            let value = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    params![key],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(value)
        })
    }

    pub fn set_raw_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO settings(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }

    /* ------------------------------- creators ------------------------------ */

    pub fn sync_creators(&self, items: &[CreatorSummary]) -> AppResult<usize> {
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO creators(service, id, name, public_id, indexed, updated, favorited)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(service, id) DO UPDATE SET
                    name = excluded.name,
                    public_id = excluded.public_id,
                    indexed = excluded.indexed,
                    updated = excluded.updated,
                    favorited = excluded.favorited",
            )?;
            for item in items {
                stmt.execute(params![
                    item.service,
                    item.id,
                    item.name,
                    item.public_id,
                    item.indexed,
                    item.updated,
                    item.favorited.unwrap_or(0),
                ])?;
            }
        }
        tx.commit()?;
        Ok(items.len())
    }

    pub fn creator_count(&self) -> AppResult<i64> {
        self.with_conn(
            |conn| Ok(conn.query_row("SELECT COUNT(*) FROM creators", [], |r| r.get(0))?),
        )
    }

    pub fn query_creators(
        &self,
        query: &str,
        service: Option<&str>,
        sort: &str,
        offset: i64,
        limit: i64,
    ) -> AppResult<(Vec<CreatorSummary>, i64)> {
        let mut where_parts: Vec<String> = Vec::new();
        let mut values: Vec<SqlValue> = Vec::new();
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            where_parts.push(
                "(name LIKE ? ESCAPE '\\' OR public_id LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"
                    .to_string(),
            );
            let pattern = format!("%{}%", escape_like(trimmed));
            values.push(SqlValue::Text(pattern.clone()));
            values.push(SqlValue::Text(pattern.clone()));
            values.push(SqlValue::Text(pattern));
        }
        if let Some(service) = service.filter(|s| !s.trim().is_empty()) {
            where_parts.push("service = ?".to_string());
            values.push(SqlValue::Text(service.to_string()));
        }
        let where_sql = if where_parts.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_parts.join(" AND "))
        };
        let order_sql = match sort {
            "name" => "name COLLATE NOCASE ASC",
            "popular" => "favorited DESC, name COLLATE NOCASE ASC",
            "indexed" => "COALESCE(indexed, 0) DESC, name COLLATE NOCASE ASC",
            _ => "COALESCE(updated, 0) DESC, name COLLATE NOCASE ASC",
        };

        self.with_conn(|conn| {
            let total: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM creators {where_sql}"),
                params_from_iter(values.iter()),
                |r| r.get(0),
            )?;

            let mut page_values = values.clone();
            page_values.push(SqlValue::Integer(limit.max(1)));
            page_values.push(SqlValue::Integer(offset.max(0)));
            let mut stmt = conn.prepare(&format!(
                "SELECT service, id, name, public_id, indexed, updated, favorited,
                        EXISTS(SELECT 1 FROM favorite_creators f
                               WHERE f.service = creators.service AND f.creator_id = creators.id)
                 FROM creators {where_sql} ORDER BY {order_sql} LIMIT ? OFFSET ?"
            ))?;
            let rows = stmt
                .query_map(params_from_iter(page_values.iter()), map_creator)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok((rows, total))
        })
    }

    pub fn get_creator(&self, service: &str, id: &str) -> AppResult<Option<CreatorSummary>> {
        self.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT service, id, name, public_id, indexed, updated, favorited,
                            EXISTS(SELECT 1 FROM favorite_creators f
                                   WHERE f.service = creators.service AND f.creator_id = creators.id)
                     FROM creators WHERE service = ?1 AND id = ?2",
                    params![service, id],
                    map_creator,
                )
                .optional()?)
        })
    }

    /* ------------------------------ favorites ------------------------------ */

    pub fn set_favorite_creator(
        &self,
        service: &str,
        creator_id: &str,
        name: &str,
        public_id: Option<&str>,
        favorited: bool,
    ) -> AppResult<()> {
        self.with_conn(|conn| {
            if favorited {
                conn.execute(
                    "INSERT INTO creators(service, id, name, public_id)
                     VALUES(?1, ?2, ?3, ?4)
                     ON CONFLICT(service, id) DO NOTHING",
                    params![service, creator_id, name, public_id],
                )?;
                conn.execute(
                    "INSERT INTO favorite_creators(service, creator_id, name, public_id, added_at)
                     VALUES(?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(service, creator_id) DO UPDATE SET
                        name = excluded.name,
                        public_id = excluded.public_id",
                    params![service, creator_id, name, public_id, now_ts()],
                )?;
            } else {
                conn.execute(
                    "DELETE FROM favorite_creators WHERE service = ?1 AND creator_id = ?2",
                    params![service, creator_id],
                )?;
            }
            Ok(())
        })
    }

    pub fn list_favorite_creators(&self) -> AppResult<Vec<CreatorSummary>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT f.service, f.creator_id, f.name, f.public_id,
                        c.indexed, c.updated, COALESCE(c.favorited, 0), 1
                 FROM favorite_creators f
                 LEFT JOIN creators c ON c.service = f.service AND c.id = f.creator_id
                 ORDER BY f.added_at DESC",
            )?;
            let rows = stmt
                .query_map([], map_creator)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    /* ------------------------------ playlists ------------------------------ */

    pub fn list_playlists(&self) -> AppResult<Vec<Playlist>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                        (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id),
                        (SELECT COALESCE(i.thumbnail_url,
                                  CASE WHEN i.media_kind = 'image' THEN i.media_url END)
                         FROM playlist_items i
                         WHERE i.playlist_id = p.id
                           AND (i.thumbnail_url IS NOT NULL OR i.media_kind = 'image')
                         ORDER BY i.added_at ASC, i.id ASC LIMIT 1)
                 FROM playlists p ORDER BY p.updated_at DESC, p.id DESC",
            )?;
            let rows = stmt
                .query_map([], map_playlist)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn get_playlist(&self, id: i64) -> AppResult<Option<Playlist>> {
        self.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                            (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id),
                            (SELECT COALESCE(i.thumbnail_url,
                                      CASE WHEN i.media_kind = 'image' THEN i.media_url END)
                             FROM playlist_items i
                             WHERE i.playlist_id = p.id
                               AND (i.thumbnail_url IS NOT NULL OR i.media_kind = 'image')
                             ORDER BY i.added_at ASC, i.id ASC LIMIT 1)
                     FROM playlists p WHERE p.id = ?1",
                    params![id],
                    map_playlist,
                )
                .optional()?)
        })
    }

    pub fn create_playlist(&self, name: &str, description: &str) -> AppResult<Playlist> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::Validation(
                "playlist name must be 1-80 characters".into(),
            ));
        }
        let now = now_ts();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO playlists(name, description, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?3)",
                params![name, description.trim(), now],
            )?;
            let id = conn.last_insert_rowid();
            Ok(Playlist {
                id,
                name: name.to_string(),
                description: description.trim().to_string(),
                item_count: 0,
                cover_url: None,
                created_at: now,
                updated_at: now,
            })
        })
    }

    pub fn rename_playlist(&self, id: i64, name: &str, description: &str) -> AppResult<()> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::Validation(
                "playlist name must be 1-80 characters".into(),
            ));
        }
        self.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE playlists SET name = ?2, description = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, name, description.trim(), now_ts()],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound);
            }
            Ok(())
        })
    }

    pub fn delete_playlist(&self, id: i64) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    pub fn list_playlist_items(&self, playlist_id: i64) -> AppResult<Vec<PlaylistItem>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT i.id, i.playlist_id, i.service, i.creator_id, i.post_id, i.media_path,
                        i.media_url, i.title, i.creator_name, i.thumbnail_url, i.media_kind,
                        i.added_at,
                        (SELECT d.file_path FROM downloads d
                         WHERE d.url = i.media_url AND d.status = 'completed'
                         ORDER BY d.created_at DESC LIMIT 1)
                 FROM playlist_items i
                 WHERE i.playlist_id = ?1 ORDER BY i.added_at ASC, i.id ASC",
            )?;
            let rows = stmt
                .query_map(params![playlist_id], map_playlist_item)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn add_playlist_item(
        &self,
        playlist_id: i64,
        item: &PlaylistItem,
    ) -> AppResult<PlaylistItem> {
        self.with_conn(|conn| {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM playlists WHERE id = ?1",
                params![playlist_id],
                |r| r.get(0),
            )?;
            if exists == 0 {
                return Err(AppError::NotFound);
            }
            conn.execute(
                "INSERT INTO playlist_items(playlist_id, service, creator_id, post_id, media_path,
                    media_url, title, creator_name, thumbnail_url, media_kind, added_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(playlist_id, media_path) DO UPDATE SET
                    title = excluded.title,
                    creator_name = excluded.creator_name,
                    thumbnail_url = COALESCE(
                      excluded.thumbnail_url,
                      playlist_items.thumbnail_url
                    ),
                    media_kind = excluded.media_kind",
                params![
                    playlist_id,
                    item.service,
                    item.creator_id,
                    item.post_id,
                    item.media_path,
                    item.media_url,
                    item.title,
                    item.creator_name,
                    item.thumbnail_url,
                    item.media_kind,
                    now_ts()
                ],
            )?;
            conn.execute(
                "UPDATE playlists SET updated_at = ?2 WHERE id = ?1",
                params![playlist_id, now_ts()],
            )?;
            Ok(conn.query_row(
                "SELECT i.id, i.playlist_id, i.service, i.creator_id, i.post_id, i.media_path,
                        i.media_url, i.title, i.creator_name, i.thumbnail_url, i.media_kind,
                        i.added_at,
                        (SELECT d.file_path FROM downloads d
                         WHERE d.url = i.media_url AND d.status = 'completed'
                         ORDER BY d.created_at DESC LIMIT 1)
                 FROM playlist_items i
                 WHERE i.playlist_id = ?1 AND i.media_path = ?2",
                params![playlist_id, item.media_path],
                map_playlist_item,
            )?)
        })
    }

    pub fn set_playlist_item_thumbnail(&self, id: i64, thumbnail_url: &str) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE playlist_items SET thumbnail_url = ?2 WHERE id = ?1",
                params![id, thumbnail_url],
            )?;
            Ok(())
        })
    }

    pub fn remove_playlist_item(&self, id: i64) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM playlist_items WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    /* ------------------------------ downloads ------------------------------ */

    pub fn insert_download(&self, record: &DownloadRecord) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO downloads(id, url, file_path, file_name, media_kind, title,
                    creator_name, service, creator_id, post_id, playlist_id, thumbnail_url,
                    total_bytes, downloaded_bytes, status, error, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    record.id,
                    record.url,
                    record.file_path,
                    record.file_name,
                    record.media_kind,
                    record.title,
                    record.creator_name,
                    record.service,
                    record.creator_id,
                    record.post_id,
                    record.playlist_id,
                    record.thumbnail_url,
                    record.total_bytes,
                    record.downloaded_bytes,
                    record.status,
                    record.error,
                    record.created_at,
                    record.updated_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn update_download(
        &self,
        id: &str,
        downloaded_bytes: i64,
        total_bytes: Option<i64>,
        status: &str,
        error: Option<&str>,
    ) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE downloads SET downloaded_bytes = ?2, total_bytes = ?3,
                    status = ?4, error = ?5, updated_at = ?6 WHERE id = ?1",
                params![id, downloaded_bytes, total_bytes, status, error, now_ts()],
            )?;
            Ok(())
        })
    }

    /// Put a finished/failed download back into the queue, keeping its id and
    /// metadata so the UI can retry it without creating a duplicate record.
    pub fn reset_download(&self, record: &DownloadRecord) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE downloads SET url = ?2, file_path = ?3, file_name = ?4,
                    thumbnail_url = ?5, total_bytes = NULL, downloaded_bytes = 0,
                    status = 'queued', error = NULL, updated_at = ?6 WHERE id = ?1",
                params![
                    record.id,
                    record.url,
                    record.file_path,
                    record.file_name,
                    record.thumbnail_url,
                    now_ts()
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_downloads(&self) -> AppResult<Vec<DownloadRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT d.id, d.url, d.file_path, d.file_name, d.media_kind, d.title,
                        d.creator_name, d.service, d.creator_id, d.post_id, d.playlist_id,
                        COALESCE(d.thumbnail_url,
                          (SELECT i.thumbnail_url FROM playlist_items i
                           WHERE i.media_url = d.url AND i.thumbnail_url IS NOT NULL LIMIT 1)
                        ) AS thumbnail_url,
                        d.total_bytes, d.downloaded_bytes, d.status, d.error, d.created_at, d.updated_at
                 FROM downloads d ORDER BY d.created_at DESC",
            )?;
            let rows = stmt
                .query_map([], map_download)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn get_download(&self, id: &str) -> AppResult<Option<DownloadRecord>> {
        self.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT d.id, d.url, d.file_path, d.file_name, d.media_kind, d.title,
                            d.creator_name, d.service, d.creator_id, d.post_id, d.playlist_id,
                            COALESCE(d.thumbnail_url,
                              (SELECT i.thumbnail_url FROM playlist_items i
                               WHERE i.media_url = d.url AND i.thumbnail_url IS NOT NULL LIMIT 1)
                            ) AS thumbnail_url,
                            d.total_bytes, d.downloaded_bytes, d.status, d.error, d.created_at, d.updated_at
                     FROM downloads d WHERE d.id = ?1",
                    params![id],
                    map_download,
                )
                .optional()?)
        })
    }

    pub fn delete_download(&self, id: &str) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    pub fn clear_completed_downloads(&self) -> AppResult<Vec<DownloadRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT d.id, d.url, d.file_path, d.file_name, d.media_kind, d.title,
                        d.creator_name, d.service, d.creator_id, d.post_id, d.playlist_id,
                        COALESCE(d.thumbnail_url,
                          (SELECT i.thumbnail_url FROM playlist_items i
                           WHERE i.media_url = d.url AND i.thumbnail_url IS NOT NULL LIMIT 1)
                        ) AS thumbnail_url,
                        d.total_bytes, d.downloaded_bytes, d.status, d.error, d.created_at, d.updated_at
                 FROM downloads d WHERE d.status = 'completed'",
            )?;
            let rows = stmt
                .query_map([], map_download)?
                .collect::<Result<Vec<_>, _>>()?;
            conn.execute("DELETE FROM downloads WHERE status = 'completed'", [])?;
            Ok(rows)
        })
    }

    pub fn clear_all_downloads(&self) -> AppResult<Vec<DownloadRecord>> {
        self.with_conn(|conn| {
            let records = {
                let mut stmt = conn.prepare(
                    "SELECT d.id, d.url, d.file_path, d.file_name, d.media_kind, d.title,
                            d.creator_name, d.service, d.creator_id, d.post_id, d.playlist_id,
                            COALESCE(d.thumbnail_url,
                              (SELECT i.thumbnail_url FROM playlist_items i
                               WHERE i.media_url = d.url AND i.thumbnail_url IS NOT NULL LIMIT 1)
                            ) AS thumbnail_url,
                            d.total_bytes, d.downloaded_bytes, d.status, d.error, d.created_at, d.updated_at
                     FROM downloads d",
                )?;
                let mut records = Vec::new();
                let rows = stmt.query_map([], map_download)?;
                for row in rows {
                    records.push(row?);
                }
                records
            };
            conn.execute("DELETE FROM downloads", [])?;
            Ok(records)
        })
    }

    pub fn set_download_thumbnail(&self, id: &str, thumbnail_url: &str) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE downloads SET thumbnail_url = ?2 WHERE id = ?1",
                params![id, thumbnail_url],
            )?;
            Ok(())
        })
    }

    pub fn reset_stale_downloads(&self) -> AppResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE downloads SET status = 'failed', error = 'Interrupted by app restart',
                 updated_at = ?1 WHERE status IN ('queued', 'downloading')",
                params![now_ts()],
            )?;
            Ok(())
        })
    }

    /* ------------------------------ playback ------------------------------- */

    pub fn save_progress(&self, progress: &PlaybackProgress) -> AppResult<()> {
        if !progress.position.is_finite() || progress.position < 0.0 {
            return Err(AppError::Validation("invalid playback position".into()));
        }
        if !progress.duration.is_finite() || progress.duration < 0.0 {
            return Err(AppError::Validation("invalid media duration".into()));
        }
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO playback_progress(file_path, position, duration, updated_at)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(file_path) DO UPDATE SET
                    position = excluded.position,
                    duration = excluded.duration,
                    updated_at = excluded.updated_at",
                params![
                    progress.file_path,
                    progress.position,
                    progress.duration,
                    progress.updated_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_progress(&self, file_path: &str) -> AppResult<Option<PlaybackProgress>> {
        self.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT file_path, position, duration, updated_at
                     FROM playback_progress WHERE file_path = ?1",
                    params![file_path],
                    |row| {
                        Ok(PlaybackProgress {
                            file_path: row.get(0)?,
                            position: row.get(1)?,
                            duration: row.get(2)?,
                            updated_at: row.get(3)?,
                        })
                    },
                )
                .optional()?)
        })
    }

    /// Remove progress rows older than the retention window.
    pub fn prune_progress(&self, older_than_secs: i64) -> AppResult<usize> {
        let cutoff = now_ts() - older_than_secs.max(0);
        self.with_conn(|conn| {
            Ok(conn.execute(
                "DELETE FROM playback_progress WHERE updated_at < ?1",
                params![cutoff],
            )?)
        })
    }
}

fn map_playlist(row: &Row<'_>) -> rusqlite::Result<Playlist> {
    Ok(Playlist {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        item_count: row.get(5)?,
        cover_url: row.get(6)?,
    })
}

fn map_playlist_item(row: &Row<'_>) -> rusqlite::Result<PlaylistItem> {
    Ok(PlaylistItem {
        id: row.get(0)?,
        playlist_id: row.get(1)?,
        service: row.get(2)?,
        creator_id: row.get(3)?,
        post_id: row.get(4)?,
        media_path: row.get(5)?,
        media_url: row.get(6)?,
        title: row.get(7)?,
        creator_name: row.get(8)?,
        thumbnail_url: row.get(9)?,
        media_kind: row.get(10)?,
        added_at: row.get(11)?,
        local_path: row.get(12)?,
    })
}

fn map_download(row: &Row<'_>) -> rusqlite::Result<DownloadRecord> {
    Ok(DownloadRecord {
        id: row.get(0)?,
        url: row.get(1)?,
        file_path: row.get(2)?,
        file_name: row.get(3)?,
        media_kind: row.get(4)?,
        title: row.get(5)?,
        creator_name: row.get(6)?,
        service: row.get(7)?,
        creator_id: row.get(8)?,
        post_id: row.get(9)?,
        playlist_id: row.get(10)?,
        thumbnail_url: row.get(11)?,
        total_bytes: row.get(12)?,
        downloaded_bytes: row.get(13)?,
        status: row.get(14)?,
        error: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn map_creator(row: &Row<'_>) -> rusqlite::Result<CreatorSummary> {
    Ok(CreatorSummary {
        service: row.get(0)?,
        id: row.get(1)?,
        name: row.get(2)?,
        public_id: row.get(3)?,
        indexed: row.get(4)?,
        updated: row.get(5)?,
        favorited: row.get(6)?,
        is_favorite: row.get::<_, i64>(7)? != 0,
    })
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_creator(id: &str, name: &str, updated: i64, favorited: i64) -> CreatorSummary {
        CreatorSummary {
            id: id.into(),
            service: "fanbox".into(),
            name: name.into(),
            public_id: Some(name.into()),
            indexed: Some(updated),
            updated: Some(updated),
            favorited: Some(favorited),
            is_favorite: false,
        }
    }

    #[test]
    fn migrations_and_settings_round_trip() {
        let db = Db::open_in_memory().unwrap();
        let settings = db.load_settings().unwrap();
        assert!(settings.sidebar_visible);
        assert_eq!(settings.volume, 1.0);

        let changed = AppSettings {
            sidebar_visible: false,
            volume: 0.4,
            playback_speed: 1.25,
            download_dir: String::new(),
            ..Default::default()
        };
        db.save_settings(&changed).unwrap();
        let loaded = db.load_settings().unwrap();
        assert!(!loaded.sidebar_visible);
        assert_eq!(loaded.volume, 0.4);
        assert_eq!(loaded.playback_speed, 1.25);
    }

    #[test]
    fn rejects_invalid_settings() {
        let db = Db::open_in_memory().unwrap();
        let too_loud = AppSettings {
            volume: 1.5,
            ..Default::default()
        };
        assert!(db.save_settings(&too_loud).is_err());
        let too_fast = AppSettings {
            volume: 0.5,
            playback_speed: 10.0,
            ..Default::default()
        };
        assert!(db.save_settings(&too_fast).is_err());
    }

    #[test]
    fn creator_queries_paginate_filter_and_sort() {
        let db = Db::open_in_memory().unwrap();
        db.sync_creators(&[
            sample_creator("1", "Alpha", 10, 5),
            sample_creator("2", "Beta", 30, 50),
            sample_creator("3", "Gamma", 20, 10),
        ])
        .unwrap();
        assert_eq!(db.creator_count().unwrap(), 3);

        let (page, total) = db.query_creators("", None, "updated", 0, 2).unwrap();
        assert_eq!(total, 3);
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].id, "2");

        let (popular, _) = db.query_creators("", None, "popular", 0, 3).unwrap();
        assert_eq!(popular[0].id, "2");
        assert_eq!(popular[1].id, "3");

        let (search, _) = db.query_creators("amm", None, "name", 0, 10).unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].name, "Gamma");

        let (service, _) = db
            .query_creators("", Some("patreon"), "name", 0, 10)
            .unwrap();
        assert!(service.is_empty());
    }

    #[test]
    fn creator_sync_updates_existing_rows() {
        let db = Db::open_in_memory().unwrap();
        db.sync_creators(&[sample_creator("1", "Old", 10, 1)])
            .unwrap();
        db.sync_creators(&[sample_creator("1", "New", 20, 2)])
            .unwrap();
        let creator = db.get_creator("fanbox", "1").unwrap().unwrap();
        assert_eq!(creator.name, "New");
        assert_eq!(creator.updated, Some(20));
        assert_eq!(creator.favorited, Some(2));
        assert_eq!(db.creator_count().unwrap(), 1);
    }

    #[test]
    fn playback_progress_round_trip_and_prune() {
        let db = Db::open_in_memory().unwrap();
        let progress = PlaybackProgress {
            file_path: "/aa/bb/clip.mp4".into(),
            position: 42.5,
            duration: 120.0,
            updated_at: now_ts() - 10,
        };
        db.save_progress(&progress).unwrap();
        let loaded = db.get_progress(&progress.file_path).unwrap().unwrap();
        assert_eq!(loaded.position, 42.5);
        assert_eq!(loaded.duration, 120.0);

        db.prune_progress(0).unwrap();
        assert!(db.get_progress(&progress.file_path).unwrap().is_none());
    }

    #[test]
    fn favorites_round_trip_and_creator_queries_reflect_them() {
        let db = Db::open_in_memory().unwrap();
        db.sync_creators(&[sample_creator("1", "Ada", 10, 3)])
            .unwrap();
        assert!(!db.get_creator("fanbox", "1").unwrap().unwrap().is_favorite);
        db.set_favorite_creator("fanbox", "1", "Ada", Some("ada"), true)
            .unwrap();
        assert!(db.get_creator("fanbox", "1").unwrap().unwrap().is_favorite);
        let favorites = db.list_favorite_creators().unwrap();
        assert_eq!(favorites.len(), 1);
        assert!(favorites[0].is_favorite);
        db.set_favorite_creator("fanbox", "1", "Ada", Some("ada"), false)
            .unwrap();
        assert!(db.list_favorite_creators().unwrap().is_empty());
    }

    #[test]
    fn playlists_keep_items_and_metadata() {
        let db = Db::open_in_memory().unwrap();
        let playlist = db.create_playlist("Watch later", "A few clips").unwrap();
        assert_eq!(playlist.item_count, 0);
        let item = PlaylistItem {
            id: 0,
            playlist_id: playlist.id,
            service: "patreon".into(),
            creator_id: "1".into(),
            post_id: "2".into(),
            media_path: "/aa/bb/clip.mp4".into(),
            media_url: "https://file.pawchive.pw/data/aa/bb/clip.mp4".into(),
            title: "Clip".into(),
            creator_name: "Ada".into(),
            thumbnail_url: Some("https://img.pawchive.pw/thumbnail/data/aa/bb/clip.jpg".into()),
            media_kind: "video".into(),
            added_at: 0,
            local_path: None,
        };
        let saved = db.add_playlist_item(playlist.id, &item).unwrap();
        assert!(saved.id > 0);
        assert_eq!(db.list_playlist_items(playlist.id).unwrap().len(), 1);
        db.insert_download(&DownloadRecord {
            id: "offline-download".into(),
            url: item.media_url.clone(),
            file_path: "/tmp/offline-clip.mp4".into(),
            file_name: "clip.mp4".into(),
            media_kind: "video".into(),
            title: "Clip".into(),
            creator_name: "Ada".into(),
            service: "patreon".into(),
            creator_id: "1".into(),
            post_id: "2".into(),
            playlist_id: Some(playlist.id),
            thumbnail_url: None,
            total_bytes: Some(100),
            downloaded_bytes: 100,
            status: "completed".into(),
            error: None,
            created_at: 1,
            updated_at: 1,
        })
        .unwrap();
        let downloaded = db.list_playlist_items(playlist.id).unwrap();
        assert_eq!(
            downloaded[0].local_path.as_deref(),
            Some("/tmp/offline-clip.mp4")
        );
        let list = db.list_playlists().unwrap();
        assert_eq!(list[0].item_count, 1);
        assert!(list[0].cover_url.is_some());
        db.rename_playlist(playlist.id, "Later", "").unwrap();
        assert_eq!(db.get_playlist(playlist.id).unwrap().unwrap().name, "Later");
        db.delete_playlist(playlist.id).unwrap();
        assert!(db.list_playlist_items(playlist.id).unwrap().is_empty());
    }

    #[test]
    fn playlist_cover_uses_first_usable_item_and_falls_back() {
        let db = Db::open_in_memory().unwrap();
        let playlist = db.create_playlist("Cover test", "").unwrap();
        let first_thumbnail = "https://img.pawchive.pw/thumbnail/data/aa/first.jpg";
        let first = PlaylistItem {
            id: 0,
            playlist_id: playlist.id,
            service: "patreon".into(),
            creator_id: "1".into(),
            post_id: "2".into(),
            media_path: "/aa/first.mp4".into(),
            media_url: "https://file.pawchive.pw/data/aa/first.mp4".into(),
            title: "First".into(),
            creator_name: "Ada".into(),
            thumbnail_url: Some(first_thumbnail.into()),
            media_kind: "video".into(),
            added_at: 0,
            local_path: None,
        };
        let saved_first = db.add_playlist_item(playlist.id, &first).unwrap();
        let image = PlaylistItem {
            id: 0,
            playlist_id: playlist.id,
            service: "patreon".into(),
            creator_id: "1".into(),
            post_id: "2".into(),
            media_path: "/bb/second.png".into(),
            media_url: "https://file.pawchive.pw/data/bb/second.png".into(),
            title: "Second".into(),
            creator_name: "Ada".into(),
            thumbnail_url: None,
            media_kind: "image".into(),
            added_at: 1,
            local_path: None,
        };
        let saved_image = db.add_playlist_item(playlist.id, &image).unwrap();

        assert_eq!(
            db.get_playlist(playlist.id)
                .unwrap()
                .unwrap()
                .cover_url
                .as_deref(),
            Some(first_thumbnail)
        );
        let mut re_added = first.clone();
        re_added.thumbnail_url = None;
        db.add_playlist_item(playlist.id, &re_added).unwrap();
        assert_eq!(
            db.get_playlist(playlist.id)
                .unwrap()
                .unwrap()
                .cover_url
                .as_deref(),
            Some(first_thumbnail)
        );
        db.remove_playlist_item(saved_first.id).unwrap();
        assert_eq!(
            db.get_playlist(playlist.id)
                .unwrap()
                .unwrap()
                .cover_url
                .as_deref(),
            Some(image.media_url.as_str())
        );
        db.remove_playlist_item(saved_image.id).unwrap();
        assert!(db
            .get_playlist(playlist.id)
            .unwrap()
            .unwrap()
            .cover_url
            .is_none());
    }

    #[test]
    fn downloads_round_trip_and_clear() {
        let db = Db::open_in_memory().unwrap();
        let record = DownloadRecord {
            id: "dl-1".into(),
            url: "https://file.pawchive.pw/data/aa/bb/clip.mp4".into(),
            file_path: "/tmp/clip.mp4".into(),
            file_name: "clip.mp4".into(),
            media_kind: "video".into(),
            title: "Clip".into(),
            creator_name: "Ada".into(),
            service: "patreon".into(),
            creator_id: "1".into(),
            post_id: "2".into(),
            playlist_id: None,
            thumbnail_url: None,
            total_bytes: Some(100),
            downloaded_bytes: 0,
            status: "queued".into(),
            error: None,
            created_at: 1,
            updated_at: 1,
        };
        db.insert_download(&record).unwrap();
        db.update_download("dl-1", 100, Some(100), "completed", None)
            .unwrap();
        assert_eq!(db.list_downloads().unwrap()[0].downloaded_bytes, 100);
        let cleared = db.clear_completed_downloads().unwrap();
        assert_eq!(cleared.len(), 1);
        assert!(db.list_downloads().unwrap().is_empty());
    }

    #[test]
    fn raw_settings_are_upserted() {
        let db = Db::open_in_memory().unwrap();
        db.set_raw_setting("creators_synced_at", "123").unwrap();
        db.set_raw_setting("creators_synced_at", "456").unwrap();
        let stored: String = db
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT value FROM settings WHERE key = 'creators_synced_at'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(stored, "456");
    }

    #[test]
    fn corrupt_settings_are_backed_up_before_defaults() {
        let db = Db::open_in_memory().unwrap();
        db.set_raw_setting("app", "{not-json").unwrap();
        let settings = db.load_settings().unwrap();
        assert_eq!(settings.media_cache_size_mb, 512);
        let backup: String = db
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT value FROM settings WHERE key LIKE 'app:corrupt:%' LIMIT 1",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(backup, "{not-json");
    }
}
