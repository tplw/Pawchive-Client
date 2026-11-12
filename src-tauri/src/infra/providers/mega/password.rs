//! MEGA password-protected link format.
//!
//! Encrypted links use `#P!<payload>` instead of the normal `#<key>` fragment.
//! The payload is the MEGA SDK's binary link envelope:
//!
//! `algorithm || type || handle(6) || salt(32) || encrypted key || mac(32)`
//!
//! The key is XORed with a PBKDF2-HMAC-SHA512 derivation of the password, and
//! the payload is authenticated with HMAC-SHA256. The original standard link is
//! rebuilt from the public handle and decrypted key.

use super::crypto::decode_base64_url;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Sha256, Sha512};

const FILE_KEY_LEN: usize = 32;
const FOLDER_KEY_LEN: usize = 16;
const SALT_LEN: usize = 32;
const HANDLE_LEN: usize = 6;
const MAC_LEN: usize = 32;
const MIN_PAYLOAD_LEN: usize = 2 + HANDLE_LEN + SALT_LEN + FOLDER_KEY_LEN + MAC_LEN;

#[derive(Debug)]
pub enum PasswordLinkError {
    WrongPassword,
    Invalid,
}

struct Envelope<'a> {
    algorithm: u8,
    is_folder: bool,
    handle: &'a [u8],
    salt: &'a [u8],
    encrypted_key: &'a [u8],
    mac: &'a [u8],
}

fn envelope(bytes: &[u8]) -> Result<Envelope<'_>, PasswordLinkError> {
    if bytes.len() < MIN_PAYLOAD_LEN {
        return Err(PasswordLinkError::Invalid);
    }
    let algorithm = bytes[0];
    if algorithm != 1 && algorithm != 2 {
        return Err(PasswordLinkError::Invalid);
    }
    let is_folder = match bytes[1] {
        0 => true,
        1 => false,
        _ => return Err(PasswordLinkError::Invalid),
    };
    let key_len = if is_folder {
        FOLDER_KEY_LEN
    } else {
        FILE_KEY_LEN
    };
    let expected = 2 + HANDLE_LEN + SALT_LEN + key_len + MAC_LEN;
    if bytes.len() < expected {
        return Err(PasswordLinkError::Invalid);
    }
    let mut cursor = 2;
    let handle = &bytes[cursor..cursor + HANDLE_LEN];
    cursor += HANDLE_LEN;
    let salt = &bytes[cursor..cursor + SALT_LEN];
    cursor += SALT_LEN;
    let encrypted_key = &bytes[cursor..cursor + key_len];
    cursor += key_len;
    let mac = &bytes[cursor..cursor + MAC_LEN];
    Ok(Envelope {
        algorithm,
        is_folder,
        handle,
        salt,
        encrypted_key,
        mac,
    })
}

fn payload_bytes(raw: &str) -> Option<Vec<u8>> {
    let (_, fragment) = raw.split_once("#P!")?;
    let encoded = fragment
        .trim()
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
        .next()?;
    if encoded.is_empty() {
        return None;
    }
    decode_base64_url(encoded)
}

/// The public handle embedded in a password-protected link. This is stable
/// across password changes and is used as the password-store key.
pub fn protected_link_handle(raw: &str) -> Option<String> {
    let bytes = payload_bytes(raw)?;
    let envelope = envelope(&bytes).ok()?;
    Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(envelope.handle))
}

pub fn is_protected_link(raw: &str) -> bool {
    protected_link_handle(raw).is_some()
}

pub fn password_key(raw: &str) -> Option<String> {
    protected_link_handle(raw).map(|handle| format!("mega:{handle}"))
}

/// Decrypt a `#P!` link into the standard file/folder link our resolver uses.
pub fn decrypt_protected_link(raw: &str, password: &str) -> Result<String, PasswordLinkError> {
    let bytes = payload_bytes(raw).ok_or(PasswordLinkError::Invalid)?;
    let envelope = envelope(&bytes)?;

    let mut derived = [0u8; 64];
    pbkdf2::pbkdf2::<Hmac<Sha512>>(password.as_bytes(), envelope.salt, 100_000, &mut derived)
        .map_err(|_| PasswordLinkError::Invalid)?;

    let authenticated_len = 2 + HANDLE_LEN + SALT_LEN + envelope.encrypted_key.len();
    let authenticated = &bytes[..authenticated_len];
    let mac_key = &derived[SALT_LEN..];

    let verified = if envelope.algorithm == 1 {
        // Legacy WebClient bug: the payload is the HMAC key and the derived
        // half is the message.
        let mut mac = Hmac::<Sha256>::new_from_slice(authenticated)
            .map_err(|_| PasswordLinkError::Invalid)?;
        mac.update(mac_key);
        mac.verify_slice(envelope.mac).is_ok()
    } else {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(mac_key).map_err(|_| PasswordLinkError::Invalid)?;
        mac.update(authenticated);
        mac.verify_slice(envelope.mac).is_ok()
    };
    if !verified {
        return Err(PasswordLinkError::WrongPassword);
    }

    let key: Vec<u8> = envelope
        .encrypted_key
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ derived[index])
        .collect();
    let handle = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(envelope.handle);
    let key = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(key);
    let kind = if envelope.is_folder { "folder" } else { "file" };
    Ok(format!("https://mega.nz/{kind}/{handle}#{key}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Generated with a Python implementation of the MEGA SDK `encryptlink`
    // layout: a known standard link, a fixed salt and the password
    // "correct horse".
    const STANDARD: &str =
        "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30";
    const PROTECTED_ALG1: &str = "https://mega.nz/#P!AQFwfnUNgNEAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHxl3piJ-PeFLGsobpGcNPS6_rloUMHED4ClY_g0gDN1ZG83zy3TA0DvUut6B-LECpwcukZdOqicxVW1Ckh1Woos";
    const PROTECTED_ALG2: &str = "https://mega.nz/#P!AgFwfnUNgNEAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHxl3piJ-PeFLGsobpGcNPS6_rloUMHED4ClY_g0gDN1ZfY90DKw9YKl41vVccTZHgttETN3dBBIR1eL7qS_qXhg";
    const PROTECTED_FOLDER: &str = "https://mega.nz/#P!AgBEEDXBvNkAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eH0WS0L4Id88uN1vnTxF1lpoht2PrO_P6qkTRMZCWpo_u7cDJk-JOeNcKc2ODLtfffA";

    #[test]
    fn rejects_malformed_payloads() {
        assert!(matches!(
            decrypt_protected_link("https://mega.nz/#P!AAAA", "password"),
            Err(PasswordLinkError::Invalid)
        ));
        assert!(!is_protected_link("https://mega.nz/file/cH51DYDR#abc"));
    }

    #[test]
    fn decrypts_both_link_algorithms() {
        assert_eq!(
            decrypt_protected_link(PROTECTED_ALG1, "correct horse").unwrap(),
            STANDARD
        );
        assert_eq!(
            decrypt_protected_link(PROTECTED_ALG2, "correct horse").unwrap(),
            STANDARD
        );
        assert_eq!(
            decrypt_protected_link(PROTECTED_FOLDER, "correct horse").unwrap(),
            "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ"
        );
        assert_eq!(
            password_key(PROTECTED_FOLDER).as_deref(),
            Some("mega:RBA1wbzZ")
        );
    }

    #[test]
    fn rejects_a_wrong_password() {
        assert!(matches!(
            decrypt_protected_link(PROTECTED_ALG2, "wrong horse"),
            Err(PasswordLinkError::WrongPassword)
        ));
        assert_eq!(
            password_key(PROTECTED_ALG2).as_deref(),
            Some("mega:cH51DYDR")
        );
    }

    #[tokio::test]
    async fn resolver_asks_once_then_unlocks_and_clears_bad_passwords() {
        use crate::infra::provider_passwords::ProviderPasswords;
        use crate::shared::error::AppError;
        use std::sync::Arc;

        let store = Arc::new(ProviderPasswords::in_memory());
        let resolver = super::super::resolver::MegaResolver::with_passwords(
            reqwest::Client::new(),
            store.clone(),
        );
        assert!(matches!(
            resolver.unlock(PROTECTED_ALG2).await,
            Err(AppError::PasswordRequired { .. })
        ));
        store.set("mega:cH51DYDR", "correct horse", false).unwrap();
        assert!(resolver.unlock(PROTECTED_ALG2).await.is_ok());
        store.set("mega:cH51DYDR", "wrong horse", false).unwrap();
        assert!(matches!(
            resolver.unlock(PROTECTED_ALG2).await,
            Err(AppError::PasswordRequired { .. })
        ));
        assert_eq!(store.get("mega:cH51DYDR"), None);
    }
}
