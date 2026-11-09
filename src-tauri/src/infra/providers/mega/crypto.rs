use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit};
use aes::Aes128;
use base64::Engine;
use ctr::cipher::KeyIvInit;
use ctr::Ctr128BE;
use serde_json::Value;

pub(super) type AesCtr = Ctr128BE<Aes128>;

pub(super) fn decode_base64_url(raw: &str) -> Option<Vec<u8>> {
    let cleaned: String = raw
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != ',')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let mut padded = cleaned;
    while !padded.len().is_multiple_of(4) {
        padded.push('=');
    }
    base64::engine::general_purpose::URL_SAFE
        .decode(padded.as_bytes())
        .ok()
        .or_else(|| {
            base64::engine::general_purpose::STANDARD
                .decode(padded.as_bytes())
                .ok()
        })
}

pub(super) fn folder_key_from_bytes(bytes: &[u8]) -> Option<[u8; 16]> {
    match bytes.len() {
        16 => bytes.try_into().ok(),
        32 => {
            let mut key = [0u8; 16];
            for index in 0..16 {
                key[index] = bytes[index] ^ bytes[index + 16];
            }
            Some(key)
        }
        _ => None,
    }
}

/// MEGA encrypts node keys with the parent folder's AES key in ECB mode.
pub(super) fn decrypt_key_blocks(encrypted: &[u8], key: &[u8; 16]) -> Option<Vec<u8>> {
    if encrypted.is_empty() || !encrypted.len().is_multiple_of(16) {
        return None;
    }
    let cipher = Aes128::new_from_slice(key).ok()?;
    let mut out = Vec::with_capacity(encrypted.len());
    for chunk in encrypted.as_chunks::<16>().0 {
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        out.extend_from_slice(&block);
    }
    Some(out)
}

pub(super) fn derive_keys(link_key: &[u8]) -> Option<([u8; 16], [u8; 8])> {
    if link_key.len() != 32 {
        return None;
    }
    let mut key = [0u8; 16];
    for index in 0..16 {
        key[index] = link_key[index] ^ link_key[index + 16];
    }
    let mut nonce = [0u8; 8];
    nonce.copy_from_slice(&link_key[16..24]);
    Some((key, nonce))
}

/// MEGA attributes are AES-CBC encrypted with a zero IV and padded with NULs.
/// The plaintext starts with the literal `MEGA` followed by JSON.
pub(super) fn decrypt_attributes(encrypted: &[u8], key: &[u8; 16]) -> Option<Value> {
    if encrypted.is_empty() || !encrypted.len().is_multiple_of(16) {
        return None;
    }
    let cipher = Aes128::new_from_slice(key).ok()?;
    let mut data = encrypted.to_vec();
    let mut previous = [0u8; 16];
    for chunk in data.as_chunks_mut::<16>().0 {
        let current: [u8; 16] = *chunk;
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        for index in 0..16 {
            chunk[index] = block[index] ^ previous[index];
        }
        previous = current;
    }
    let end = data
        .iter()
        .rposition(|byte| *byte != 0)
        .map(|index| index + 1)
        .unwrap_or(0);
    let text = std::str::from_utf8(&data[..end]).ok()?;
    let text = text.strip_prefix("MEGA").unwrap_or(text);
    serde_json::from_str(text).ok()
}

pub(super) fn ctr_cipher(key: &[u8; 16], nonce: &[u8; 8], block_index: u64) -> Option<AesCtr> {
    let mut iv = [0u8; 16];
    iv[..8].copy_from_slice(nonce);
    iv[8..].copy_from_slice(&block_index.to_be_bytes());
    AesCtr::new_from_slices(key, &iv).ok()
}
