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

    builder.clean(raw).to_string()
}
