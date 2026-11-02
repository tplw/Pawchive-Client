-- Thumbnail metadata lets the Downloads page show a preview and play local files.
ALTER TABLE downloads ADD COLUMN thumbnail_url TEXT;
