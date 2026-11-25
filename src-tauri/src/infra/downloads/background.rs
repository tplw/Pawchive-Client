use crate::app::state::AppState;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::AppHandle;

static ACTIVE_BATCH: AtomicBool = AtomicBool::new(false);
static COMPLETED: AtomicU64 = AtomicU64::new(0);
static FAILED: AtomicU64 = AtomicU64::new(0);

/// Keep the mobile process alive while downloads are queued or running.
///
/// iOS grants a limited background window. Android uses a foreground service,
/// which can keep running until the downloads finish or the system stops it.
pub(super) fn downloads_changed(state: &AppState, app: &AppHandle) {
    let settings = state.settings();
    let active = state
        .downloads
        .lock()
        .map(|map| !map.is_empty())
        .unwrap_or(false);
    if active {
        if !ACTIVE_BATCH.swap(true, Ordering::SeqCst) {
            COMPLETED.store(0, Ordering::SeqCst);
            FAILED.store(0, Ordering::SeqCst);
        }
        if settings.background_downloads {
            begin(app);
        } else {
            end(app);
        }
        return;
    }

    end(app);
    if ACTIVE_BATCH.swap(false, Ordering::SeqCst) {
        let completed = COMPLETED.load(Ordering::SeqCst);
        let failed = FAILED.load(Ordering::SeqCst);
        if settings.notify_downloads_complete && completed > 0 {
            notify(app, completed, failed);
        }
    }
}

pub(super) fn download_finished(state: &AppState, app: &AppHandle, success: bool) {
    if success {
        COMPLETED.fetch_add(1, Ordering::SeqCst);
    } else {
        FAILED.fetch_add(1, Ordering::SeqCst);
    }
    downloads_changed(state, app);
}

pub(super) fn request_notification_permission(app: &AppHandle) {
    let _ = app;
    #[cfg(target_os = "ios")]
    ios::request_permission(app);
    #[cfg(target_os = "android")]
    android::request_permission();
}

fn notify(app: &AppHandle, completed: u64, failed: u64) {
    let _ = (app, completed, failed);
    #[cfg(target_os = "ios")]
    ios::notify(app, completed, failed);
    #[cfg(target_os = "android")]
    android::notify(completed, failed);
}

#[cfg(target_os = "ios")]
fn begin(app: &AppHandle) {
    ios::begin(app);
}

#[cfg(target_os = "ios")]
fn end(app: &AppHandle) {
    ios::end(app);
}

#[cfg(target_os = "android")]
fn begin(_app: &AppHandle) {
    android::set_active(true);
}

#[cfg(target_os = "android")]
fn end(_app: &AppHandle) {
    android::set_active(false);
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn begin(_app: &AppHandle) {}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn end(_app: &AppHandle) {}

#[cfg(target_os = "ios")]
mod ios {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tauri::AppHandle;

    static TASK: AtomicUsize = AtomicUsize::new(0);

    pub(super) fn begin(app: &AppHandle) {
        if TASK.load(Ordering::SeqCst) != 0 {
            return;
        }
        let _ = app.run_on_main_thread(|| {
            use block2::RcBlock;
            use objc2::MainThreadMarker;
            use objc2_ui_kit::UIApplication;

            if TASK.load(Ordering::SeqCst) != 0 {
                return;
            }
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let application = UIApplication::sharedApplication(mtm);
            let handler = RcBlock::new(|| {
                TASK.store(0, Ordering::SeqCst);
            });
            let id = application.beginBackgroundTaskWithExpirationHandler(Some(&handler));
            TASK.store(id, Ordering::SeqCst);
            tracing::debug!(task = id, "started iOS background download window");
        });
    }

    pub(super) fn end(app: &AppHandle) {
        let id = TASK.swap(0, Ordering::SeqCst);
        if id == 0 {
            return;
        }
        let _ = app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_ui_kit::UIApplication;

            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let application = UIApplication::sharedApplication(mtm);
            application.endBackgroundTask(id);
            tracing::debug!(task = id, "ended iOS background download window");
        });
    }

    pub(super) fn request_permission(app: &AppHandle) {
        let _ = app.run_on_main_thread(|| {
            use block2::RcBlock;
            use objc2::runtime::Bool;
            use objc2_foundation::NSError;
            use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};

            let handler = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
            UNUserNotificationCenter::currentNotificationCenter()
                .requestAuthorizationWithOptions_completionHandler(
                    UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                    &handler,
                );
        });
    }

    pub(super) fn notify(app: &AppHandle, completed: u64, failed: u64) {
        let body = if failed > 0 {
            format!("{completed} downloaded, {failed} failed.")
        } else {
            format!(
                "{completed} file{} downloaded.",
                if completed == 1 { "" } else { "s" }
            )
        };
        let _ = app.run_on_main_thread(move || {
            use objc2_foundation::NSString;
            use objc2_user_notifications::{
                UNMutableNotificationContent, UNNotificationRequest, UNUserNotificationCenter,
            };

            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str("Downloads complete"));
            content.setBody(&NSString::from_str(&body));
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str("pawchive-downloads-complete"),
                &content,
                None,
            );
            UNUserNotificationCenter::currentNotificationCenter()
                .addNotificationRequest_withCompletionHandler(&request, None);
        });
    }
}

#[cfg(target_os = "android")]
mod android {
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;

    pub(super) fn set_active(active: bool) {
        if let Err(error) = call_service(active) {
            tracing::warn!(%error, "could not update Android download foreground service");
        }
    }

    pub(super) fn request_permission() {
        if let Err(error) = call_no_args("requestNotificationPermission") {
            tracing::warn!(%error, "could not request Android notification permission");
        }
    }

    pub(super) fn notify(completed: u64, failed: u64) {
        if let Err(error) = call_notify(completed, failed) {
            tracing::warn!(%error, "could not post Android download notification");
        }
    }

    fn context() -> Result<(JObject<'static>, jni::JavaVM), String> {
        let context =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(ndk_context::android_context))
                .map_err(|_| "the Android runtime context is not ready".to_string())?;
        let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
            .map_err(|error| format!("could not access the Android JVM: {error:?}"))?;
        let raw_context: jni::sys::jobject = context.context().cast();
        let context = unsafe { JObject::from_raw(raw_context) };
        Ok((context, vm))
    }

    fn call_service(active: bool) -> Result<(), String> {
        let (context, vm) = context()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| format!("could not attach to the Android JVM: {error:?}"))?;
        let class = env
            .find_class("pw/pawchive/client/DownloadServiceController")
            .map_err(|error| format!("could not find the download service: {error:?}"))?;
        env.call_static_method(
            &class,
            if active { "start" } else { "stop" },
            "(Landroid/content/Context;)V",
            &[JValue::Object(&context)],
        )
        .map_err(|error| format!("download service call failed: {error:?}"))?;
        Ok(())
    }

    fn call_no_args(method: &str) -> Result<(), String> {
        let (_context, vm) = context()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| format!("could not attach to the Android JVM: {error:?}"))?;
        let class = env
            .find_class("pw/pawchive/client/DownloadServiceController")
            .map_err(|error| format!("could not find the download service: {error:?}"))?;
        env.call_static_method(&class, method, "()V", &[])
            .map_err(|error| format!("notification call failed: {error:?}"))?;
        Ok(())
    }

    fn call_notify(completed: u64, failed: u64) -> Result<(), String> {
        let (context, vm) = context()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| format!("could not attach to the Android JVM: {error:?}"))?;
        let class = env
            .find_class("pw/pawchive/client/DownloadServiceController")
            .map_err(|error| format!("could not find the download service: {error:?}"))?;
        env.call_static_method(
            &class,
            "notifyComplete",
            "(Landroid/content/Context;II)V",
            &[
                JValue::Object(&context),
                JValue::Int(completed.min(i32::MAX as u64) as i32),
                JValue::Int(failed.min(i32::MAX as u64) as i32),
            ],
        )
        .map_err(|error| format!("download notification failed: {error:?}"))?;
        Ok(())
    }
}
