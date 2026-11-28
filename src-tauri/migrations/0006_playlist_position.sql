-- Playlist items had no explicit order beyond their insertion time. Add a
-- stable position so users can rearrange a playlist without changing when an
-- item was added.
ALTER TABLE playlist_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Preserve the existing added_at order for libraries created before this
-- migration.
UPDATE playlist_items
SET position = (
    SELECT COUNT(*)
    FROM playlist_items p2
    WHERE p2.playlist_id = playlist_items.playlist_id
      AND (
          p2.added_at < playlist_items.added_at
          OR (p2.added_at = playlist_items.added_at AND p2.id < playlist_items.id)
      )
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_position
    ON playlist_items(playlist_id, position);
