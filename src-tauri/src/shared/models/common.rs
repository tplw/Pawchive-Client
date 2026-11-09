use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// Accepts the several timestamp shapes the archive uses: Unix seconds as a
/// number, numeric strings, and ISO-8601 strings with or without an offset.
pub fn parse_timestamp(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                return None;
            }
            if let Ok(n) = s.parse::<i64>() {
                return Some(n);
            }
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                return Some(dt.timestamp());
            }
            for fmt in [
                "%Y-%m-%dT%H:%M:%S%.f",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S%.f",
                "%Y-%m-%d",
            ] {
                if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
                    return Some(dt.and_utc().timestamp());
                }
                if fmt == "%Y-%m-%d" {
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(s, fmt) {
                        return Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp());
                    }
                }
            }
            None
        }
        _ => None,
    }
}

pub(crate) fn vec_or_empty<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn flex_ts<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    Ok(parse_timestamp(&value))
}

/// Some archive records use JSON null where the schema says string. Treat
/// null and missing values as an empty string so one malformed field cannot
/// reject an otherwise usable post or comment.
pub(crate) fn string_or_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn bool_or_default<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<bool>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn i64_or_default<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<i64>::deserialize(deserializer)?.unwrap_or_default())
}

pub fn strip_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn truncate(value: &str, max: usize) -> String {
    let mut chars = value.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

pub fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}
