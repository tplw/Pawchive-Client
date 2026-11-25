use crate::app::state::AppState;
use crate::features::posts::summary::{build_post_page, build_post_page_unfiltered};
use crate::shared::config::PAGE_SIZE;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{
    Attachment, Comment, CreatorSummary, DownloadRecord, MediaKind, PostDetail, PostPage,
    PostSummary, Revision,
};
use crate::shared::security::sanitize_html;
use crate::shared::task::blocking;
use std::sync::Arc;

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
        let result = self
            .state
            .api
            .creator_posts(service, creator_id, offset, query, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        build_post_page(&self.state, result?, offset, true)
    }

    /// Creator post feed without the global content filters. The creator
    /// download dialog applies its own date, keyword and media filters.
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
        let result = self
            .state
            .api
            .creator_posts(service, creator_id, offset, None, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        build_post_page_unfiltered(&self.state, result?, offset)
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
    use super::{apply_local_downloads, marks_attachment_unavailable};
    use crate::shared::error::AppError;
    use crate::shared::models::{Attachment, DownloadRecord, MediaKind};

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
