use crate::app::state::AppState;
use crate::features::posts::summary::{build_post_page, build_post_page_unfiltered};
use crate::shared::config::PAGE_SIZE;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{
    Attachment, Comment, CreatorSummary, DownloadRecord, MediaKind, Post, PostDetail, PostPage,
    PostSummary, Revision,
};
use crate::shared::security::sanitize_html;
use crate::shared::task::blocking;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Post feeds, detail enrichment and comment/revision orchestration.
/// Tauri commands stay thin wrappers around this service.
enum ProviderMedia {
    Remote(Box<crate::infra::providers::remote::RemoteMedia>),
    Proton(Box<crate::infra::providers::proton::ProtonFile>),
}

fn marks_attachment_unavailable(error: &AppError) -> bool {
    matches!(error, AppError::NotFound | AppError::Unavailable(_))
}

fn media_kind_from_download(value: &str) -> Option<MediaKind> {
    match value {
        "image" => Some(MediaKind::Image),
        "video" => Some(MediaKind::Video),
        "audio" => Some(MediaKind::Audio),
        "document" => Some(MediaKind::Document),
        "other" => Some(MediaKind::Other),
        _ => None,
    }
}

fn sort_post_summaries_oldest(posts: &mut [PostSummary]) {
    posts.sort_by(|left, right| {
        let left_time = left.published.or(left.added).unwrap_or(0);
        let right_time = right.published.or(right.added).unwrap_or(0);
        left_time
            .cmp(&right_time)
            .then_with(|| left.id.cmp(&right.id))
    });
}

/// Oldest-first pages walk the newest-first feed backwards. `end` is the
/// exclusive newest-first index boundary; the returned window is the 50 posts
/// immediately older than it.
fn oldest_page_window(end: i64) -> (i64, i64) {
    let end = end.max(0);
    ((end - PAGE_SIZE).max(0), end)
}

/// Newest-first page offsets needed to read the index range `[start, end)`.
/// The API only accepts 50-post page offsets, so a 50-post window may straddle
/// two pages when the feed length is not a multiple of 50.
fn range_page_offsets(start: i64, end: i64) -> Vec<i64> {
    if end <= start {
        return Vec::new();
    }
    let first = (start / PAGE_SIZE) * PAGE_SIZE;
    let last = ((end - 1) / PAGE_SIZE) * PAGE_SIZE;
    let mut offsets = Vec::new();
    let mut offset = first;
    loop {
        offsets.push(offset);
        if offset >= last {
            break;
        }
        offset += PAGE_SIZE;
    }
    offsets
}

/// Prefer a completed local download over the remote attachment. This also
/// clears the provider loading marker so post detail never resolves MEGA,
/// Proton or remote-drive metadata for a file that is already on disk.
fn apply_local_downloads(attachments: &mut [Attachment], downloads: &[DownloadRecord]) {
    for attachment in attachments.iter_mut() {
        let Some(record) = downloads
            .iter()
            .find(|record| record.url == attachment.url || record.url == attachment.download_url)
        else {
            continue;
        };
        if record.file_path.trim().is_empty() {
            continue;
        }
        attachment.local_path = Some(record.file_path.clone());
        if !record.file_name.trim().is_empty() {
            attachment.name = record.file_name.clone();
            attachment.ext = crate::shared::security::file_extension(&record.file_name);
        }
        if let Some(kind) = media_kind_from_download(&record.media_kind) {
            attachment.kind = kind;
        }
        attachment.locked = false;
        attachment.resolving = false;
        attachment.unavailable = false;
    }
}

pub(crate) struct PostService {
    state: AppState,
}

impl PostService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) async fn recent(
        &self,
        offset: i64,
        request_id: Option<&str>,
    ) -> AppResult<PostPage> {
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .recent_posts(offset, None, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        build_post_page(&self.state, result?, offset, false)
    }

    pub(crate) async fn summary(
        &self,
        service: &str,
        creator_id: &str,
        post_id: &str,
    ) -> AppResult<PostSummary> {
        let post = self
            .state
            .api
            .post(service, creator_id, post_id, None)
            .await?;
        if crate::features::posts::filters::is_creator_blocked(
            &post.service,
            &post.user,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let creator = self.state.db.get_creator(&post.service, &post.user)?;
        Ok(PostSummary::from_post(
            &self.state.cfg,
            &post,
            creator.map(|creator| creator.name),
        ))
    }

    pub(crate) async fn detail(
        &self,
        service: &str,
        creator_id: &str,
        post_id: &str,
        request_id: Option<&str>,
    ) -> AppResult<PostDetail> {
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .post(service, creator_id, post_id, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        let mut post = result?;
        if crate::features::posts::filters::is_creator_blocked(
            &post.service,
            &post.user,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let next = post.next.clone();
        let prev = post.prev.clone();
        post.content = sanitize_html(&post.content);
        let attachments: Vec<Attachment> = post
            .all_files_including_direct()
            .into_iter()
            .filter_map(|file| Attachment::new(&self.state.cfg, &file))
            .collect();
        let mut attachments = attachments;
        let db = Arc::clone(&self.state.db);
        let post_service = post.service.clone();
        let post_creator = post.user.clone();
        let post_id_value = post.id.clone();
        let downloads =
            blocking(move || db.downloads_for_post(&post_service, &post_creator, &post_id_value))
                .await?;
        apply_local_downloads(&mut attachments, &downloads);
        let creator = self
            .state
            .db
            .get_creator(&post.service, &post.user)?
            .or_else(|| {
                Some(CreatorSummary {
                    id: post.user.clone(),
                    name: post.user.clone(),
                    service: post.service.clone(),
                    ..Default::default()
                })
            });
        Ok(PostDetail {
            post,
            attachments,
            creator,
            next,
            prev,
        })
    }

    /// Resolve external provider metadata for attachments returned by the
    /// fast post-detail path. Folder links are expanded here so the initial
    /// post render never waits on cloud-drive APIs.
    pub(crate) async fn resolve_attachments(
        &self,
        mut attachments: Vec<Attachment>,
    ) -> AppResult<Vec<Attachment>> {
        // Public Drive, MEGA and Proton folder links are expanded into their
        // individual files so they can be played, queued and downloaded like
        // direct links.
        attachments = crate::infra::providers::remote::expand_folders(
            &self.state.mega,
            &self.state.proton,
            &self.state.remote,
            attachments,
        )
        .await;
        // MEGA links hide their filename, size and media kind behind encrypted
        // attributes. Proton and the other provider links have no media
        // extension either. Resolve them now so the player queue and attachment
        // list classify them like any other archive file. Failures stay
        // non-fatal: the link is still visible and the player reports the error
        // on demand.
        for attachment in attachments.iter_mut() {
            if attachment.locked || attachment.local_path.is_some() {
                continue;
            }
            if crate::infra::providers::mega::is_media_url(&attachment.url) {
                match self.state.mega.resolve(&attachment.url).await {
                    Ok(file) => {
                        attachment.name = file.name.clone();
                        attachment.ext = crate::shared::security::file_extension(&file.name);
                        attachment.kind = file.kind();
                        // Images need a real image URL for the thumbnail grid.
                        // Videos and audio resolve to a loopback URL when the
                        // player opens them.
                        if attachment.kind == MediaKind::Image {
                            let source = self
                                .state
                                .mega
                                .decrypt_link(&attachment.url)
                                .await
                                .ok()
                                .flatten()
                                .unwrap_or_else(|| attachment.url.clone());
                            let stream =
                                if crate::infra::providers::mega::parse_folder_file_link(&source)
                                    .is_some()
                                {
                                    Some(crate::infra::providers::mega::MegaStream::new_folder(
                                        self.state.mega.clone(),
                                        source.clone(),
                                        file.clone(),
                                    )?)
                                } else {
                                    crate::infra::providers::mega::parse_file_link(&source).map(
                                        |link| {
                                            crate::infra::providers::mega::MegaStream::new(
                                                self.state.mega.client_clone(),
                                                link,
                                                file.clone(),
                                            )
                                        },
                                    )
                                };
                            if let Some(stream) = stream {
                                attachment.thumbnail_url =
                                    Some(self.state.media_server.register_mega(stream));
                            }
                        }
                    }
                    Err(AppError::PasswordRequired { .. }) => attachment.locked = true,
                    Err(error) if marks_attachment_unavailable(&error) => {
                        attachment.unavailable = true;
                    }
                    Err(_) => {}
                }
            }
        }

        // Provider lookups can each take a second or two. Resolve them in
        // parallel (with a small concurrency cap) so a post full of Dropbox
        // links does not open one request at a time.
        let gate = Arc::new(tokio::sync::Semaphore::new(4));
        let mut jobs = tokio::task::JoinSet::new();
        for (index, attachment) in attachments.iter().enumerate() {
            if attachment.locked
                || attachment.local_path.is_some()
                || crate::infra::providers::mega::is_media_url(&attachment.url)
            {
                continue;
            }
            let is_proton = crate::infra::providers::proton::is_proton_url(&attachment.url);
            if !is_proton && !crate::infra::providers::remote::needs_resolution(&attachment.url) {
                continue;
            }
            let state = self.state.clone();
            let url = attachment.url.clone();
            let gate = gate.clone();
            jobs.spawn(async move {
                let _permit = gate.acquire_owned().await.ok();
                let result = if is_proton {
                    state
                        .proton
                        .resolve(&url)
                        .await
                        .map(Box::new)
                        .map(ProviderMedia::Proton)
                } else {
                    state
                        .remote
                        .resolve(&url)
                        .await
                        .map(Box::new)
                        .map(ProviderMedia::Remote)
                };
                (index, result)
            });
        }
        while let Some(joined) = jobs.join_next().await {
            let Ok((index, result)) = joined else {
                continue;
            };
            let Some(attachment) = attachments.get_mut(index) else {
                continue;
            };
            match result {
                Ok(ProviderMedia::Remote(media)) => {
                    attachment.name = media.name.clone();
                    attachment.ext = crate::shared::security::file_extension(&media.name);
                    attachment.kind = media.kind;
                    attachment.provider = media.provider;
                    if attachment.kind == MediaKind::Image {
                        let source = media.source(self.state.remote.client().clone());
                        attachment.thumbnail_url =
                            Some(self.state.media_server.register_remote(source));
                    }
                }
                Ok(ProviderMedia::Proton(file)) => {
                    attachment.name = file.name.clone();
                    attachment.ext = crate::shared::security::file_extension(&file.name);
                    attachment.kind = file.kind;
                    attachment.provider = crate::infra::providers::MediaProvider::Proton;
                    if attachment.kind == MediaKind::Image {
                        let stream = crate::infra::providers::proton::ProtonStream::new(*file);
                        attachment.thumbnail_url =
                            Some(self.state.media_server.register_proton(stream));
                    }
                }
                Err(AppError::PasswordRequired { .. }) => attachment.locked = true,
                Err(error) if marks_attachment_unavailable(&error) => {
                    attachment.unavailable = true;
                }
                Err(_) => {}
            }
        }
        for attachment in attachments.iter_mut() {
            attachment.resolving = false;
        }
        Ok(attachments)
    }

    pub(crate) async fn comments(
        &self,
        service: &str,
        creator_id: &str,
        post_id: &str,
        request_id: Option<&str>,
    ) -> AppResult<Vec<Comment>> {
        if crate::features::posts::filters::is_creator_blocked(
            service,
            creator_id,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .comments(service, creator_id, post_id, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        Ok(result?
            .into_iter()
            .map(|mut comment| {
                comment.content = sanitize_html(&comment.content);
                for revision in &mut comment.revisions {
                    revision.content = sanitize_html(&revision.content);
                }
                comment
            })
            .collect())
    }

    pub(crate) async fn revisions(
        &self,
        service: &str,
        creator_id: &str,
        post_id: &str,
        request_id: Option<&str>,
    ) -> AppResult<Vec<Revision>> {
        if crate::features::posts::filters::is_creator_blocked(
            service,
            creator_id,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .revisions(service, creator_id, post_id, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        Ok(result?
            .into_iter()
            .map(|mut revision| {
                revision.post.content = sanitize_html(&revision.post.content);
                revision
            })
            .collect())
    }

    pub(crate) async fn creator_posts(
        &self,
        service: &str,
        creator_id: &str,
        offset: i64,
        query: Option<&str>,
        sort: Option<&str>,
        request_id: Option<&str>,
    ) -> AppResult<PostPage> {
        if crate::features::posts::filters::is_creator_blocked(
            service,
            creator_id,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let oldest = matches!(sort, Some("oldest"));
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = async {
            if oldest {
                self.oldest_creator_posts_page(service, creator_id, offset, query, token.as_ref())
                    .await
            } else {
                if offset < 0 {
                    return Err(AppError::Validation("offset must not be negative".into()));
                }
                let posts = self
                    .state
                    .api
                    .creator_posts(service, creator_id, offset, query, token.as_ref())
                    .await?;
                build_post_page(&self.state, posts, offset, true)
            }
        }
        .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        result
    }

    /// Walk the newest-first feed backwards and return one 50-post window in
    /// oldest-first order. `cursor` is `-1` for the oldest posts, then the
    /// returned page offset for each older window. This keeps every response
    /// at 50 posts instead of returning the short tail page first, which used
    /// to render an empty creator tab whenever that tail page was filtered.
    async fn oldest_creator_posts_page(
        &self,
        service: &str,
        creator_id: &str,
        cursor: i64,
        query: Option<&str>,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<PostPage> {
        if cursor > 1_000_000 {
            return Err(AppError::Validation("offset is too large".into()));
        }
        let end = if cursor < 0 {
            self.creator_post_total(service, creator_id, query, cancel)
                .await?
        } else {
            cursor
        };
        let (start, end) = oldest_page_window(end);
        let posts = self
            .creator_posts_between(service, creator_id, start, end, query, cancel)
            .await?;
        let mut page = build_post_page(&self.state, posts, start, true)?;
        page.has_more = start > 0;
        sort_post_summaries_oldest(&mut page.items);
        Ok(page)
    }

    /// Count the newest-first creator feed. The archive only exposes offsets,
    /// so probe exponentially and then binary-search the last non-empty page.
    async fn creator_post_total(
        &self,
        service: &str,
        creator_id: &str,
        query: Option<&str>,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<i64> {
        let mut low = 0i64;
        let mut low_len = self
            .state
            .api
            .creator_posts(service, creator_id, 0, query, cancel)
            .await?
            .len() as i64;
        if low_len < PAGE_SIZE {
            return Ok(low_len);
        }

        let mut high: Option<i64> = None;
        let mut step = PAGE_SIZE;
        while step <= 1_000_000 {
            let page = self
                .state
                .api
                .creator_posts(service, creator_id, step, query, cancel)
                .await?;
            if page.is_empty() {
                high = Some(step);
                break;
            }
            low = step;
            low_len = page.len() as i64;
            if low_len < PAGE_SIZE {
                return Ok(low + low_len);
            }
            let Some(next) = step.checked_mul(2) else {
                break;
            };
            step = next;
        }

        let Some(mut high) = high else {
            return Ok(low + low_len);
        };
        while high - low > PAGE_SIZE {
            let mid = low + ((high - low) / (PAGE_SIZE * 2)) * PAGE_SIZE;
            if mid <= low {
                break;
            }
            let page = self
                .state
                .api
                .creator_posts(service, creator_id, mid, query, cancel)
                .await?;
            if page.is_empty() {
                high = mid;
            } else {
                low = mid;
                low_len = page.len() as i64;
                if low_len < PAGE_SIZE {
                    return Ok(low + low_len);
                }
            }
        }
        Ok(low + low_len)
    }

    /// Read the newest-first index range `[start, end)` and return it in feed
    /// order. The range is at most one page window, so this fetches one or two
    /// archive pages.
    async fn creator_posts_between(
        &self,
        service: &str,
        creator_id: &str,
        start: i64,
        end: i64,
        query: Option<&str>,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<Post>> {
        let mut posts = Vec::new();
        for page_offset in range_page_offsets(start, end) {
            let page = self
                .state
                .api
                .creator_posts(service, creator_id, page_offset, query, cancel)
                .await?;
            for (index, post) in page.into_iter().enumerate() {
                let global = page_offset + index as i64;
                if global >= start && global < end {
                    posts.push((global, post));
                }
            }
        }
        posts.sort_by_key(|(index, _)| *index);
        Ok(posts.into_iter().map(|(_, post)| post).collect())
    }

    /// Resolve cloud-provider metadata for a scan page so each summary carries
    /// the real media kinds instead of the extension guess. Only posts with
    /// provider links do any network work, with a small concurrency cap so a
    /// page full of Drive links cannot flood the providers.
    async fn resolve_scan_media_kinds(
        &self,
        posts: &[Post],
        cancel: Option<&CancellationToken>,
    ) -> Vec<Option<Vec<MediaKind>>> {
        let mut results: Vec<Option<Vec<MediaKind>>> = vec![None; posts.len()];
        let gate = Arc::new(tokio::sync::Semaphore::new(4));
        let mut jobs = tokio::task::JoinSet::new();
        for (index, post) in posts.iter().enumerate() {
            let attachments: Vec<Attachment> = post
                .all_files_including_direct()
                .into_iter()
                .filter_map(|file| Attachment::new(&self.state.cfg, &file))
                .collect();
            if !attachments
                .iter()
                .any(crate::shared::models::Attachment::needs_kind_resolution)
            {
                continue;
            }
            if cancel.map(CancellationToken::is_cancelled).unwrap_or(false) {
                break;
            }
            let state = self.state.clone();
            let gate = gate.clone();
            jobs.spawn(async move {
                let _permit = gate.acquire_owned().await.ok();
                let mut attachments = crate::infra::providers::remote::expand_folders(
                    &state.mega,
                    &state.proton,
                    &state.remote,
                    attachments,
                )
                .await;
                for attachment in attachments.iter_mut() {
                    let _ = crate::infra::providers::resolve_attachment_kind(
                        &state.mega,
                        &state.proton,
                        &state.remote,
                        attachment,
                    )
                    .await;
                }
                let mut kinds = Vec::new();
                for attachment in &attachments {
                    if attachment.locked
                        || attachment.preview_only
                        || attachment.unavailable
                        || attachment.local_path.is_some()
                    {
                        continue;
                    }
                    if !kinds.contains(&attachment.kind) {
                        kinds.push(attachment.kind);
                    }
                }
                (index, (!kinds.is_empty()).then_some(kinds))
            });
        }
        while let Some(joined) = jobs.join_next().await {
            let Ok((index, kinds)) = joined else {
                continue;
            };
            if let Some(slot) = results.get_mut(index) {
                *slot = kinds;
            }
        }
        results
    }

    /// Creator post feed without the global content filters. The creator
    /// download dialog applies its own date, keyword and media filters, so
    /// provider metadata must be resolved here first.
    pub(crate) async fn creator_download_posts(
        &self,
        service: &str,
        creator_id: &str,
        offset: i64,
        request_id: Option<&str>,
    ) -> AppResult<PostPage> {
        if crate::features::posts::filters::is_creator_blocked(
            service,
            creator_id,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = async {
            let posts = self
                .state
                .api
                .creator_posts(service, creator_id, offset, None, token.as_ref())
                .await?;
            let resolved = self.resolve_scan_media_kinds(&posts, token.as_ref()).await;
            let mut page = build_post_page_unfiltered(&self.state, posts, offset)?;
            for (item, kinds) in page.items.iter_mut().zip(resolved) {
                if let Some(kinds) = kinds {
                    item.media_kinds = kinds;
                }
            }
            Ok(page)
        }
        .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        result
    }

    pub(crate) async fn popular(
        &self,
        offset: i64,
        request_id: Option<&str>,
    ) -> AppResult<PostPage> {
        crate::shared::security::validate_offset(offset)?;
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .popular_posts_html(offset, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        let html = result?;
        let mut items =
            crate::features::posts::popular::parse_popular_posts(&html, |service, user| {
                self.state
                    .db
                    .get_creator(service, user)
                    .ok()
                    .flatten()
                    .map(|creator| creator.name)
            });
        let has_more = items.len() as i64 >= PAGE_SIZE;
        let settings = self.state.settings();
        items.retain(|item| !crate::features::posts::filters::summary_is_hidden(item, &settings));
        Ok(PostPage {
            items,
            offset,
            has_more,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_local_downloads, marks_attachment_unavailable, oldest_page_window,
        range_page_offsets, sort_post_summaries_oldest, PostService,
    };
    use crate::app::state::AppState;
    use crate::infra::pawchive_api::ApiClient;
    use crate::shared::config::{NetworkSettings, PawchiveConfig};
    use crate::shared::error::AppError;
    use crate::shared::models::{AppSettings, Attachment, DownloadRecord, MediaKind, PostSummary};
    use std::sync::{Arc, Mutex, RwLock};
    use wiremock::matchers::{method, path, query_param, query_param_is_missing};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn attachment(url: &str, resolving: bool) -> Attachment {
        Attachment {
            name: "mega-handle".into(),
            path: url.into(),
            url: url.into(),
            download_url: url.into(),
            thumbnail_url: None,
            kind: MediaKind::Other,
            provider: crate::infra::providers::MediaProvider::Mega,
            ext: String::new(),
            preview_only: false,
            locked: true,
            resolving,
            unavailable: true,
            local_path: None,
        }
    }

    fn download(url: &str) -> DownloadRecord {
        DownloadRecord {
            id: "dl-1".into(),
            url: url.into(),
            file_path: "/tmp/Downloads/Ada/clip.mp4".into(),
            file_name: "clip.mp4".into(),
            media_kind: "video".into(),
            title: "Clip".into(),
            creator_name: "Ada".into(),
            service: "patreon".into(),
            creator_id: "1".into(),
            post_id: "2".into(),
            playlist_id: None,
            thumbnail_url: None,
            total_bytes: Some(10),
            downloaded_bytes: 10,
            status: "completed".into(),
            error: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn downloaded_attachments_use_the_local_file_without_resolving() {
        let url = "https://mega.nz/file/abc";
        let mut attachments = vec![
            attachment(url, true),
            attachment("https://mega.nz/file/missing", true),
        ];

        apply_local_downloads(&mut attachments, &[download(url)]);

        let local = &attachments[0];
        assert_eq!(
            local.local_path.as_deref(),
            Some("/tmp/Downloads/Ada/clip.mp4")
        );
        assert_eq!(local.name, "clip.mp4");
        assert_eq!(local.kind, MediaKind::Video);
        assert_eq!(local.ext, "mp4");
        assert!(!local.locked);
        assert!(!local.resolving);
        assert!(!local.unavailable);

        assert!(attachments[1].local_path.is_none());
        assert!(attachments[1].resolving);
    }

    fn state_with_api(base: &str) -> AppState {
        let cfg = PawchiveConfig {
            api_base: format!("{base}/api/v1"),
            ..Default::default()
        };
        let api = ApiClient::new(
            cfg.clone(),
            NetworkSettings {
                timeout_secs: 5,
                max_concurrency: 4,
                retries: 0,
                cache_size_mb: 64,
            },
        )
        .unwrap();
        AppState {
            db: Arc::new(crate::infra::sqlite::Db::open_in_memory().unwrap()),
            api,
            cfg,
            settings: Arc::new(RwLock::new(AppSettings::default())),
            cancellations: Arc::new(Mutex::new(Default::default())),
            downloads: Arc::new(Mutex::new(Default::default())),
            download_gate: Arc::new(tokio::sync::Semaphore::new(1)),
            http: reqwest::Client::new(),
            mega: crate::infra::providers::mega::MegaResolver::new(reqwest::Client::new()),
            proton: Arc::new(crate::infra::providers::proton::ProtonResolver::new()),
            passwords: Arc::new(crate::infra::provider_passwords::ProviderPasswords::in_memory()),
            remote: Arc::new(crate::infra::providers::remote::RemoteResolver::new(
                reqwest::Client::new(),
            )),
            app_data_dir: std::env::temp_dir(),
            default_download_dir: std::env::temp_dir(),
            media_server: crate::infra::local_http::LocalMediaServer::test_instance(),
            account: Arc::new(RwLock::new(None)),
        }
    }

    fn feed_page(start: i64, count: i64) -> Vec<serde_json::Value> {
        (0..count)
            .map(|offset| {
                let index = start + offset;
                serde_json::json!({
                    "id": format!("p{index:03}"),
                    "user": "42",
                    "service": "patreon",
                    "title": format!("Post {index}"),
                    "published": 1_700_000_000_i64 - index,
                })
            })
            .collect()
    }

    #[tokio::test]
    async fn oldest_cursor_returns_full_windows_and_the_oldest_post() {
        let server = MockServer::start().await;
        for (offset, count) in [(0, 50), (50, 1), (100, 0)] {
            let mock = Mock::given(method("GET")).and(path("/api/v1/patreon/user/42"));
            let mock = if offset == 0 {
                mock.and(query_param_is_missing("o"))
            } else {
                mock.and(query_param("o", offset.to_string()))
            };
            mock.respond_with(ResponseTemplate::new(200).set_body_json(feed_page(offset, count)))
                .mount(&server)
                .await;
        }

        let service = PostService::new(state_with_api(&server.uri()));
        let first = service
            .creator_posts("patreon", "42", -1, None, Some("oldest"), None)
            .await
            .unwrap();
        assert_eq!(first.offset, 1);
        assert!(first.has_more);
        assert_eq!(first.items.len(), 50);
        assert_eq!(first.items.first().unwrap().id, "p050");
        assert_eq!(first.items.last().unwrap().id, "p001");

        let second = service
            .creator_posts("patreon", "42", first.offset, None, Some("oldest"), None)
            .await
            .unwrap();
        assert_eq!(second.offset, 0);
        assert!(!second.has_more);
        assert_eq!(second.items.len(), 1);
        assert_eq!(second.items[0].id, "p000");
    }

    fn media_attachment(url: &str, kind: MediaKind) -> Attachment {
        Attachment {
            url: url.into(),
            path: url.into(),
            download_url: url.into(),
            kind,
            ..Default::default()
        }
    }

    #[test]
    fn scan_resolution_targets_cloud_links_only() {
        let needs =
            |url: &str, kind: MediaKind| media_attachment(url, kind).needs_kind_resolution();
        assert!(needs(
            "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30",
            MediaKind::Video,
        ));
        assert!(needs(
            "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ",
            MediaKind::Other,
        ));
        assert!(needs(
            "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz",
            MediaKind::Other,
        ));
        assert!(needs(
            "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view",
            MediaKind::Other,
        ));
        assert!(needs(
            "https://drive.proton.me/urls/abc#pw",
            MediaKind::Other,
        ));
        assert!(needs(
            "https://www.dropbox.com/s/abc/clip",
            MediaKind::Other,
        ));
        assert!(!needs(
            "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view",
            MediaKind::Image,
        ));
        assert!(!needs(
            "https://file.pawchive.pw/data/aa/clip.mp4",
            MediaKind::Video,
        ));

        let mut locked = media_attachment(
            "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30",
            MediaKind::Video,
        );
        locked.locked = true;
        assert!(!locked.needs_kind_resolution());
    }

    #[test]
    fn oldest_pages_walk_backwards_in_full_windows() {
        assert_eq!(oldest_page_window(351), (301, 351));
        assert_eq!(oldest_page_window(301), (251, 301));
        assert_eq!(oldest_page_window(50), (0, 50));
        assert_eq!(oldest_page_window(1), (0, 1));
        assert_eq!(oldest_page_window(0), (0, 0));
        assert_eq!(oldest_page_window(-1), (0, 0));
    }

    #[test]
    fn oldest_windows_read_the_newest_first_pages_that_contain_them() {
        assert_eq!(range_page_offsets(301, 351), [300, 350]);
        assert_eq!(range_page_offsets(251, 301), [250, 300]);
        assert_eq!(range_page_offsets(100, 150), [100]);
        assert_eq!(range_page_offsets(1, 51), [0, 50]);
        assert_eq!(range_page_offsets(0, 50), [0]);
        assert!(range_page_offsets(10, 10).is_empty());
    }

    #[test]
    fn sorts_creator_posts_oldest_first() {
        let post = |id: &str, published: Option<i64>, added: Option<i64>| PostSummary {
            id: id.into(),
            published,
            added,
            ..Default::default()
        };
        let mut posts = vec![
            post("new", Some(300), None),
            post("undated", None, None),
            post("old-added", None, Some(100)),
            post("old-published", Some(100), Some(200)),
        ];

        sort_post_summaries_oldest(&mut posts);

        assert_eq!(
            posts
                .iter()
                .map(|post| post.id.as_str())
                .collect::<Vec<_>>(),
            ["undated", "old-added", "old-published", "new"]
        );
    }

    #[test]
    fn marks_only_missing_and_unavailable_provider_files() {
        assert!(marks_attachment_unavailable(&AppError::NotFound));
        assert!(marks_attachment_unavailable(&AppError::Unavailable(
            "gone".into()
        )));
        assert!(!marks_attachment_unavailable(&AppError::Network(
            "offline".into()
        )));
        assert!(!marks_attachment_unavailable(&AppError::PasswordRequired {
            provider: "MEGA",
            url: "https://mega.nz/file/x".into(),
            rejected: false,
        }));
    }
}
