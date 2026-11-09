use super::{map_playlist, map_playlist_item, Db};
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{now_ts, Playlist, PlaylistItem};
use rusqlite::{params, OptionalExtension};

impl Db {
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
}
