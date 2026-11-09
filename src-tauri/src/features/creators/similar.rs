use crate::shared::models::{strip_html, CreatorSummary};
use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

fn anchor_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<a\b([^>]*)>(.*?)</a>").expect("valid anchor regex"))
}

fn attr_re(name: &str) -> Regex {
    Regex::new(&format!(r#"{name}="([^"]*)""#)).expect("valid attribute regex")
}

fn name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?s)<div\b[^>]*class="[^"]*user-card__name[^"]*"[^>]*>(.*?)</div>"#)
            .expect("valid user card name regex")
    })
}

/// Parse the server-rendered "Similar Creators" page. The archive does not
/// expose recommendations as JSON, so we read the same cards the website uses.
pub fn parse_similar_creators(html: &str) -> Vec<CreatorSummary> {
    let anchor = anchor_re();
    let data_id = attr_re("data-id");
    let data_service = attr_re("data-service");
    let name = name_re();
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for caps in anchor.captures_iter(html) {
        let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        if !attrs.contains("user-card") {
            continue;
        }
        let Some(id) = data_id
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim())
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        let Some(service) = data_service
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim())
            .filter(|service| !service.is_empty())
        else {
            continue;
        };
        if !seen.insert((service.to_string(), id.to_string())) {
            continue;
        }
        let body = caps.get(2).map(|m| m.as_str()).unwrap_or_default();
        let creator_name = name
            .captures(body)
            .and_then(|c| c.get(1))
            .map(|m| strip_html(m.as_str()))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| id.to_string());
        out.push(CreatorSummary {
            id: id.to_string(),
            name: creator_name,
            service: service.to_string(),
            ..Default::default()
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_similar_creator_cards() {
        let html = r#"
        <div class="card-list__items">
          <a
            href="/patreon/user/176059643"
            class="user-card "
            data-id="176059643"
            data-service="patreon"
          >
            <div class="user-card__info">
              <div class="user-card__name">Daioo</div>
            </div>
          </a>
          <a class="user-card" data-service="fanbox" data-id="456">
            <div class="user-card__name"><b>Ada</b> &amp; friends</div>
          </a>
          <a href="/patreon/user/176059643" class="user-card" data-id="176059643" data-service="patreon">
            <div class="user-card__name">Daioo</div>
          </a>
          <a href="/patreon/user/999" class="post-card" data-id="999" data-service="patreon">
            <div class="user-card__name">Not a creator</div>
          </a>
        </div>"#;

        let creators = parse_similar_creators(html);
        assert_eq!(creators.len(), 2);
        assert_eq!(creators[0].id, "176059643");
        assert_eq!(creators[0].name, "Daioo");
        assert_eq!(creators[0].service, "patreon");
        assert_eq!(creators[1].id, "456");
        assert_eq!(creators[1].name, "Ada & friends");
        assert_eq!(creators[1].service, "fanbox");
    }

    #[test]
    fn returns_empty_when_no_user_cards_are_present() {
        assert!(parse_similar_creators("<html><body>No recommendations</body></html>").is_empty());
    }
}
