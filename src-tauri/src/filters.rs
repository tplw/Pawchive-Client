use crate::models::{strip_html, AppSettings, Post};

/// Whether a post should be hidden from browsing lists under the user's
/// content filters. Direct post links remain available.
pub fn is_hidden(post: &Post, creator_name: Option<&str>, settings: &AppSettings) -> bool {
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
    if settings.hide_no_media && !has_media_or_link(post) {
        return true;
    }
    settings
        .hidden_keywords
        .iter()
        .any(|keyword| !keyword.trim().is_empty() && lower.contains(&keyword.to_lowercase()))
}

fn has_media_or_link(post: &Post) -> bool {
    if !post.all_files_including_direct().is_empty()
        || !post.embed.is_null()
        || !post.poll.is_null()
    {
        return true;
    }
    let content = post.content.to_ascii_lowercase();
    content.contains("http://")
        || content.contains("https://")
        || content.contains("href=")
        || content.contains("www.")
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
    use crate::models::FileRef;

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
        assert!(!is_hidden(
            &post(
                "A post with a link",
                "<p><a href=\"https://example.com\">link</a></p>"
            ),
            None,
            &no_media_settings
        ));
        let mut media_post = post("A media post", "");
        media_post.attachments = vec![FileRef {
            name: "image.jpg".into(),
            path: "/aa/bb/image.jpg".into(),
            ..Default::default()
        }];
        assert!(!is_hidden(&media_post, None, &no_media_settings));

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
