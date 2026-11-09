use crate::app::state::AppState;
use crate::features::posts::summary::creator_lookup;
use crate::shared::config::PAGE_SIZE;
use crate::shared::error::AppResult;
use crate::shared::models::{MediaKind, PostSummary, SearchPage};
use crate::shared::security::{validate_search_query, validate_service};
use crate::shared::task::blocking;
use std::sync::Arc;

/// Archive search with local service/media filtering, relevance scoring and
/// creator suggestions.
pub(crate) struct SearchService {
    state: AppState,
}

impl SearchService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) async fn search(
        &self,
        query: String,
        offset: i64,
        service: Option<String>,
        media: Option<Vec<String>>,
        sort: Option<String>,
        request_id: Option<&str>,
    ) -> AppResult<SearchPage> {
        let query = validate_search_query(&query)?;
        let sort = sort.unwrap_or_else(|| "relevance".into());
        let service = service.filter(|s| !s.trim().is_empty());
        if let Some(service) = service.as_deref() {
            validate_service(service)?;
        }
        let media_filter: Vec<MediaKind> = media
            .unwrap_or_default()
            .iter()
            .filter_map(|value| match value.as_str() {
                "image" => Some(MediaKind::Image),
                "video" => Some(MediaKind::Video),
                "audio" => Some(MediaKind::Audio),
                "document" => Some(MediaKind::Document),
                "other" => Some(MediaKind::Other),
                _ => None,
            })
            .collect();

        let token = request_id.map(|id| self.state.register_cancel(id));
        let posts_result = self
            .state
            .api
            .recent_posts(offset, Some(&query), token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        let raw_posts = posts_result?;
        let has_more = raw_posts.len() as i64 >= PAGE_SIZE;

        let mut limitations = Vec::new();
        let content_settings = self.state.settings();
        let mut filtered: Vec<PostSummary> = {
            let names = creator_lookup(&self.state, &raw_posts);
            raw_posts
                .iter()
                .filter(|post| {
                    !crate::features::posts::filters::is_hidden(
                        post,
                        names
                            .get(&(post.service.clone(), post.user.clone()))
                            .map(String::as_str),
                        &content_settings,
                    )
                })
                .filter(|post| {
                    service
                        .as_deref()
                        .map(|s| post.service.eq_ignore_ascii_case(s))
                        .unwrap_or(true)
                })
                .filter(|post| {
                    if media_filter.is_empty() {
                        return true;
                    }
                    post.all_files_including_direct().iter().any(|file| {
                        media_filter.contains(&crate::shared::models::media_kind_for_file(file))
                    })
                })
                .map(|post| {
                    PostSummary::from_post(
                        &self.state.cfg,
                        post,
                        names
                            .get(&(post.service.clone(), post.user.clone()))
                            .cloned(),
                    )
                })
                .collect()
        };

        let lower = query.to_lowercase();
        crate::features::search::ranking::sort_results(&mut filtered, &sort, &lower);

        if service.is_some() {
            limitations.push(
                "Service filtering is applied locally to each page; the archive search has no service parameter."
                    .to_string(),
            );
        }
        if !media_filter.is_empty() {
            limitations.push(
                "Media-type filtering is applied locally to the current page, so matching posts on later pages may not appear yet."
                    .to_string(),
            );
        }
        if sort == "relevance" {
            limitations.push(
                "The archive does not expose a relevance score; relevance is calculated locally from title, excerpt and creator matches."
                    .to_string(),
            );
        }

        let creators = {
            let db = Arc::clone(&self.state.db);
            let q = query.clone();
            blocking(move || db.query_creators(&q, None, "popular", 0, 12))
                .await?
                .0
        };

        Ok(SearchPage {
            posts: filtered,
            creators,
            offset,
            has_more,
            query,
            limitations,
        })
    }
}
