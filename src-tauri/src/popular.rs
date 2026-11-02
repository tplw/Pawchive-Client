use crate::models::{strip_html, truncate, PostSummary};
use regex::Regex;
use std::sync::OnceLock;

fn article_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?s)<article\b([^>]*)>(.*?)</article>").expect("valid article regex")
    })
}

fn attr_re(name: &str) -> Regex {
    Regex::new(&format!(r#"{name}="([^"]*)""#)).expect("valid attribute regex")
}

fn one_re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid popular page regex")
}

/// Parse the server-rendered popular post cards. The page is the official
/// Pawchive popular page; the JSON API does not expose a popularity endpoint.
pub fn parse_popular_posts<F>(html: &str, creator_name: F) -> Vec<PostSummary>
where
    F: Fn(&str, &str) -> Option<String>,
{
    let article = article_re();
    let data_id = attr_re("data-id");
    let data_service = attr_re("data-service");
    let data_user = attr_re("data-user");
    let title_re = one_re(r#"(?s)<header\b[^>]*>(.*?)</header>"#);
    let image_re = one_re(r#"<img\b[^>]*\bsrc="([^"]+)""#);
    let time_re = one_re(r#"<time\b[^>]*\bdatetime="([^"]+)""#);
    let attachments_re = one_re(r"(\d+)\s+attachments?");
    let mut out = Vec::new();

    for caps in article.captures_iter(html) {
        let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        if !attrs.contains("post-card") {
            continue;
        }
        let Some(id) = data_id
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
        else {
            continue;
        };
        let Some(service) = data_service
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
        else {
            continue;
        };
        let Some(user) = data_user
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
        else {
            continue;
        };
        let body = caps.get(2).map(|m| m.as_str()).unwrap_or_default();
        let title = title_re
            .captures(body)
            .and_then(|c| c.get(1))
            .map(|m| truncate(&strip_html(m.as_str()), 240))
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "Untitled post".to_string());
        let thumbnail_url = image_re
            .captures(body)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        let published = time_re.captures(body).and_then(|c| c.get(1)).and_then(|m| {
            chrono::NaiveDateTime::parse_from_str(m.as_str(), "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|dt| dt.and_utc().timestamp())
        });
        let attachment_count = attachments_re
            .captures(body)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(0);
        let creator = creator_name(service, user);
        out.push(PostSummary {
            id: id.to_string(),
            service: service.to_string(),
            user: user.to_string(),
            creator_name: creator,
            title,
            excerpt: String::new(),
            published,
            added: published,
            thumbnail_url,
            attachment_count,
            media_kinds: Vec::new(),
            preview_state: None,
            has_full: None,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_popular_cards() {
        let html = r#"
        <article class="post-card post-card--preview" data-id="123" data-service="patreon" data-user="456">
          <a href="/patreon/user/456/post/123">
            <header class="post-card__header">A <b>great</b> post</header>
            <img class="post-card__image" src="https://img.pawchive.pw/thumbnail/data/aa/bb/x.jpg" alt="">
            <time datetime="2026-10-25 22:36:36">2026-10-25 22:36</time>
            <div>3 attachments<br>263 favorites</div>
          </a>
        </article>"#;
        let posts = parse_popular_posts(html, |service, user| {
            (service == "patreon" && user == "456").then(|| "Ada".to_string())
        });
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "123");
        assert_eq!(posts[0].title, "A great post");
        assert_eq!(posts[0].creator_name.as_deref(), Some("Ada"));
        assert_eq!(posts[0].attachment_count, 3);
        assert!(posts[0].thumbnail_url.is_some());
    }
}
