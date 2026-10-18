//! Host-settings loader for the backend.
//!
//! The isolated UI persists through the broker into the host's
//! `<plugin-data>/<plugin-id>/settings.json`; the backend reads that same
//! file (never the UI, never the network) so one settings object drives
//! both. The host exports the resolved `TIKTOOLS_PLUGIN_DATA_DIR` at
//! startup and the loader passes `TIKTOOLS_PLUGIN_ID`, so the path below
//! is exact — no search, no guessing. Any failure (missing file,
//! malformed JSON) falls back to defaults, which keep speech disabled.

use std::path::PathBuf;

use super::policy::{sanitize_settings, TtsSettings};

pub const DEFAULT_SERVER_URL: &str = "http://localhost:17842";

#[derive(Clone)]
pub struct BackendConfig {
    pub server_url: String,
    pub api_token: String,
    pub policy: TtsSettings,
    pub empty_catalog_retry_ms: u64,
    pub queue_capacity: usize,
    pub max_wait_age_ms: u64,
    pub max_inflight: usize,
    pub generation_timeout_ms: u64,
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            server_url: DEFAULT_SERVER_URL.to_owned(),
            api_token: String::new(),
            policy: TtsSettings::default(),
            empty_catalog_retry_ms: 2000,
            queue_capacity: 64,
            max_wait_age_ms: 15_000,
            max_inflight: 1,
            generation_timeout_ms: 300_000,
        }
    }
}

/// Exact host settings path from the process-plugin environment contract.
pub fn settings_path() -> Option<PathBuf> {
    let root = std::env::var_os("TIKTOOLS_PLUGIN_DATA_DIR")?;
    let id = std::env::var_os("TIKTOOLS_PLUGIN_ID")?;
    if root.is_empty() || id.is_empty() {
        return None;
    }
    Some(PathBuf::from(root).join(id).join("settings.json"))
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

pub fn config_from_values(values: &serde_json::Value) -> BackendConfig {
    let server_url = values
        .get("serverUrl")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|url| !url.is_empty() && url.len() <= 512 && is_http_url(url))
        .unwrap_or(DEFAULT_SERVER_URL)
        .trim_end_matches('/')
        .to_owned();
    let api_token = values
        .get("apiToken")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty() && token.len() <= 4096)
        .unwrap_or_default()
        .to_owned();
    // The UI nests the speech policy under `tts`; a top-level default
    // voice backfills the policy default so both editors agree.
    let mut policy = sanitize_settings(values.get("tts"));
    if policy.default_voice.is_empty() {
        policy.default_voice = values
            .get("defaultVoice")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|voice| !voice.is_empty())
            .unwrap_or_default()
            .chars()
            .take(128)
            .collect();
    }
    if values.get("tts").and_then(|v| v.get("language")).is_none() {
        if let Some(language) = values
            .get("defaultLanguage")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|language| !language.is_empty())
        {
            policy.language = language.chars().take(16).collect();
        }
    }
    let bounded = |key: &str, fallback, min, max| {
        values
            .get("tts")
            .and_then(|v| v.get(key))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(fallback)
            .clamp(min, max)
    };
    BackendConfig {
        queue_capacity: bounded("chatQueueCapacity", 64, 1, 64) as usize,
        max_wait_age_ms: bounded("chatMaxWaitMs", 15_000, 1000, 30_000),
        max_inflight: bounded("chatMaxInflight", 1, 1, 4) as usize,
        generation_timeout_ms: bounded("chatGenerationTimeoutMs", 300_000, 15_000, 600_000),
        server_url,
        api_token,
        policy,
        empty_catalog_retry_ms: values
            .get("tts")
            .and_then(|v| v.get("emptyCatalogRetryMs"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(2000)
            .clamp(250, 10_000),
    }
}

/// Reloading cache: the file is re-read only when its mtime advances, so
/// the hot chat path pays one stat per event.
pub struct ConfigCache {
    loaded_mtime: Option<std::time::SystemTime>,
    config: BackendConfig,
    last_read: std::time::Instant,
    loaded_path: Option<PathBuf>,
}

impl ConfigCache {
    pub fn new() -> Self {
        Self {
            loaded_mtime: None,
            config: BackendConfig::default(),
            last_read: std::time::Instant::now(),
            loaded_path: None,
        }
    }

    pub fn get(&mut self) -> &BackendConfig {
        let path = settings_path();
        let mtime = path.as_ref().and_then(|path| {
            std::fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .ok()
        });
        if mtime != self.loaded_mtime
            || path != self.loaded_path
            || self.last_read.elapsed() >= std::time::Duration::from_secs(1)
        {
            self.last_read = std::time::Instant::now();
            self.loaded_path = path.clone();
            self.loaded_mtime = mtime;
            self.config = path
                .as_ref()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .map(|values| config_from_values(&values))
                .unwrap_or_default();
        }
        &self.config
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn config_defaults_and_backfills() {
        let config = config_from_values(&json!({}));
        assert_eq!(config.server_url, DEFAULT_SERVER_URL);
        assert!(config.api_token.is_empty());
        assert!(!config.policy.enabled);

        let config = config_from_values(&json!({
            "serverUrl": "https://tts.example.com/",
            "apiToken": "secret",
            "defaultVoice": "F1",
            "defaultLanguage": "es",
            "tts": {"enabled": true},
        }));
        assert_eq!(config.server_url, "https://tts.example.com");
        assert_eq!(config.api_token, "secret");
        assert_eq!(config.policy.default_voice, "F1");
        assert_eq!(config.policy.language, "es");
        assert!(config.policy.enabled);
    }

    #[test]
    fn config_rejects_non_http_server_urls() {
        let config = config_from_values(&json!({"serverUrl": "ftp://evil.example/x"}));
        assert_eq!(config.server_url, DEFAULT_SERVER_URL);
        let config = config_from_values(&json!({"serverUrl": "notaurl"}));
        assert_eq!(config.server_url, DEFAULT_SERVER_URL);
    }
    #[test]
    fn provider_and_catalog_revision_preserve_policy_and_legacy_voice_preferences() {
        let config = config_from_values(&json!({ "tts": {
            "providerId": "pocket-tts", "voiceCatalogRevision": "reload-a",
            "defaultVoice": "pocket-tts:owned", "allowedUsers": ["ada"],
            "specialUsers": [{"handle":"blocked", "allowed":false, "voice":"supertonic:F1"}],
            "chargePoints": true, "pointsCost": 17, "defaultSpeed": 1.5
        }}));
        assert_eq!(config.policy.provider_id, "pocket-tts");
        assert_eq!(config.policy.voice_catalog_revision, "reload-a");
        assert_eq!(config.policy.default_voice, "pocket-tts:owned");
        assert!(!config.policy.special_users[0].allowed);
        assert_eq!(config.policy.allowed_users, ["ada"]);
        assert_eq!(config.policy.points_cost, 17);
        assert_eq!(config.policy.default_speed, 1.5);
        assert_eq!(
            config_from_values(&json!({"tts":{"providerId":"../invalid"}}))
                .policy
                .provider_id,
            "supertonic"
        );
    }
    #[test]
    fn explicit_language_wins_and_scheduler_settings_are_bounded() {
        let config = config_from_values(
            &json!({"defaultLanguage":"es","tts":{"language":"en","chatQueueCapacity":10000,"chatMaxWaitMs":180000,"chatMaxInflight":100,"emptyCatalogRetryMs":0}}),
        );
        assert_eq!(config.policy.language, "en");
        assert_eq!(config.queue_capacity, 64);
        assert_eq!(config.max_wait_age_ms, 30_000);
        assert_eq!(config.max_inflight, 4);
        assert_eq!(config.empty_catalog_retry_ms, 250);
    }
}
