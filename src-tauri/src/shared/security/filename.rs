use std::path::Path;

/// Produce a filename that cannot escape its destination directory.
pub fn safe_filename(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw).to_string();
    let mut out = String::with_capacity(base.len());
    for ch in base.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => out.push('_'),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    let trimmed = out
        .trim()
        .trim_start_matches('.')
        .trim_end_matches([' ', '.'])
        .trim();
    let mut name = if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    };
    if name.chars().count() > 180 {
        let ext = Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        let keep = 180usize.saturating_sub(ext.len() + 1);
        let stem: String = name.chars().take(keep).collect();
        name = if ext.is_empty() {
            stem
        } else {
            format!("{stem}.{ext}")
        };
    }
    if is_windows_reserved_name(&name) {
        name.insert(0, '_');
    }
    name
}

/// Windows refuses to create files whose base name is a DOS device name.
fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let bytes = stem.as_bytes();
    bytes.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && (b'1'..=b'9').contains(&bytes[3])
}
