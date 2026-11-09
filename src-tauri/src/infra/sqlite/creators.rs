use super::{escape_like, map_creator, Db, SqlValue};
use crate::shared::error::AppResult;
use crate::shared::models::{now_ts, CreatorSummary};
use rusqlite::{params, params_from_iter, OptionalExtension};

impl Db {
    pub fn sync_creators(&self, items: &[CreatorSummary]) -> AppResult<usize> {
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO creators(service, id, name, public_id, indexed, updated, favorited, ever_imported)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(service, id) DO UPDATE SET
                    name = excluded.name,
                    public_id = excluded.public_id,
                    indexed = excluded.indexed,
                    updated = excluded.updated,
                    favorited = excluded.favorited,
                    ever_imported = excluded.ever_imported",
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
                    item.ever_imported.unwrap_or(true),
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
                "SELECT service, id, name, public_id, indexed, updated, favorited, ever_imported,
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
                    "SELECT service, id, name, public_id, indexed, updated, favorited, ever_imported,
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
                        c.indexed, c.updated, COALESCE(c.favorited, 0),
                        COALESCE(c.ever_imported, 1), 1
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
}
