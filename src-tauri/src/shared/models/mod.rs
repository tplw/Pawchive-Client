mod account;
mod common;
mod creator;
mod download;
mod library;
mod post;
mod settings;

pub use account::*;
pub use common::{now_ts, strip_html, truncate};
pub use creator::*;
pub use download::*;
pub use library::*;
pub use post::*;
pub use settings::*;

pub use crate::shared::media_kind::MediaKind;

#[cfg(test)]
mod tests {
    use super::common::parse_timestamp;
    use super::*;

    #[test]
    fn parses_mixed_timestamp_shapes() {
        assert_eq!(
            parse_timestamp(&serde_json::json!(1672534800)),
            Some(1672534800)
        );
        assert_eq!(
            parse_timestamp(&serde_json::json!("1672534800")),
            Some(1672534800)
        );
        assert_eq!(
            parse_timestamp(&serde_json::json!("2021-01-24T08:54:38")),
            Some(1611478478)
        );
        assert_eq!(
            parse_timestamp(&serde_json::json!("2021-01-24T08:54:38.973913")),
            Some(1611478478)
        );
        assert_eq!(parse_timestamp(&serde_json::json!(null)), None);
        assert_eq!(parse_timestamp(&serde_json::json!("not a date")), None);
    }

    #[test]
    fn deserializes_post_with_unknown_fields() {
        let raw = serde_json::json!({
            "id": "1836570",
            "user": "6570768",
            "service": "fanbox",
            "title": "Hello",
            "content": "<p>Hi</p>",
            "embed": {},
            "shared_file": false,
            "added": "2021-03-30T18:00:05.973913",
            "published": "2021-01-24T17:54:38",
            "edited": null,
            "file": {"name": "a.jpg", "path": "/aa/bb/a.jpg", "preview_only": true},
            "attachments": [{"name": "b.mp4", "path": "/cc/dd/b.mp4"}],
            "brand_new_field": {"future": true}
        });
        let post: Post = serde_json::from_value(raw).unwrap();
        assert_eq!(post.id, "1836570");
        assert_eq!(post.all_files().len(), 2);
        assert!(post.extra.contains_key("brand_new_field"));
        assert!(post.added.is_some());
    }

    #[test]
    fn tolerates_missing_and_null_fields() {
        let raw = serde_json::json!({"id": "1", "title": null, "attachments": null, "file": null});
        let post: Post = serde_json::from_value(raw).unwrap();
        assert_eq!(post.title, "");
        assert!(post.attachments.is_empty());
        assert!(post.all_files().is_empty());
    }

    #[test]
    fn treats_kemono_previews_as_unimported() {
        let preview: Post = serde_json::from_value(serde_json::json!({
            "id": "1",
            "origin": "kemono"
        }))
        .unwrap();
        assert!(!preview.is_imported());

        let imported: Post = serde_json::from_value(serde_json::json!({
            "id": "2",
            "origin": "import"
        }))
        .unwrap();
        assert!(imported.is_imported());

        let legacy: Post = serde_json::from_value(serde_json::json!({"id": "3"})).unwrap();
        assert!(legacy.is_imported());
    }

    #[test]
    fn flags_imported_posts_that_lost_files_to_the_size_limit() {
        let all_images: Post = serde_json::from_value(serde_json::json!({
            "id": "1",
            "origin": "import",
            "has_full": false,
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true},
                {"name": "2.png", "path": "/bb/2.png", "preview_only": true}
            ]
        }))
        .unwrap();
        assert!(all_images.exceeds_archive_limit());
        assert!(all_images.is_unavailable());

        let mixed: Post = serde_json::from_value(serde_json::json!({
            "id": "2",
            "origin": "import",
            "has_full": false,
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true},
                {"name": "clip.mp4", "path": "/bb/clip.mp4"}
            ]
        }))
        .unwrap();
        assert!(mixed.exceeds_archive_limit());
        assert!(mixed.has_available_non_image_attachment());
        assert!(!mixed.is_unavailable());

        let deferred_only: Post = serde_json::from_value(serde_json::json!({
            "id": "5",
            "origin": "import",
            "has_full": false,
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true},
                {"name": "set.zip", "deferred": true, "temp_url": "https://example.com/set.zip"}
            ]
        }))
        .unwrap();
        assert!(deferred_only.exceeds_archive_limit());
        assert!(deferred_only.has_available_non_image_attachment());
        assert!(!deferred_only.is_unavailable());

        let dropped_only: Post = serde_json::from_value(serde_json::json!({
            "id": "8",
            "origin": "import",
            "has_full": false,
            "file": {"name": "cover.webp", "path": "/aa/cover.webp"},
            "attachments": [
                {"name": "audio.wav", "deferred": true}
            ]
        }))
        .unwrap();
        assert!(dropped_only.exceeds_archive_limit());
        assert!(!dropped_only.has_available_non_image_attachment());
        assert!(dropped_only.is_unavailable());

        let cloud_media: Post = serde_json::from_value(serde_json::json!({
            "id": "6",
            "origin": "import",
            "has_full": false,
            "content": "<p><a href=\"https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30\">video</a></p>",
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true}
            ]
        }))
        .unwrap();
        assert!(cloud_media.exceeds_archive_limit());
        assert!(cloud_media.has_available_non_image_attachment());
        assert!(!cloud_media.is_unavailable());

        let preview_with_cloud_media: Post = serde_json::from_value(serde_json::json!({
            "id": "7",
            "origin": "kemono",
            "content": "<p><a href=\"https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view\">video</a></p>"
        }))
        .unwrap();
        assert!(!preview_with_cloud_media.is_imported());
        assert!(preview_with_cloud_media.has_available_non_image_attachment());
        assert!(!preview_with_cloud_media.is_unavailable());

        let complete: Post = serde_json::from_value(serde_json::json!({
            "id": "3",
            "origin": "import",
            "has_full": true,
            "attachments": [{"name": "1.png", "path": "/aa/1.png", "preview_only": true}]
        }))
        .unwrap();
        assert!(!complete.exceeds_archive_limit());
        assert!(!complete.is_unavailable());

        let preview: Post = serde_json::from_value(serde_json::json!({
            "id": "4",
            "origin": "kemono",
            "has_full": false
        }))
        .unwrap();
        assert!(!preview.exceeds_archive_limit());
        assert!(preview.is_unavailable());
    }

    #[test]
    fn hides_unimported_previews_without_a_playable_source() {
        let preview: Post = serde_json::from_value(serde_json::json!({
            "id": "125114528",
            "origin": "kemono",
            "has_full": false,
            "file": {
                "name": "4_25YT M4M Bully Listener x Nerd.mp3",
                "path": "/14d/7d/4d7dd38f0007f3eb093b839a9d8ea1aa6cd594dd33b9c56872917fbe4b840497.mp3",
                "server": "https://n2.pawchive.pw"
            }
        }))
        .unwrap();
        assert!(!preview.is_imported());
        assert!(!preview.has_available_non_image_attachment());
        assert!(preview.is_unavailable());

        let playable: Post = serde_json::from_value(serde_json::json!({
            "id": "125050372",
            "origin": "kemono",
            "has_full": false,
            "file": {
                "name": "clip.mp4",
                "path": "https://cdn.example.com/clip.mp4"
            }
        }))
        .unwrap();
        assert!(playable.has_available_non_image_attachment());
        assert!(!playable.is_unavailable());
    }

    #[test]
    fn includes_direct_media_links_in_posts() {
        let cfg = crate::shared::config::PawchiveConfig::default();
        let post = Post {
            id: "1".into(),
            service: "patreon".into(),
            user: "2".into(),
            title: "Direct media".into(),
            content: r#"<p>Watch <a href="https://cdn.example.com/videos/clip.mp4">this</a></p>"#
                .into(),
            ..Default::default()
        };
        let files = post.all_files_including_direct();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "clip.mp4");
        assert_eq!(files[0].path, "https://cdn.example.com/videos/clip.mp4");
        let summary = PostSummary::from_post(&cfg, &post, None);
        assert_eq!(summary.attachment_count, 1);
        assert_eq!(summary.media_kinds, vec![MediaKind::Video]);
    }

    #[test]
    fn includes_proton_direct_media_links() {
        let cfg = crate::shared::config::PawchiveConfig::default();
        let post = Post {
            id: "1".into(),
            service: "patreon".into(),
            user: "2".into(),
            title: "Proton share".into(),
            content: r#"<p>Watch <a href="https://drive.proton.me/urls/AbC_123#correct-horse">this</a></p>"#
                .into(),
            ..Default::default()
        };
        let files = post.all_files_including_direct();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "proton-AbC_123");
        assert_eq!(
            files[0].path,
            "https://drive.proton.me/urls/AbC_123#correct-horse"
        );
        let attachment = Attachment::new(&cfg, &files[0]).unwrap();
        assert_eq!(attachment.kind, MediaKind::Video);
        assert_eq!(
            attachment.provider,
            crate::infra::providers::MediaProvider::Proton
        );
    }

    #[test]
    fn marks_external_provider_attachments_as_resolving() {
        let cfg = crate::shared::config::PawchiveConfig::default();
        let cases = [
            (
                "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30",
                true,
            ),
            (
                "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ",
                true,
            ),
            ("https://drive.proton.me/urls/abc#password", true),
            (
                "https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view",
                true,
            ),
            ("https://cdn.example.com/clip.mp4", false),
            ("/aa/bb/clip.mp4", false),
        ];
        for (url, resolving) in cases {
            let file = FileRef {
                name: "file".into(),
                path: url.into(),
                ..Default::default()
            };
            let attachment = Attachment::new(&cfg, &file).unwrap();
            assert_eq!(attachment.resolving, resolving, "{url}");
        }
    }

    #[test]
    fn prefers_the_real_path_extension_for_media_kind() {
        let file = FileRef {
            name: "Tetoween ESP.mp4".into(),
            path: "/aa/bb/cover.jpg".into(),
            ..Default::default()
        };
        assert_eq!(media_kind_for_file(&file), MediaKind::Image);
        let video = FileRef {
            name: "cover.jpg".into(),
            path: "/aa/bb/clip.mp4".into(),
            ..Default::default()
        };
        assert_eq!(media_kind_for_file(&video), MediaKind::Video);
    }

    #[test]
    fn prefers_public_temp_media_urls() {
        let cfg = crate::shared::config::PawchiveConfig::default();
        let file = FileRef {
            name: "clip.mp4".into(),
            path: "/cc/dd/clip.mp4".into(),
            preview_only: Some(true),
            extra: serde_json::from_value(serde_json::json!({
                "temp_url": "https://cdn.example.com/files/clip.mp4?token=abc"
            }))
            .unwrap(),
            ..Default::default()
        };
        let attachment = Attachment::new(&cfg, &file).unwrap();
        assert_eq!(
            attachment.url,
            "https://cdn.example.com/files/clip.mp4?token=abc"
        );
        assert_eq!(attachment.path, "/cc/dd/clip.mp4");
        assert_eq!(attachment.kind, MediaKind::Video);
        assert!(!attachment.preview_only);
    }

    #[test]
    fn includes_deferred_attachments_without_paths() {
        use crate::shared::config::PawchiveConfig;

        let cfg = PawchiveConfig::default();
        let post: Post = serde_json::from_value(serde_json::json!({
            "id": "172858951",
            "user": "186745382",
            "service": "patreon",
            "title": "BTS 5th Muster",
            "file": {
                "name": "thumbnail.jpg",
                "path": "/7a/bc/thumbnail.jpg",
                "preview_only": true
            },
            "attachments": [{
                "name": "767687094.mp4",
                "deferred": true,
                "temp_url": "https://t1.pawchive.pw/v/hash/master.m3u8?e=1&s=abc",
                "temp_download_url": "https://t1.pawchive.pw/d/hash/767687094.mp4?e=1&s=xyz",
                "temp_expires": "2026-11-30T00:00:00+00:00"
            }]
        }))
        .unwrap();

        assert_eq!(post.all_files().len(), 2);

        let attachment = Attachment::new(&cfg, post.attachments.first().unwrap()).unwrap();
        assert_eq!(attachment.kind, MediaKind::Video);
        assert_eq!(attachment.name, "767687094.mp4");
        assert_eq!(attachment.path, "/d/hash/767687094.mp4");
        assert_eq!(
            attachment.url,
            "https://t1.pawchive.pw/v/hash/master.m3u8?e=1&s=abc"
        );
        assert_eq!(
            attachment.download_url,
            "https://t1.pawchive.pw/d/hash/767687094.mp4?e=1&s=xyz"
        );
        assert!(!attachment.preview_only);

        let summary = PostSummary::from_post(&cfg, &post, None);
        assert_eq!(summary.attachment_count, 2);
        assert!(summary.media_kinds.contains(&MediaKind::Video));
    }

    #[test]
    fn counts_deferred_attachments_in_list_summaries() {
        use crate::shared::config::PawchiveConfig;

        let cfg = PawchiveConfig::default();
        // Search/list responses omit the signed URLs; only `deferred` is set.
        let post: Post = serde_json::from_value(serde_json::json!({
            "id": "172858951",
            "user": "186745382",
            "service": "patreon",
            "title": "BTS 5th Muster",
            "file": {
                "name": "thumbnail.jpg",
                "path": "/7a/bc/thumbnail.jpg",
                "preview_only": true
            },
            "attachments": [{
                "name": "767687094.mp4",
                "deferred": true
            }]
        }))
        .unwrap();

        let summary = PostSummary::from_post(&cfg, &post, None);
        assert_eq!(summary.attachment_count, 2);
        assert!(summary.media_kinds.contains(&MediaKind::Video));
        // Without a signed URL the attachment cannot be built for playback.
        assert!(Attachment::new(&cfg, post.attachments.first().unwrap()).is_none());
    }

    #[test]
    fn builds_summaries_and_attachments() {
        let cfg = crate::shared::config::PawchiveConfig::default();
        let post = Post {
            id: "1".into(),
            service: "fanbox".into(),
            user: "2".into(),
            title: "  ".into(),
            content: "<p>Hello <b>world</b></p>".into(),
            file: Some(FileRef {
                name: "cover.png".into(),
                path: "/aa/bb/cover.png".into(),
                ..Default::default()
            }),
            attachments: vec![FileRef {
                name: "clip.mp4".into(),
                path: "/cc/dd/clip.mp4".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let summary = PostSummary::from_post(&cfg, &post, Some("Artist".into()));
        assert_eq!(summary.title, "Untitled post");
        assert_eq!(summary.attachment_count, 2);
        assert_eq!(summary.excerpt, "Hello world");
        assert!(summary
            .thumbnail_url
            .unwrap()
            .contains("/thumbnail/data/aa/bb"));
        assert!(summary.media_kinds.contains(&MediaKind::Video));

        let attachment = Attachment::new(&cfg, post.attachments.first().unwrap()).unwrap();
        assert_eq!(attachment.kind, MediaKind::Video);
        assert_eq!(
            attachment.url,
            "https://file.pawchive.pw/data/cc/dd/clip.mp4"
        );
        assert!(attachment.thumbnail_url.is_none());
    }
}
