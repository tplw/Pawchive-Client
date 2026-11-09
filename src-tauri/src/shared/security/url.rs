use crate::shared::error::{AppError, AppResult};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use url::Url;

/// Media URLs may live on a provider other than Pawchive's own file host. The
/// client is still HTTPS-only and rejects local/private addresses.
pub fn validate_media_remote_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw)?;
    if url.scheme() != "https" {
        return Err(AppError::UnsafeUrl(
            "only HTTPS media URLs are allowed".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::UnsafeUrl("URLs may not embed credentials".into()));
    }
    if url.port_or_known_default() != Some(443) {
        return Err(AppError::UnsafeUrl(
            "only the default HTTPS port is allowed".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::UnsafeUrl("URL has no host".into()))?
        .to_ascii_lowercase();
    if is_local_or_private_host(&host) {
        return Err(AppError::UnsafeUrl(
            "local and private media hosts are not allowed".into(),
        ));
    }
    Ok(url)
}

/// A short network error description that never includes the request URL.
/// Media URLs often contain expiring signatures, so they should not end up in
/// download records, logs or toasts.
pub fn network_error_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "the media request timed out".to_string()
    } else if error.is_connect() {
        "could not connect to the media host".to_string()
    } else if error.is_body() {
        "the media response was interrupted".to_string()
    } else {
        let text = error.to_string();
        text.split(" for url (").next().unwrap_or(&text).to_string()
    }
}

pub(super) fn is_local_or_private_host(host: &str) -> bool {
    let host = host
        .trim()
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        return true;
    }
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    if host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".home.arpa")
        || host == "metadata"
    {
        return true;
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        return is_non_public_ip(address);
    }
    // The URL parser accepts legacy numeric IPv4 spellings such as
    // `2130706433` or `0x7f000001`. Reject those even though they are not
    // standard dotted-quad addresses.
    if let Some(address) = parse_legacy_ipv4(&host) {
        return is_non_public_ip(IpAddr::V4(address));
    }
    false
}

/// Return true for every address that could reach the local machine, the
/// local network, a cloud metadata service or another non-public target.
pub(super) fn is_non_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast()
                || octets[0] == 0
                // Carrier-grade NAT (100.64.0.0/10).
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                // Reserved (240.0.0.0/4) and the limited broadcast address.
                || octets[0] >= 240
                // Benchmarking (198.18.0.0/15).
                || (octets[0] == 198 && (octets[1] & 0xfe) == 18)
                // IETF protocol assignments (192.0.0.0/24) and the
                // deprecated 6to4 relay anycast prefix (192.88.99.0/24).
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
        }
        IpAddr::V6(ip) => {
            // IPv4-mapped addresses (::ffff:127.0.0.1) reach IPv4 targets.
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_non_public_ip(IpAddr::V4(mapped));
            }
            let segments = ip.segments();
            // Deprecated IPv4-compatible addresses (::127.0.0.1) and the
            // NAT64 well-known prefix (64:ff9b::/96) also reach IPv4.
            if segments[..6].iter().all(|segment| *segment == 0)
                || (segments[0] == 0x0064
                    && segments[1] == 0xff9b
                    && segments[2..6].iter().all(|segment| *segment == 0))
            {
                let v4 = Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                );
                return is_non_public_ip(IpAddr::V4(v4));
            }
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                // Unique local (fc00::/7).
                || (segments[0] & 0xfe00) == 0xfc00
                // Link local (fe80::/10).
                || (segments[0] & 0xffc0) == 0xfe80
                // Deprecated site-local (fec0::/10).
                || (segments[0] & 0xffc0) == 0xfec0
                // Documentation (2001:db8::/32).
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

/// Parse the non-standard IPv4 forms accepted by browsers and the URL crate.
pub(super) fn parse_legacy_ipv4(host: &str) -> Option<Ipv4Addr> {
    fn part(value: &str) -> Option<u64> {
        if let Some(hex) = value
            .strip_prefix("0x")
            .or_else(|| value.strip_prefix("0X"))
        {
            u64::from_str_radix(hex, 16).ok()
        } else if value.len() > 1 && value.starts_with('0') {
            u64::from_str_radix(&value[1..], 8).ok()
        } else {
            value.parse::<u64>().ok()
        }
    }

    let parts: Vec<&str> = host.split('.').collect();
    let number = match parts.as_slice() {
        [a] => part(a)?,
        [a, b] => (part(a)? << 24) | part(b)?,
        [a, b, c] => (part(a)? << 24) | (part(b)? << 16) | part(c)?,
        [a, b, c, d] => (part(a)? << 24) | (part(b)? << 16) | (part(c)? << 8) | part(d)?,
        _ => return None,
    };
    u32::try_from(number).ok().map(Ipv4Addr::from)
}

/// Reject hostnames that resolve to a non-public address. This is used by the
/// media client in addition to the literal-IP checks above so that DNS
/// rebinding cannot point a previously public host at localhost.
pub struct PublicDnsResolver;

impl reqwest::dns::Resolve for PublicDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let host_for_error = host.clone();
            let resolved = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { Box::new(error) })?;
            let addresses: Vec<SocketAddr> = resolved
                .filter(|address| !is_non_public_ip(address.ip()))
                .collect();
            if addresses.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("refusing to connect to private address for {host_for_error}"),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// Redirect policy for media downloads. External providers are allowed, but
/// every hop must remain HTTPS on a public host.
pub fn media_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many redirects");
        }
        let url = attempt.url();
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
        {
            return attempt.error("media redirect must use a public HTTPS URL");
        }
        match url.host_str() {
            Some(host) if !is_local_or_private_host(host) => attempt.follow(),
            _ => attempt.error("media redirect host is not allowed"),
        }
    })
}

/// A redirect policy that applies the same host and scheme rules to every hop.
/// Reqwest otherwise follows redirects to arbitrary hosts, which would defeat
/// the allowlist and could leak requests outside Pawchive.
pub fn redirect_policy(allowed_hosts: Vec<String>) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many redirects");
        }
        let url = attempt.url();
        if url.scheme() != "https" {
            return attempt.error("redirect to a non-HTTPS URL is not allowed");
        }
        if !url.username().is_empty() || url.password().is_some() {
            return attempt.error("redirect URL may not embed credentials");
        }
        if url.port_or_known_default() != Some(443) {
            return attempt.error("redirect to a non-default port is not allowed");
        }
        match url.host_str() {
            Some(host)
                if allowed_hosts
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(host)) =>
            {
                attempt.follow()
            }
            _ => attempt.error("redirect host is not in the Pawchive allowlist"),
        }
    })
}

/// External links are opened in the user's browser, never inside the webview.
pub fn validate_external_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw)?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err(AppError::UnsafeUrl(
            "only http(s) links can be opened".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::UnsafeUrl("URLs may not embed credentials".into()));
    }
    let expected_port = if url.scheme() == "https" { 443 } else { 80 };
    if url.port_or_known_default() != Some(expected_port) {
        return Err(AppError::UnsafeUrl(
            "only default HTTP(S) ports are allowed".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::UnsafeUrl("URL has no host".into()))?
        .to_ascii_lowercase();
    if is_local_or_private_host(&host) {
        return Err(AppError::UnsafeUrl(
            "local addresses are not allowed".into(),
        ));
    }
    Ok(url)
}
