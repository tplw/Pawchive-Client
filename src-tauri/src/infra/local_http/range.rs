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

pub(super) enum ByteRange {
    Absent,
    Satisfiable(u64, u64),
    Unsatisfiable,
}

pub(super) fn parse_range(request: &str, length: u64) -> ByteRange {
    for line in request.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if !name.eq_ignore_ascii_case("range") {
            continue;
        }
        let Some(spec) = value.trim().strip_prefix("bytes=") else {
            return ByteRange::Absent;
        };
        let Some((start, end)) = spec.split_once('-') else {
            return ByteRange::Unsatisfiable;
        };
        if length == 0 {
            return ByteRange::Unsatisfiable;
        }
        if start.trim().is_empty() {
            let Ok(suffix) = end.trim().parse::<u64>() else {
                return ByteRange::Unsatisfiable;
            };
            if suffix == 0 {
                return ByteRange::Unsatisfiable;
            }
            return ByteRange::Satisfiable(length.saturating_sub(suffix), length - 1);
        }
        let Ok(start) = start.trim().parse::<u64>() else {
            return ByteRange::Unsatisfiable;
        };
        if start >= length {
            return ByteRange::Unsatisfiable;
        }
        let end = if end.trim().is_empty() {
            length - 1
        } else {
            let Ok(end) = end.trim().parse::<u64>() else {
                return ByteRange::Unsatisfiable;
            };
            end
        };
        if end < start {
            return ByteRange::Unsatisfiable;
        }
        return ByteRange::Satisfiable(start, end.min(length - 1));
    }
    ByteRange::Absent
}

/// Parse an upstream `Content-Range: bytes start-end/total` header.
pub(super) fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let value = value.trim().strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let start = start.trim().parse().ok()?;
    let end = end.trim().parse().ok()?;
    let total = total.trim().parse().ok()?;
    if start > end || end >= total {
        return None;
    }
    Some((start, end, total))
}
