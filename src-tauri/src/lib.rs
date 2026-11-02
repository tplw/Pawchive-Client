mod api;
mod commands;
mod config;
mod db;
mod direct_media;
mod downloads;
mod error;
mod filters;
mod local_media;
mod logging;
mod media;
mod media_cache;
mod models;
mod popular;
mod security;
mod state;
mod transcode;

use api::ApiClient;
use config::{NetworkSettings, PawchiveConfig};
use db::Db;
use models::AccountSession;
use state::AppState;
use std::sync::{Arc, Mutex, RwLock};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let documents_dir = app
                .path()
                .document_dir()
                .unwrap_or_else(|_| data_dir.clone());

            let default_download_dir = if cfg!(any(target_os = "ios", target_os = "android")) {
                documents_dir.join("Downloads")
            } else {
                data_dir.join("downloads")
            };
            let db = Db::open(&data_dir.join("pawchive.sqlite3"))?;
            let mut settings = db.load_settings()?;
            // Desktop used to default to Small. Move existing installs to the
            // new Medium default once, without overriding later user choices.
            const CARD_SIZE_MIGRATION: &str = "desktop_medium_card_size_v1";
            if !cfg!(any(target_os = "ios", target_os = "android"))
                && db.get_raw_setting(CARD_SIZE_MIGRATION)?.is_none()
            {
                if settings.post_card_size == "small" {
                    settings.post_card_size = "medium".into();
                }
                db.set_raw_setting(CARD_SIZE_MIGRATION, "1")?;
            }
            if cfg!(any(target_os = "ios", target_os = "android"))
                || settings.download_dir.trim().is_empty()
            {
                settings.download_dir = default_download_dir.to_string_lossy().to_string();
            }
            std::fs::create_dir_all(&settings.download_dir)?;
            if let Err(error) = db.save_settings(&settings) {
                tracing::warn!(%error, "could not persist startup settings");
            }
            logging::init();
            if let Err(error) = db.prune_progress(180 * 24 * 60 * 60) {
                tracing::warn!(%error, "could not prune old playback progress");
            }
            if let Err(error) = db.reset_stale_downloads() {
                tracing::warn!(%error, "could not reset interrupted downloads");
            }

            let cfg = PawchiveConfig::default();
            let net = NetworkSettings {
                cache_size_mb: settings.cache_size_mb,
                ..Default::default()
            };
            let api = ApiClient::new(cfg.clone(), net)?;
            let media_server = local_media::LocalMediaServer::start()?;
            let http = reqwest::Client::builder()
                .user_agent(&cfg.user_agent)
                .connect_timeout(std::time::Duration::from_secs(20))
                .cookie_store(true)
                .redirect(crate::security::media_redirect_policy())
                .build()
                .map_err(|e| {
                    crate::error::AppError::Internal(format!("could not build media client: {e}"))
                })?;

            let account = std::fs::read_to_string(data_dir.join("account.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<AccountSession>(&raw).ok());
            if let Some(session) = &account {
                api.set_session(Some(session.session.clone()));
            }

            tracing::info!(
                data_dir = %data_dir.display(),
                version = env!("CARGO_PKG_VERSION"),
                "starting Pawchive Client"
            );

            app.manage(AppState {
                db: Arc::new(db),
                api,
                cfg,
                settings: Arc::new(RwLock::new(settings)),
                cancellations: Arc::new(Mutex::new(Default::default())),
                downloads: Arc::new(Mutex::new(Default::default())),
                download_gate: Arc::new(tokio::sync::Semaphore::new(1)),
                http,
                app_data_dir: data_dir,
                default_download_dir,
                media_server,
                account: Arc::new(RwLock::new(account)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::get_config,
            commands::open_external,
            commands::sync_creators,
            commands::get_creator_count,
            commands::list_creators,
            commands::get_creator,
            commands::get_creator_profile,
            commands::get_creator_links,
            commands::get_creator_announcements,
            commands::get_creator_posts,
            commands::get_recent_posts,
            commands::get_popular_posts,
            commands::get_post_summary,
            commands::get_post,
            commands::get_post_comments,
            commands::get_post_revisions,
            commands::search_all,
            commands::cancel_request,
            commands::list_favorite_creators,
            commands::set_favorite_creator,
            commands::list_playlists,
            commands::get_playlist,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::list_playlist_items,
            commands::add_playlist_item,
            commands::remove_playlist_item,
            commands::start_download,
            commands::download_post,
            commands::download_playlist,
            commands::cancel_download,
            commands::delete_download,
            commands::clear_completed_downloads,
            commands::clear_all_downloads,
            commands::list_downloads,
            commands::open_downloads_folder,
            commands::login,
            commands::get_account_state,
            commands::logout,
            commands::sync_account_favorites,
            commands::save_progress,
            commands::get_progress,
            commands::validate_media,
            commands::get_media_size,
            commands::get_image_dimensions,
            commands::get_cached_media_url,
            commands::cache_media,
            commands::clear_media_cache,
            commands::can_transcode,
            commands::transcode_media,
            commands::local_media_url,
            commands::read_subtitle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pawchive Client");
}
