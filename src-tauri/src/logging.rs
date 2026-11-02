use tracing_subscriber::filter::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

fn filter() -> EnvFilter {
    // `PAWCHIVE_LOG` keeps local debugging simple; `RUST_LOG` remains the
    // conventional fallback. Release builds default to warnings and above.
    let fallback = if cfg!(debug_assertions) {
        "pawchive_desktop_lib=info,warn"
    } else {
        "warn"
    };
    EnvFilter::try_from_env("PAWCHIVE_LOG")
        .or_else(|_| EnvFilter::try_from_default_env())
        .unwrap_or_else(|_| EnvFilter::new(fallback))
}

pub fn init() {
    let _ = tracing_subscriber::registry()
        .with(filter())
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .compact(),
        )
        .try_init();
    tracing::info!("logging initialised");
}
