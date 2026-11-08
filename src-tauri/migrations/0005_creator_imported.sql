-- Creators are indexed before their posts are imported. Track whether the
-- archive has ever imported a creator so the UI can avoid presenting an empty
-- profile as if it were fully archived.
--
-- Existing rows default to imported so an upgrade never shows warnings for
-- creators that were already synced.
ALTER TABLE creators ADD COLUMN ever_imported INTEGER NOT NULL DEFAULT 1;
