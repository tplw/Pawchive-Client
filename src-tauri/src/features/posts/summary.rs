use crate::app::state::AppState;
use crate::shared::config::PAGE_SIZE;
use crate::shared::error::AppResult;
use crate::shared::models::{MediaKind, Post, PostPage, PostSummary};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

pub(crate) fn creator_lookup(st: &AppState, posts: &[Post]) -> HashMap<(String, String), String> {
    let mut map = HashMap::new();
    for post in posts {
        let key = (post.service.clone(), post.user.clone());
        if map.contains_key(&key) {
            continue;
        }
        if let Ok(Some(creator)) = st.db.get_creator(&post.service, &post.user) {
            map.insert(key, creator.name);
        }
    }
    map
}

fn thumbnail_for_file(st: &AppState, file: &crate::shared::models::FileRef) -> Option<String> {
    if crate::shared::models::media_kind_for_file(file) != MediaKind::Image {
        return None;
    }
    if let Some(temp) = file.temp_url() {
        if let Ok(url) = crate::shared::security::validate_media_remote_url(temp) {
            return Some(url.to_string());
        }
    }
    if file.path.starts_with("https://") {
        Some(file.path.clone())
    } else if !file.path.trim().is_empty() {
        Some(st.cfg.thumbnail_url(&file.path))
    } else {
        None
    }
}

pub(crate) fn post_thumbnail(st: &AppState, post: &Post) -> Option<String> {
    post.all_files_including_direct()
        .iter()
        .find_map(|file| thumbnail_for_file(st, file))
}

pub(crate) fn build_post_page(st: &AppState, posts: Vec<Post>, offset: i64) -> AppResult<PostPage> {
    let has_more = posts.len() as i64 >= PAGE_SIZE;
    let names = creator_lookup(st, &posts);
    let settings = st.settings();
    let items = posts
        .iter()
        .filter(|post| {
            !crate::features::posts::filters::is_hidden(
                post,
                names
                    .get(&(post.service.clone(), post.user.clone()))
                    .map(String::as_str),
                &settings,
            )
        })
        .map(|post| {
            PostSummary::from_post(
                &st.cfg,
                post,
                names
                    .get(&(post.service.clone(), post.user.clone()))
                    .cloned(),
            )
        })
        .collect();
    Ok(PostPage {
        items,
        offset,
        has_more,
    })
}

/// Thumbnail lookups are best-effort. Remember failures for the rest of the
/// process so polling the Downloads page cannot hammer the API for posts that
/// simply do not contain an image.
static THUMBNAIL_ATTEMPTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub(crate) fn thumbnail_attempted(key: &str) -> bool {
    THUMBNAIL_ATTEMPTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map(|attempts| attempts.contains(key))
        .unwrap_or(false)
}

pub(crate) fn mark_thumbnail_attempted(key: &str) {
    if let Ok(mut attempts) = THUMBNAIL_ATTEMPTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
    {
        attempts.insert(key.to_string());
    }
}
