use serde::{Deserialize, Serialize};

/// Where an attachment is actually served from.
///
/// Pawchive-hosted files are the default. Posts also embed links to external
/// file hosts, and the UI shows the host so a creator's alternate download
/// links are recognisable at a glance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaProvider {
    #[default]
    Pawchive,
    Mega,
    GoogleDrive,
    Dropbox,
    Gofile,
    External,
}

impl MediaProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pawchive => "pawchive",
            Self::Mega => "mega",
            Self::GoogleDrive => "googleDrive",
            Self::Dropbox => "dropbox",
            Self::Gofile => "gofile",
            Self::External => "external",
        }
    }
}

/// Classify a media URL by its host. Relative archive paths are Pawchive
/// files, and unknown HTTPS hosts are labelled as external.
pub fn provider_for_url(raw: &str) -> MediaProvider {
    let raw = raw.trim();
    if raw.is_empty() || (!raw.starts_with("https://") && !raw.starts_with("http://")) {
        return MediaProvider::Pawchive;
    }
    let Ok(url) = url::Url::parse(raw) else {
        return MediaProvider::External;
    };
    provider_for_host(url.host_str().unwrap_or_default())
}

pub fn provider_for_host(host: &str) -> MediaProvider {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    match host.as_str() {
        "mega.nz" | "www.mega.nz" | "mega.co.nz" | "www.mega.co.nz" | "mega.io" | "www.mega.io" => {
            MediaProvider::Mega
        }
        "drive.google.com" | "drive.usercontent.google.com" | "docs.google.com" => {
            MediaProvider::GoogleDrive
        }
        _ if host == "pawchive.pw" || host.ends_with(".pawchive.pw") => MediaProvider::Pawchive,
        _ if host == "dropbox.com"
            || host.ends_with(".dropbox.com")
            || host.ends_with(".dropboxusercontent.com") =>
        {
            MediaProvider::Dropbox
        }
        _ if host == "gofile.io" || host.ends_with(".gofile.io") => MediaProvider::Gofile,
        _ => MediaProvider::External,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_archive_and_provider_hosts() {
        assert_eq!(
            provider_for_url("https://file.pawchive.pw/data/aa/clip.mp4"),
            MediaProvider::Pawchive
        );
        assert_eq!(provider_for_url("aa/bb/clip.mp4"), MediaProvider::Pawchive);
        assert_eq!(
            provider_for_url("https://mega.nz/file/abc#def"),
            MediaProvider::Mega
        );
        assert_eq!(
            provider_for_url("https://drive.google.com/file/d/abc/view"),
            MediaProvider::GoogleDrive
        );
        assert_eq!(
            provider_for_url("https://www.dropbox.com/s/abc/clip.mp4?dl=0"),
            MediaProvider::Dropbox
        );
        assert_eq!(
            provider_for_url("https://gofile.io/d/abc"),
            MediaProvider::Gofile
        );
        assert_eq!(
            provider_for_url("https://cdn.example.com/clip.mp4"),
            MediaProvider::External
        );
    }
}
