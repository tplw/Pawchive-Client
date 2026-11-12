mod crypto;
mod links;
mod password;
mod resolver;
mod stream;

pub use links::{is_file_url, is_folder_url, is_media_url, parse_file_link, parse_folder_link};
#[cfg(test)]
pub(crate) use links::{MegaFile, MegaLink};
pub use password::{is_protected_link, password_key};
pub use resolver::MegaResolver;
pub use stream::{download_to_path, MegaStream};

#[cfg(test)]
mod tests {
    use super::crypto::*;
    use super::links::parse_folder_file_link;
    use super::*;
    use aes::cipher::StreamCipher;
    use base64::Engine;

    #[test]
    fn parses_mega_folder_links() {
        let folder =
            parse_folder_link("https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ").unwrap();
        assert_eq!(folder.handle, "RBA1wbzZ");
        assert_eq!(folder.key, "9JumpYIWHYvgZ0RyL6wIBQ");
        assert!(parse_folder_link(
            "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30"
        )
        .is_none());
        assert!(parse_folder_link("https://example.com/folder/RBA1wbzZ#key").is_none());
        let legacy =
            parse_folder_link("https://mega.nz/#F!RBA1wbzZ!9JumpYIWHYvgZ0RyL6wIBQ").unwrap();
        assert_eq!(legacy.handle, "RBA1wbzZ");
        assert_eq!(legacy.key, "9JumpYIWHYvgZ0RyL6wIBQ");
    }

    #[test]
    fn parses_folder_file_links() {
        let link = parse_folder_file_link(
            "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ/file/UQZkxRhB",
        )
        .unwrap();
        assert_eq!(link.folder_handle, "RBA1wbzZ");
        assert_eq!(link.folder_key, "9JumpYIWHYvgZ0RyL6wIBQ");
        assert_eq!(link.file_handle, "UQZkxRhB");
        assert!(is_media_url(
            "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ/file/UQZkxRhB"
        ));
        assert!(!is_media_url(
            "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ"
        ));
    }

    #[test]
    fn decrypts_a_folder_child_key_and_attributes() {
        let folder_key =
            folder_key_from_bytes(&decode_base64_url("9JumpYIWHYvgZ0RyL6wIBQ").unwrap()).unwrap();
        let encrypted = decode_base64_url("kNahPiJss_upRnV-qNmS0RP_fnC0Cjdcd1rT22RaV6w").unwrap();
        let key_bytes = decrypt_key_blocks(&encrypted, &folder_key).unwrap();
        assert_eq!(key_bytes.len(), 32);
        assert_eq!(
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&key_bytes),
            "Ko2zMif7idpv7TAw-MrDaJcjwmaCCHp0DoZZOUDjkZ4"
        );
        let (key, _) = derive_keys(&key_bytes).unwrap();
        let attributes = decode_base64_url(
            "MzTlkDglcreGyBnqmn5WwNUcBvu0Sakdirw6fNAzGVYfJtfs9WqEleyGuJVgwV45WpQAVq_5JAPEVZCrDgYZfg",
        )
        .unwrap();
        let attributes = decrypt_attributes(&attributes, &key).unwrap();
        assert_eq!(attributes["n"], "1080 Tights.zip");
    }

    #[test]
    fn parses_current_and_legacy_links() {
        let current = parse_file_link(
            "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30",
        )
        .unwrap();
        assert_eq!(current.handle, "cH51DYDR");
        assert_eq!(current.key, "qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30");

        let legacy = parse_file_link(
            "https://mega.nz/#!Ue5VRSIQ!kC2E4a4JwfWWCWYNJovGFHlbz8FN-ISsBAGPzvTjT6k",
        )
        .unwrap();
        assert_eq!(legacy.handle, "Ue5VRSIQ");
        assert_eq!(legacy.key, "kC2E4a4JwfWWCWYNJovGFHlbz8FN-ISsBAGPzvTjT6k");

        assert!(parse_file_link("https://mega.nz/folder/abc#def").is_none());
        assert!(parse_file_link("https://example.com/file/cH51DYDR#key").is_none());
    }

    #[test]
    fn derives_the_content_key_and_nonce() {
        let link_key = decode_base64_url("ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8").unwrap();
        let (key, nonce) = derive_keys(&link_key).unwrap();
        assert_eq!(key, [16u8; 16]);
        assert_eq!(nonce, [48, 49, 50, 51, 52, 53, 54, 55]);
    }

    #[test]
    fn decrypts_file_attributes() {
        let key = [0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        let encrypted = decode_base64_url("dc6Vaf8dj8pJJlarEixxhMrw6OHOKNDUr19n0b87wZ4").unwrap();
        let attributes = decrypt_attributes(&encrypted, &key).unwrap();
        assert_eq!(attributes["n"], "clip.mp4");
        assert_eq!(attributes["s"], 123);
    }

    #[test]
    fn decrypts_a_seeked_counter_range() {
        let key = [0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        let nonce = [16u8, 17, 18, 19, 20, 21, 22, 23];
        let plaintext = b"MEGA CTR test vector: 0123456789 abcdefghijklmnopqrstuvwxyz";
        let mut encrypted = vec![
            173, 13, 232, 46, 137, 206, 241, 247, 248, 183, 130, 235, 88, 243, 181, 189, 249, 243,
            108, 153, 63, 68, 225, 230, 89, 1, 239, 105, 180, 111, 160, 93, 205, 108, 17, 85, 189,
            241, 200, 0, 29, 60, 125, 48, 119, 84, 95, 30, 78, 18, 194, 226, 175, 208, 1, 198, 126,
            126, 164,
        ];
        let mut cipher = ctr_cipher(&key, &nonce, 3).unwrap();
        cipher.apply_keystream(&mut encrypted);
        assert_eq!(encrypted, plaintext);
    }
}
