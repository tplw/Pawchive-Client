use crate::app::state::AppState;
use crate::features::posts::summary::build_post_page;
use crate::shared::config::PAGE_SIZE;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{
    Attachment, Comment, CreatorSummary, MediaKind, PostDetail, PostPage, PostSummary, Revision,
};
use crate::shared::security::sanitize_html;
use std::sync::Arc;

/// Post feeds, detail enrichment and comment/revision orchestration.
/// Tauri commands stay thin wrappers around this service.
enum ProviderMedia {
    Remote(Box<crate::infra::providers::remote::RemoteMedia>),
    Proton(Box<crate::infra::providers::proton::ProtonFile>),
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
        build_post_page(&self.state, result?, offset)
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
        // Public Drive, MEGA and Proton folder links are expanded into their
        // individual files so they can be played, queued and downloaded like
        // direct links.
        let mut attachments = crate::infra::providers::remote::expand_folders(
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
                            if let Some(link) =
                                crate::infra::providers::mega::parse_file_link(&source)
                            {
                                let stream = crate::infra::providers::mega::MegaStream::new(
                                    self.state.mega.client_clone(),
                                    link,
                                    file.clone(),
                                );
                                attachment.thumbnail_url =
                                    Some(self.state.media_server.register_mega(stream));
                            }
                        }
                    }
                    Err(AppError::PasswordRequired { .. }) => attachment.locked = true,
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
            if crate::infra::providers::mega::is_media_url(&attachment.url) {
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
                Err(_) => {}
            }
        }
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
        build_post_page(&self.state, result?, offset)
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
