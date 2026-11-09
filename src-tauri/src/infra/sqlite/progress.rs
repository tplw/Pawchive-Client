use super::Db;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{now_ts, PlaybackProgress};
use rusqlite::{params, OptionalExtension};

impl Db {
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
