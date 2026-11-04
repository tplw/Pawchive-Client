use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct Entry {
    value: serde_json::Value,
    expires: Instant,
    bytes: usize,
}

/// A small, bounded, TTL-aware cache for API responses.
///
/// The cache is deliberately simple: a hash map plus insertion order queue.
/// It is bounded both by entry count and approximate byte size so that a burst
/// of large searches cannot grow memory without limit.
pub struct ResponseCache {
    inner: Mutex<Inner>,
    max_entries: usize,
}

struct Inner {
    entries: HashMap<String, Entry>,
    order: VecDeque<String>,
    bytes: usize,
    max_bytes: usize,
}

impl ResponseCache {
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                entries: HashMap::new(),
                order: VecDeque::new(),
                bytes: 0,
                max_bytes: max_bytes.max(1),
            }),
            max_entries,
        }
    }

    pub fn set_max_bytes(&self, max_bytes: usize) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.max_bytes = max_bytes.max(1);
        while inner.bytes > inner.max_bytes {
            let Some(oldest) = inner.order.pop_front() else {
                break;
            };
            inner.remove(&oldest);
        }
    }

    pub fn get(&self, key: &str) -> Option<serde_json::Value> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let expired = inner.entries.get(key)?.expires <= Instant::now();
        if expired {
            inner.remove(key);
            return None;
        }
        inner.entries.get(key).map(|e| e.value.clone())
    }

    pub fn insert(&self, key: String, value: serde_json::Value, ttl: Duration) {
        let bytes = serde_json::to_vec(&value).map(|v| v.len()).unwrap_or(0);
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if bytes > inner.max_bytes {
            return;
        }
        inner.remove(&key);
        inner.bytes += bytes;
        inner.entries.insert(
            key.clone(),
            Entry {
                value,
                expires: Instant::now() + ttl,
                bytes,
            },
        );
        inner.order.push_back(key);
        while inner.entries.len() > self.max_entries || inner.bytes > inner.max_bytes {
            let Some(oldest) = inner.order.pop_front() else {
                break;
            };
            inner.remove(&oldest);
        }
    }

    #[cfg(test)]
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.entries.clear();
        inner.order.clear();
        inner.bytes = 0;
    }

    #[cfg(test)]
    pub fn stats(&self) -> (usize, usize) {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        (inner.entries.len(), inner.bytes)
    }
}

impl Inner {
    fn remove(&mut self, key: &str) {
        if let Some(entry) = self.entries.remove(key) {
            self.bytes = self.bytes.saturating_sub(entry.bytes);
        }
        self.order.retain(|entry| entry != key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_and_expires_values() {
        let cache = ResponseCache::new(8, 1_000_000);
        cache.insert(
            "a".into(),
            serde_json::json!({"v": 1}),
            Duration::from_secs(60),
        );
        assert_eq!(cache.get("a").unwrap()["v"], 1);
        cache.insert("b".into(), serde_json::json!(2), Duration::ZERO);
        assert!(cache.get("b").is_none());
        cache.clear();
        assert!(cache.get("a").is_none());
        assert_eq!(cache.stats(), (0, 0));
    }

    #[test]
    fn replacing_a_key_does_not_duplicate_its_order_entry() {
        let cache = ResponseCache::new(2, 1_000_000);
        for i in 0..20 {
            cache.insert("same".into(), serde_json::json!(i), Duration::from_secs(60));
        }
        assert_eq!(cache.stats().0, 1);
        assert_eq!(cache.get("same").unwrap(), serde_json::json!(19));
    }

    #[test]
    fn evicts_oldest_entries_when_bounded() {
        let cache = ResponseCache::new(2, 1_000_000);
        for i in 0..5 {
            cache.insert(
                format!("k{i}"),
                serde_json::json!(i),
                Duration::from_secs(60),
            );
        }
        assert_eq!(cache.stats().0, 2);
        assert!(cache.get("k0").is_none());
        assert!(cache.get("k4").is_some());
    }

    #[test]
    fn resizing_evicts_until_under_limit() {
        let cache = ResponseCache::new(8, 10_000);
        for i in 0..4 {
            cache.insert(
                format!("k{i}"),
                serde_json::json!("x".repeat(1_000)),
                Duration::from_secs(60),
            );
        }
        cache.set_max_bytes(1_500);
        let (_, bytes) = cache.stats();
        assert!(bytes <= 1_500);
        assert!(cache.get("k3").is_some());
    }

    #[test]
    fn rejects_values_larger_than_capacity() {
        let cache = ResponseCache::new(8, 10);
        cache.insert(
            "big".into(),
            serde_json::json!("x".repeat(100)),
            Duration::from_secs(60),
        );
        assert!(cache.get("big").is_none());
    }
}
