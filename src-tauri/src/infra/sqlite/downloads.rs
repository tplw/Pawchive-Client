use super::{map_download, Db};
use crate::shared::error::AppResult;
use crate::shared::models::{now_ts, DownloadRecord};
use rusqlite::{params, OptionalExtension};

impl Db {
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
}
