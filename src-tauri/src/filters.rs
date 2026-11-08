use crate::models::{strip_html, AppSettings, Post, PostSummary};

/// Whether a creator is in the user's blocked list.
pub fn is_creator_blocked(service: &str, creator_id: &str, settings: &AppSettings) -> bool {
    settings.blocked_creators.iter().any(|blocked| {
        blocked.service.eq_ignore_ascii_case(service) && blocked.id.eq_ignore_ascii_case(creator_id)
    })
}

/// Whether a post should be hidden from browsing lists under the user's
/// content filters. Blocked creators are also hidden from direct post links.
pub fn is_hidden(post: &Post, creator_name: Option<&str>, settings: &AppSettings) -> bool {
    if is_creator_blocked(&post.service, &post.user, settings) {
        return true;
    }
    let mut haystack = String::new();
    haystack.push_str(&post.title);
    haystack.push(' ');
    haystack.push_str(&strip_html(&post.content));
    if let Some(substring) = &post.substring {
        haystack.push(' ');
        haystack.push_str(&strip_html(substring));
    }
    if let Some(name) = creator_name {
        haystack.push(' ');
        haystack.push_str(name);
    }
    for file in post.all_files_including_direct() {
        haystack.push(' ');
        haystack.push_str(&file.name);
        haystack.push(' ');
        haystack.push_str(&file.path);
    }
    let lower = haystack.to_lowercase();

    if settings.hide_ai_posts && looks_ai_generated(&lower) {
        return true;
    }
    if settings.hide_no_media && !has_media(post) {
        return true;
    }
    if settings.hide_unavailable_posts && post.is_unavailable() {
        return true;
    }
    settings
        .hidden_keywords
        .iter()
        .any(|keyword| !keyword.trim().is_empty() && lower.contains(&keyword.to_lowercase()))
}

fn has_media(post: &Post) -> bool {
    // Deferred markers without a path or signed URL are not real media; the
    // archive uses them for files that exceeded the size limit and were not
    // saved. Direct media and provider links are included in this list.
    post.all_files_including_direct()
        .iter()
        .any(|file| file.has_real_source())
        || value_has_content(&post.embed)
        || value_has_content(&post.poll)
}

fn value_has_content(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(_) => true,
        serde_json::Value::String(value) => !value.trim().is_empty(),
        serde_json::Value::Array(values) => !values.is_empty(),
        serde_json::Value::Object(map) => !map.is_empty(),
    }
}

/// The same content filters, applied to lightweight post summaries such as the
/// server-rendered Popular feed where the full post body is not available.
pub fn summary_is_hidden(post: &PostSummary, settings: &AppSettings) -> bool {
    if is_creator_blocked(&post.service, &post.user, settings) {
        return true;
    }
    let haystack = format!(
        "{} {} {}",
        post.title,
        post.excerpt,
        post.creator_name.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    if settings.hide_ai_posts && looks_ai_generated(&haystack) {
        return true;
    }
    if settings.hide_no_media {
        let has_media = post.attachment_count > 0
            || !post.media_kinds.is_empty()
            || post.thumbnail_url.is_some();
        if !has_media {
            return true;
        }
    }
    if settings.hide_unavailable_posts && post.unavailable {
        return true;
    }
    settings
        .hidden_keywords
        .iter()
        .any(|keyword| !keyword.trim().is_empty() && haystack.contains(&keyword.to_lowercase()))
}

fn looks_ai_generated(lower: &str) -> bool {
    const STRONG_MARKERS: &[&str] = &[
        "ai art",
        "ai-art",
        "ai generated",
        "ai-generated",
        "ai generation",
        "ai-assisted",
        "ai assisted",
        "generative ai",
        "generated with ai",
        "made with ai",
        "midjourney",
        "stable diffusion",
        "stable-diffusion",
        "novelai",
        "dall-e",
        "dalle",
        "sdxl",
        "comfyui",
        "controlnet",
        "img2img",
        "txt2img",
        "text-to-image",
        "text to image",
        "flux.1",
        "flux1",
        "nijijourney",
        "synthetic media",
        "aiイラスト",
        "ai画像",
        "ai作品",
        "ai生成",
    ];
    if STRONG_MARKERS.iter().any(|phrase| lower.contains(phrase)) {
        return true;
    }

    let tokens: Vec<&str> = lower
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.iter().any(|token| {
        matches!(
            *token,
            "midjourney"
                | "novelai"
                | "sdxl"
                | "comfyui"
                | "controlnet"
                | "img2img"
                | "txt2img"
                | "automatic1111"
                | "nijijourney"
        )
    }) {
        return true;
    }

    // A bare "AI" token is common in names and initials. Only treat it as an
    // AI marker when the surrounding text also contains art-generation
    // vocabulary, which reduces false positives.
    let has_ai = tokens.contains(&"ai");
    let has_context = tokens.iter().any(|token| {
        matches!(
            *token,
            "art"
                | "image"
                | "images"
                | "illustration"
                | "render"
                | "rendered"
                | "generated"
                | "generation"
                | "prompt"
                | "prompts"
                | "model"
                | "models"
                | "作品"
                | "イラスト"
                | "画像"
                | "生成"
        )
    });
    has_ai && has_context
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BlockedCreator, FileRef, PostSummary};

    fn summary(title: &str) -> PostSummary {
        PostSummary {
            id: "1".into(),
            service: "patreon".into(),
            user: "42".into(),
            title: title.into(),
            ..Default::default()
        }
    }

    fn post(title: &str, content: &str) -> Post {
        Post {
            title: title.into(),
            content: content.into(),
            ..Default::default()
        }
    }

    #[test]
    fn hides_ai_markers_and_custom_keywords() {
        let ai_settings = AppSettings {
            hide_ai_posts: true,
            ..Default::default()
        };
        assert!(is_hidden(&post("My AI art", ""), None, &ai_settings));
        assert!(is_hidden(&post("A Midjourney set", ""), None, &ai_settings));
        assert!(!is_hidden(
            &post("Waiting for rain", ""),
            None,
            &ai_settings
        ));
        assert!(!is_hidden(
            &post("Ai's birthday portrait", ""),
            None,
            &ai_settings
        ));
        assert!(is_hidden(&post("Made with AI", ""), None, &ai_settings));

        let no_media_settings = AppSettings {
            hide_no_media: true,
            ..Default::default()
        };
        assert!(is_hidden(
            &post("A text-only update", ""),
            None,
            &no_media_settings
        ));
        assert!(is_hidden(
            &post(
                "A post with a link",
                "<p><a href=\"https://example.com\">link</a></p>"
            ),
            None,
            &no_media_settings
        ));
        let mut empty_embed = post("A text post", "");
        empty_embed.embed = serde_json::json!({});
        assert!(is_hidden(&empty_embed, None, &no_media_settings));
        let mut empty_poll = post("Another text post", "");
        empty_poll.poll = serde_json::json!({});
        assert!(is_hidden(&empty_poll, None, &no_media_settings));
        let mut media_post = post("A media post", "");
        media_post.attachments = vec![FileRef {
            name: "image.jpg".into(),
            path: "/aa/bb/image.jpg".into(),
            ..Default::default()
        }];
        assert!(!is_hidden(&media_post, None, &no_media_settings));

        let cloud_post = post(
            "A cloud media post",
            "<p><a href=\"https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30\">video</a></p>",
        );
        assert!(!is_hidden(&cloud_post, None, &no_media_settings));

        let mut dropped_media = post("A post with a dropped file", "");
        dropped_media.attachments = vec![FileRef {
            name: "episode.wav".into(),
            path: String::new(),
            extra: [("deferred".to_string(), serde_json::Value::Bool(true))]
                .into_iter()
                .collect(),
            ..Default::default()
        }];
        assert!(is_hidden(&dropped_media, None, &no_media_settings));

        let keyword_settings = AppSettings {
            hidden_keywords: vec!["spoiler".into()],
            ..Default::default()
        };
        assert!(is_hidden(
            &post("A spoiler post", ""),
            None,
            &keyword_settings
        ));
        assert!(is_hidden(
            &post("A post", "<p>contains SPOILER text</p>"),
            None,
            &keyword_settings
        ));
        assert!(!is_hidden(
            &post("A normal post", ""),
            None,
            &keyword_settings
        ));
    }

    #[test]
    fn hides_blocked_creators_everywhere() {
        let settings = AppSettings {
            blocked_creators: vec![BlockedCreator {
                service: "patreon".into(),
                id: "42".into(),
                name: "Blocked Artist".into(),
            }],
            ..Default::default()
        };
        let mut blocked = post("A normal post", "");
        blocked.service = "patreon".into();
        blocked.user = "42".into();
        assert!(is_hidden(&blocked, None, &settings));

        let allowed = PostSummary {
            user: "7".into(),
            ..summary("A normal post")
        };
        assert!(!summary_is_hidden(&allowed, &settings));

        let blocked_summary = PostSummary {
            service: "patreon".into(),
            user: "42".into(),
            ..summary("A normal post")
        };
        assert!(summary_is_hidden(&blocked_summary, &settings));
    }

    #[test]
    fn applies_content_filters_to_summaries() {
        let no_media = AppSettings {
            hide_no_media: true,
            ..Default::default()
        };
        assert!(summary_is_hidden(&summary("Text only"), &no_media));
        let mut with_thumbnail = summary("Text only");
        with_thumbnail.thumbnail_url = Some("https://img.pawchive.pw/x.png".into());
        assert!(!summary_is_hidden(&with_thumbnail, &no_media));
        let mut with_attachment = summary("Text only");
        with_attachment.attachment_count = 1;
        assert!(!summary_is_hidden(&with_attachment, &no_media));

        let keywords = AppSettings {
            hidden_keywords: vec!["spoiler".into()],
            ..Default::default()
        };
        assert!(summary_is_hidden(&summary("A spoiler alert"), &keywords));

        let ai = AppSettings {
            hide_ai_posts: true,
            ..Default::default()
        };
        assert!(summary_is_hidden(&summary("My AI art set"), &ai));

        let unavailable = AppSettings {
            hide_unavailable_posts: true,
            ..Default::default()
        };
        let mut missing = summary("Not archived");
        missing.unavailable = true;
        assert!(summary_is_hidden(&missing, &unavailable));
    }

    #[test]
    fn hides_unavailable_posts_unless_a_non_image_attachment_survives() {
        let settings = AppSettings {
            hide_unavailable_posts: true,
            ..Default::default()
        };

        let mut over_limit = post("An over-limit post", "");
        over_limit.has_full = Some(false);
        over_limit.attachments = vec![FileRef {
            name: "image.png".into(),
            path: "/aa/bb/image.png".into(),
            preview_only: Some(true),
            ..Default::default()
        }];
        assert!(is_hidden(&over_limit, None, &settings));

        let mut mixed = post("An over-limit post with a zip", "");
        mixed.has_full = Some(false);
        mixed.attachments = vec![
            FileRef {
                name: "image.png".into(),
                path: "/aa/bb/image.png".into(),
                preview_only: Some(true),
                ..Default::default()
            },
            FileRef {
                name: "set.zip".into(),
                path: "/cc/dd/set.zip".into(),
                ..Default::default()
            },
        ];
        assert!(!is_hidden(&mixed, None, &settings));

        let mut deferred_zip = post("An over-limit post with a temporary zip", "");
        deferred_zip.has_full = Some(false);
        deferred_zip.attachments = vec![
            FileRef {
                name: "image.png".into(),
                path: "/aa/bb/image.png".into(),
                preview_only: Some(true),
                ..Default::default()
            },
            FileRef {
                name: "set.zip".into(),
                path: String::new(),
                extra: [
                    ("deferred".to_string(), serde_json::Value::Bool(true)),
                    (
                        "temp_url".to_string(),
                        serde_json::Value::String("https://cdn.example.com/set.zip".into()),
                    ),
                ]
                .into_iter()
                .collect(),
                ..Default::default()
            },
        ];
        assert!(!is_hidden(&deferred_zip, None, &settings));

        let mut deferred_audio = post("An over-limit post with temporary audio", "");
        deferred_audio.has_full = Some(false);
        deferred_audio.attachments = vec![FileRef {
            name: "episode.wav".into(),
            path: String::new(),
            extra: [(
                "temp_url".to_string(),
                serde_json::Value::String("https://cdn.example.com/episode.wav".into()),
            )]
            .into_iter()
            .collect(),
            ..Default::default()
        }];
        assert!(!is_hidden(&deferred_audio, None, &settings));

        let mut dropped_audio = post("An over-limit post with a dropped audio file", "");
        dropped_audio.has_full = Some(false);
        dropped_audio.attachments = vec![FileRef {
            name: "episode.wav".into(),
            path: String::new(),
            extra: [("deferred".to_string(), serde_json::Value::Bool(true))]
                .into_iter()
                .collect(),
            ..Default::default()
        }];
        assert!(is_hidden(&dropped_audio, None, &settings));

        let mut primary_audio = post("An over-limit post with a primary audio file", "");
        primary_audio.has_full = Some(false);
        primary_audio.file = Some(FileRef {
            name: "track.mp3".into(),
            path: "/aa/bb/track.mp3".into(),
            ..Default::default()
        });
        assert!(!is_hidden(&primary_audio, None, &settings));

        let preview: Post = serde_json::from_value(serde_json::json!({
            "title": "A Kemono preview",
            "origin": "kemono"
        }))
        .unwrap();
        assert!(is_hidden(&preview, None, &settings));

        let complete = post("A complete post", "");
        assert!(!is_hidden(&complete, None, &settings));
    }

    #[test]
    fn checks_creator_names_and_attachment_names() {
        let settings = AppSettings {
            hidden_keywords: vec!["commission".into()],
            ..Default::default()
        };
        let mut item = post("A post", "");
        item.attachments = vec![FileRef {
            name: "commission-sheet.png".into(),
            path: "/aa/bb/commission-sheet.png".into(),
            ..Default::default()
        }];
        assert!(is_hidden(&item, Some("Commission Artist"), &settings));
    }
}
