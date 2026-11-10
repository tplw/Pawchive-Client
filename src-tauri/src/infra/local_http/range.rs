pub(super) fn is_not_modified(request: &str, etag: &str) -> bool {
    let has_range = request
        .lines()
        .any(|line| line.to_ascii_lowercase().starts_with("range:"));
    !has_range
        && request
            .lines()
            .find_map(|line| {
                line.split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("if-none-match"))
                    .map(|(_, value)| value.trim() == etag)
            })
            .unwrap_or(false)
}

pub(super) fn parse_range(request: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    for line in request.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if !name.eq_ignore_ascii_case("range") {
            continue;
        }
        let spec = value.trim().strip_prefix("bytes=")?;
        let (start, end) = spec.split_once('-')?;
        if start.trim().is_empty() {
            let suffix = end.trim().parse::<u64>().ok()?;
            if suffix == 0 {
                return None;
            }
            return Some((length.saturating_sub(suffix), length - 1));
        }
        let start = start.trim().parse::<u64>().ok()?;
        if start >= length {
            return None;
        }
        let end = if end.trim().is_empty() {
            length - 1
        } else {
            end.trim().parse::<u64>().ok()?
        };
        if end < start {
            return None;
        }
        return Some((start, end.min(length - 1)));
    }
    None
}

/// Parse an upstream `Content-Range: bytes start-end/total` header.
pub(super) fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let value = value.trim().strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((
        start.trim().parse().ok()?,
        end.trim().parse().ok()?,
        total.trim().parse().ok()?,
    ))
}
