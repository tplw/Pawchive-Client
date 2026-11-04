-- Remove tables that belonged to features outside the core browsing and
-- playback scope. Existing creator and progress data is preserved.

DROP TABLE IF EXISTS collection_items;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS favorite_creators;
DROP TABLE IF EXISTS favorite_posts;
DROP TABLE IF EXISTS view_history;
DROP TABLE IF EXISTS playback_history;
DROP TABLE IF EXISTS search_history;
DROP TABLE IF EXISTS downloads;
