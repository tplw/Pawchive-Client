/// Sanitize creator-authored HTML before it reaches the webview.
pub fn sanitize_html(raw: &str) -> String {
    use ammonia::Builder;
    use std::collections::HashSet;

    let tags: HashSet<&str> = [
        "p",
        "br",
        "a",
        "span",
        "div",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "del",
        "blockquote",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "code",
        "pre",
        "hr",
        "img",
        "figure",
        "figcaption",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
        "sub",
        "sup",
        "small",
        "details",
        "summary",
    ]
    .into_iter()
    .collect();

    let mut attrs: std::collections::HashMap<&str, HashSet<&str>> =
        std::collections::HashMap::new();
    attrs.insert("a", ["href", "title", "target"].into_iter().collect());
    attrs.insert(
        "img",
        ["src", "alt", "title", "width", "height"]
            .into_iter()
            .collect(),
    );
    attrs.insert("td", ["colspan", "rowspan"].into_iter().collect());
    attrs.insert("th", ["colspan", "rowspan"].into_iter().collect());

    let mut builder = Builder::default();
    builder
        .tags(tags)
        .tag_attributes(attrs)
        .generic_attributes(HashSet::new())
        .url_schemes(["http", "https"].into_iter().collect())
        .link_rel(Some("noopener noreferrer nofollow"))
        .attribute_filter(|element, attribute, value| {
            if element == "a" && attribute == "target" {
                return Some("_blank".into());
            }
            if element == "img" && attribute == "src" {
                if value.starts_with("https://") {
                    return Some(value.into());
                }
                return None;
            }
            Some(value.into())
        });

    trim_leading_empty_blocks(&builder.clean(raw).to_string())
}

/// Remove empty spacer blocks at the start of post content. Some editors save
/// a run of empty paragraphs before the actual text, which otherwise renders
/// as a large blank area above the post.
fn trim_leading_empty_blocks(html: &str) -> String {
    let mut rest = html.trim_start();
    loop {
        if let Some(next) = strip_empty_block(rest, "p").or_else(|| strip_empty_block(rest, "div"))
        {
            rest = next.trim_start();
            continue;
        }
        let next = rest
            .strip_prefix("<br>")
            .or_else(|| rest.strip_prefix("<br/>"))
            .or_else(|| rest.strip_prefix("<br />"));
        if let Some(next) = next {
            rest = next.trim_start();
            continue;
        }
        return rest.to_string();
    }
}

fn strip_empty_block<'a>(input: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let inner = input.strip_prefix(&open)?;
    let end = inner.find(&close)?;
    if !is_empty_markup(&inner[..end]) {
        return None;
    }
    Some(&inner[end + close.len()..])
}

fn is_empty_markup(mut value: &str) -> bool {
    loop {
        value = value.trim_start();
        if value.is_empty() {
            return true;
        }
        if let Some(rest) = value.strip_prefix("&nbsp;") {
            value = rest;
            continue;
        }
        let next = value
            .strip_prefix("<br>")
            .or_else(|| value.strip_prefix("<br/>"))
            .or_else(|| value.strip_prefix("<br />"));
        match next {
            Some(rest) => value = rest,
            None => return false,
        }
    }
}
