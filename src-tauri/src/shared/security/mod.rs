mod filename;
mod html;
mod url;
mod validate;

pub use crate::shared::media_kind::{file_extension, media_kind_for};
pub use filename::*;
pub use html::*;
pub use url::*;
pub use validate::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::media_kind::MediaKind;
    use std::net::Ipv4Addr;

    #[test]
    fn accepts_public_external_media_but_rejects_private_hosts() {
        assert!(validate_media_remote_url("https://cdn.example.com/video.mp4").is_ok());
        assert!(validate_media_remote_url("http://cdn.example.com/video.mp4").is_err());
        assert!(validate_media_remote_url("https://127.0.0.1/video.mp4").is_err());
        assert!(validate_media_remote_url("https://192.168.1.2/video.mp4").is_err());
        assert!(validate_media_remote_url("https://user:pass@example.com/video.mp4").is_err());
    }

    #[test]
    fn rejects_credentials_in_urls() {
        assert!(validate_media_remote_url("https://user:pass@pawchive.pw/x").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("http://localhost:8080").is_err());
        assert!(validate_external_url("https://example.com/post").is_ok());
    }

    #[test]
    fn rejects_traversal_paths() {
        assert!(validate_relative_path("/ab/cd/file.mp4").is_ok());
        assert!(validate_relative_path("/ab/../../etc/passwd").is_err());
        assert!(validate_relative_path("https://evil/x").is_err());
        assert!(validate_relative_path("ab/cd").is_err());
    }

    #[test]
    fn sanitizes_script_content() {
        let dirty = r#"<p onclick="steal()">hi<script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="http://evil/x.png"></p>"#;
        let clean = sanitize_html(dirty);
        assert!(!clean.contains("<script"));
        assert!(!clean.contains("onclick"));
        assert!(!clean.contains("javascript:"));
        assert!(!clean.contains("http://evil"));
        assert!(clean.contains("<p>"));
        assert!(clean.contains("hi"));
    }

    #[test]
    fn rejects_private_ipv6_and_legacy_ipv4_hosts() {
        assert!(validate_media_remote_url("https://[::1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[::ffff:127.0.0.1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[64:ff9b::7f00:1]/video.mp4").is_err());
        assert!(validate_external_url("http://240.0.0.1/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[fe80::1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[fd00::1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_media_remote_url("https://localhost./video.mp4").is_err());
        assert!(validate_media_remote_url("https://service.localhost/video.mp4").is_err());
        assert!(validate_media_remote_url("https://2130706433/video.mp4").is_err());
        assert!(validate_media_remote_url("https://0x7f000001/video.mp4").is_err());
        assert!(validate_external_url("http://169.254.169.254/latest/meta-data").is_err());
    }

    #[test]
    fn parses_legacy_ipv4_spellings() {
        assert_eq!(
            parse_legacy_ipv4("2130706433"),
            Some(Ipv4Addr::new(127, 0, 0, 1))
        );
        assert_eq!(
            parse_legacy_ipv4("0x7f000001"),
            Some(Ipv4Addr::new(127, 0, 0, 1))
        );
        assert_eq!(
            parse_legacy_ipv4("0177.0.0.1"),
            Some(Ipv4Addr::new(127, 0, 0, 1))
        );
        assert_eq!(parse_legacy_ipv4("example.com"), None);
    }

    #[test]
    fn classifies_non_public_addresses() {
        assert!(is_non_public_ip("127.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("10.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("100.64.0.1".parse().unwrap()));
        assert!(is_non_public_ip("169.254.1.1".parse().unwrap()));
        assert!(is_non_public_ip("::1".parse().unwrap()));
        assert!(is_non_public_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("fe80::1".parse().unwrap()));
        assert!(is_non_public_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("::127.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("64:ff9b::7f00:1".parse().unwrap()));
        assert!(is_non_public_ip("240.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("198.18.0.1".parse().unwrap()));
        assert!(!is_non_public_ip("1.1.1.1".parse().unwrap()));
        assert!(!is_non_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn makes_safe_file_names() {
        assert_eq!(safe_filename("../../etc/passwd"), "passwd");
        assert_eq!(safe_filename("a/b\\c.mp4"), "c.mp4");
        assert_eq!(safe_filename(".."), "download");
        assert_eq!(safe_filename(""), "download");
        assert_eq!(safe_filename("nul\0byte.mp3"), "nulbyte.mp3");
        assert_eq!(safe_filename("CON"), "_CON");
        assert_eq!(safe_filename("con.txt"), "_con.txt");
        assert_eq!(safe_filename("COM1.mp3"), "_COM1.mp3");
        assert_eq!(safe_filename("report."), "report");
        assert_eq!(safe_filename("report. "), "report");
    }

    #[test]
    fn detects_media_kinds() {
        assert_eq!(media_kind_for("cover.JPG"), MediaKind::Image);
        assert_eq!(media_kind_for("clip.mp4"), MediaKind::Video);
        assert_eq!(media_kind_for("song.flac"), MediaKind::Audio);
        assert_eq!(media_kind_for("book.pdf"), MediaKind::Document);
        assert_eq!(media_kind_for("archive.xyz"), MediaKind::Other);
    }

    #[test]
    fn validates_search_and_offsets() {
        assert!(validate_search_query("ab").is_err());
        assert!(validate_search_query("abc").is_ok());
        assert!(validate_offset(25).is_err());
        assert!(validate_offset(50).is_ok());
        assert!(validate_offset(-50).is_err());
    }
}
