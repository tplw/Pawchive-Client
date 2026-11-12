mod app;
mod commands;
mod features;
mod infra;
mod shared;

use app::state::AppState;
use infra::pawchive_api::ApiClient;
use infra::sqlite::Db;
use shared::config::{NetworkSettings, PawchiveConfig};
use shared::models::AccountSession;
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
            // A saved folder can disappear (external drive, sandbox move). Fall
            // back to the application folder instead of failing startup.
            if let Err(error) = std::fs::create_dir_all(&settings.download_dir) {
                tracing::warn!(
                    %error,
                    path = %settings.download_dir,
                    "download folder is unavailable; using the default folder"
                );
                settings.download_dir = default_download_dir.to_string_lossy().to_string();
                if let Err(error) = std::fs::create_dir_all(&settings.download_dir) {
                    tracing::error!(
                        %error,
                        path = %settings.download_dir,
                        "could not create the default download folder"
                    );
                }
            }
            if let Err(error) = db.save_settings(&settings) {
                tracing::warn!(%error, "could not persist startup settings");
            }
            shared::logging::init();
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
            let media_server = infra::local_http::LocalMediaServer::start()?;
            let http = reqwest::Client::builder()
                .user_agent(&cfg.user_agent)
                .connect_timeout(std::time::Duration::from_secs(20))
                .tcp_nodelay(true)
                .http2_adaptive_window(true)
                .pool_max_idle_per_host(8)
                .cookie_store(true)
                .dns_resolver(std::sync::Arc::new(
                    crate::shared::security::PublicDnsResolver,
                ))
                .redirect(crate::shared::security::media_redirect_policy())
                .build()
                .map_err(|e| {
                    crate::shared::error::AppError::Internal(format!(
                        "could not build media client: {e}"
                    ))
                })?;
            let passwords =
                std::sync::Arc::new(crate::infra::provider_passwords::ProviderPasswords::load(
                    data_dir.join("provider-passwords.json"),
                ));
            let mega = crate::infra::providers::mega::MegaResolver::with_passwords(
                http.clone(),
                passwords.clone(),
            );
            let proton = std::sync::Arc::new(
                crate::infra::providers::proton::ProtonResolver::with_passwords(passwords.clone()),
            );
            let remote = std::sync::Arc::new(crate::infra::providers::remote::RemoteResolver::new(
                http.clone(),
            ));

            let account = std::fs::read_to_string(data_dir.join("account.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<AccountSession>(&raw).ok());
            if let Some(session) = &account {
                api.set_session(Some(session.session.clone()));
            }

            tracing::info!(
                data_dir = %data_dir.display(),
                version = crate::shared::version::APP_VERSION,
                "starting Pawchive"
            );

            let cache_dir = data_dir.join("media-cache");
            let cache_max_bytes = settings
                .media_cache_size_mb
                .saturating_mul(1024 * 1024)
                .max(64 * 1024 * 1024);

            app.manage(AppState {
                db: Arc::new(db),
                api,
                cfg,
                settings: Arc::new(RwLock::new(settings)),
                cancellations: Arc::new(Mutex::new(Default::default())),
                downloads: Arc::new(Mutex::new(Default::default())),
                download_gate: Arc::new(tokio::sync::Semaphore::new(1)),
                http,
                mega,
                proton,
                passwords,
                remote,
                app_data_dir: data_dir,
                default_download_dir,
                media_server,
                account: Arc::new(RwLock::new(account)),
            });

            // Remove abandoned partial downloads and enforce the cache limit
            // even if the app previously exited without finishing a cleanup.
            tauri::async_runtime::spawn(async move {
                crate::infra::media_cache::cleanup_stale(&cache_dir).await;
                crate::infra::media_cache::prune_cache(&cache_dir, cache_max_bytes).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::get_config,
            commands::check_for_update,
            commands::open_external,
            commands::set_status_bar_hidden,
            commands::sync_creators,
            commands::get_creator_count,
            commands::list_creators,
            commands::get_creator,
            commands::get_creator_profile,
            commands::get_creator_links,
            commands::get_creator_announcements,
            commands::get_creator_posts,
            commands::get_similar_creators,
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
            commands::retry_download,
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
            commands::set_provider_password,
            commands::forget_provider_password,
            commands::unlock_provider_link,
            commands::resolve_media,
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
        .expect("error while running Pawchive");
}
