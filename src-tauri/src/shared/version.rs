//! Single source of truth for the user-facing release version.
//!
//! Cargo, Tauri and the mobile bundle metadata require a strict three-part
//! semver. Pawchive releases can use a fourth patch segment (for example
//! `1.0.3.1`), so the bundle version stays at the next three-part version and
//! this constant is what the UI and update checker use.

pub const APP_VERSION: &str = "1.0.5.1";
