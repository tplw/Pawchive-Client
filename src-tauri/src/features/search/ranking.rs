use crate::shared::models::PostSummary;

/// Relevance is computed locally because the archive does not expose a score.
pub(crate) fn score(post: &PostSummary, lower: &str) -> i64 {
    let mut value = 0;
    if post.title.to_lowercase().contains(lower) {
        value += 10;
    }
    if post.excerpt.to_lowercase().contains(lower) {
        value += 3;
    }
    if post
        .creator_name
        .as_deref()
        .map(|name| name.to_lowercase().contains(lower))
        .unwrap_or(false)
    {
        value += 2;
    }
    value
}

pub(crate) fn sort_results(posts: &mut [PostSummary], sort: &str, lower: &str) {
    match sort {
        "oldest" => posts.sort_by_key(|post| post.published.unwrap_or(i64::MAX)),
        "creator" => posts.sort_by(|a, b| {
            a.creator_name
                .clone()
                .unwrap_or_default()
                .to_lowercase()
                .cmp(&b.creator_name.clone().unwrap_or_default().to_lowercase())
                .then_with(|| b.published.cmp(&a.published))
        }),
        "relevance" => posts.sort_by(|a, b| {
            score(b, lower)
                .cmp(&score(a, lower))
                .then_with(|| b.published.cmp(&a.published))
        }),
        _ => posts.sort_by_key(|post| std::cmp::Reverse(post.published)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(title: &str, creator: &str, published: i64) -> PostSummary {
        PostSummary {
            title: title.into(),
            creator_name: Some(creator.into()),
            published: Some(published),
            ..Default::default()
        }
    }

    #[test]
    fn relevance_prefers_title_matches_then_recency() {
        let mut posts = vec![
            post("other", "cat creator", 10),
            post("cat video", "someone", 5),
            post("other", "someone", 20),
        ];
        sort_results(&mut posts, "relevance", "cat");
        assert_eq!(posts[0].title, "cat video");
        assert_eq!(posts[1].creator_name.as_deref(), Some("cat creator"));
    }

    #[test]
    fn oldest_sorts_by_publish_time() {
        let mut posts = vec![post("new", "a", 20), post("old", "b", 10)];
        sort_results(&mut posts, "oldest", "");
        assert_eq!(posts[0].published, Some(10));
    }

    #[test]
    fn creator_sorts_alphabetically_then_newest() {
        let mut posts = vec![
            post("z", "Beta", 10),
            post("a", "Alpha", 5),
            post("b", "Alpha", 8),
        ];
        sort_results(&mut posts, "creator", "");
        assert_eq!(
            posts
                .iter()
                .map(|post| post.title.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a", "z"]
        );
    }
}
