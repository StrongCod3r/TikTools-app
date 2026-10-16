#![forbid(unsafe_code)]
// Release plugin executables must not allocate a console on Windows; the
// host launches them with CREATE_NO_WINDOW and talks over piped stdio.
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! SonicBoom TTS plugin backend.
//!
//! The backend owns speech: it observes `live.ui-event` chat through the
//! SDK event hook, applies the speech policy (comment triggers, user
//! eligibility, affordability, replay dedup), and posts eligible lines to
//! the configured SonicBoom server for playback. The declarative
//! `speak` / `set-output-device` actions and the voice/output option
//! sources run in the host through the automation HTTP engine — no
//! process call, no foreign code — so this binary only implements the
//! observer half. Settings come from the host settings file (see
//! `config`); the isolated UI edits the same object through the broker.
//!
//! Two host-mediated effects stay out of reach by design: points cannot
//! be charged from a process backend (no host call exists for it), so
//! affordability is checked against the delivered totals but never
//! deducted; and speech status reaches the UI only through the shared
//! logs it already renders, not through a backend event channel.

mod config;
mod policy;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use policy::{Author, Deduper};
use tiktools_plugin_sdk::prelude::*;

const DEDUP_WINDOW_MS: u64 = 1500;
const DEDUP_MAX_ENTRIES: usize = 500;
const VOICES_TTL_SECS: u64 = 300;
const SPEAK_TIMEOUT_SECS: u64 = 15;

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

struct SpeechEngine {
    http: reqwest::Client,
    deduper: Deduper,
    voices: Vec<String>,
    voices_fetched_at_ms: u64,
    catalog_key: Option<(String, u64, String, String)>,
    /// Time-seeded xorshift state for random voice picks (no rng dep for
    /// a cosmetic shuffle).
    rng: u64,
}

impl Default for SpeechEngine {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(SPEAK_TIMEOUT_SECS))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            deduper: Deduper::new(DEDUP_WINDOW_MS, DEDUP_MAX_ENTRIES),
            voices: Vec::new(),
            voices_fetched_at_ms: 0,
            catalog_key: None,
            rng: now_millis().max(1),
        }
    }
}

impl SpeechEngine {
    fn next_index(&mut self, len: usize) -> usize {
        // xorshift64*: good enough for voice shuffling.
        let mut x = self.rng.max(1);
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.rng = x;
        ((x.wrapping_mul(0x2545F4914F6CDD1D) >> 32) as usize) % len.max(1)
    }

    /// Server, credential identity, provider and UI revision scope both positive and
    /// empty catalogs. Explicit reload invalidates immediately; TTL is a fallback.
    async fn ensure_voices(&mut self, config: &config::BackendConfig) {
        use std::hash::{Hash, Hasher};
        let mut identity = std::collections::hash_map::DefaultHasher::new();
        config.api_token.hash(&mut identity);
        let key = (
            config.server_url.clone(),
            identity.finish(),
            config.policy.provider_id.clone(),
            config.policy.voice_catalog_revision.clone(),
        );
        if self.catalog_key.as_ref() != Some(&key) {
            self.voices.clear();
            self.voices_fetched_at_ms = 0;
            self.catalog_key = Some(key);
        }
        let server_url = &config.server_url;
        let token = &config.api_token;
        let now = now_millis();
        if now.saturating_sub(self.voices_fetched_at_ms) < VOICES_TTL_SECS * 1000
            && self.voices_fetched_at_ms != 0
        {
            return;
        }
        let url = format!("{server_url}/api/tts/plugin/voices");
        let mut request = self
            .http
            .get(&url)
            .timeout(Duration::from_secs(SPEAK_TIMEOUT_SECS));
        if !token.is_empty() {
            request = request.bearer_auth(token);
        }
        self.voices_fetched_at_ms = now;
        let fetched = match request.send().await {
            Ok(response) if response.status().is_success() => response
                .json::<serde_json::Value>()
                .await
                .ok()
                .map(voice_values),
            Ok(response) => {
                eprintln!(
                    "sonicboom: voice catalog server answered {}",
                    response.status()
                );
                None
            }
            Err(_) => {
                eprintln!("sonicboom: voice catalog request failed");
                None
            }
        };
        self.voices.clear();
        if let Some(voices) = fetched {
            let prefix = format!("{}:", config.policy.provider_id);
            self.voices = voices
                .into_iter()
                .filter(|v| v.starts_with(&prefix))
                .collect();
            self.voices_fetched_at_ms = now;
        }
    }

    async fn speak(
        &self,
        server_url: &str,
        token: &str,
        text: &str,
        voice: &str,
        provider: &str,
        language: &str,
    ) -> Result<String, String> {
        // Mirrors the declarative speak action: POST
        // `/api/tts/play?voice=…&lang=…` with a text/plain body. The
        // observer never interrupts (`play_now` stays a manual control).
        let url = format!(
            "{server_url}/api/tts/play?provider={}&voice={}&lang={}",
            encode_param(provider),
            encode_param(voice),
            encode_param(language)
        );
        let mut request = self
            .http
            .post(&url)
            .timeout(Duration::from_secs(SPEAK_TIMEOUT_SECS))
            .header("Content-Type", "text/plain")
            .body(text.to_owned());
        if !token.is_empty() {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.map_err(|error| {
            // Never log the token: only the outcome and status travel.
            format!("speech request failed: {error}")
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("speech server answered {status}"));
        }
        Ok(format!("spoke {} chars as {voice}", text.chars().count()))
    }
}

/// Percent-encodes one query parameter value (unreserved set passes
/// through; everything else becomes `%XX`). The workspace reqwest build
/// omits the `query` serializer, so the backend encodes by hand.
fn encode_param(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Extracts voice value strings from the plugin catalog, mirroring
/// the host's default option-item mapping (bare strings pass through;
/// objects read `id`, then `value`).
fn voice_values(body: serde_json::Value) -> Vec<String> {
    let items = body.as_array().cloned().unwrap_or_default();
    let mut voices = Vec::new();
    for item in items.iter().take(500) {
        if item.get("disabled").and_then(serde_json::Value::as_bool) == Some(true) {
            continue;
        }
        if let Some(text) = item.as_str() {
            if !text.trim().is_empty() && text.len() <= 256 {
                voices.push(text.trim().to_owned());
            }
            continue;
        }
        let value = item
            .get("id")
            .or_else(|| item.get("value"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 256);
        if let Some(value) = value {
            voices.push(value.to_owned());
        }
    }
    voices
}

impl SpeechEngine {
    async fn process(&mut self, job: Box<SpeechJob>) -> Option<bool> {
        let SpeechJob {
            text,
            author,
            config,
            admitted_at,
        } = *job;
        self.ensure_voices(&config).await;
        if self.voices.is_empty() {
            eprintln!("sonicboom: no authorized voices available for selected provider");
            return Some(false);
        }
        let voices = self.voices.clone();
        let decision = policy::decide(&text, &author, &config.policy, &voices, |len| {
            self.next_index(len)
        });
        if !decision.speak {
            return None;
        }
        if !self.deduper.claim(
            &policy::fingerprint(&author.handle, &decision.spoken_text),
            admitted_at,
        ) {
            return None;
        }
        match self
            .speak(
                &config.server_url,
                &config.api_token,
                &decision.spoken_text,
                &decision.voice,
                &config.policy.provider_id,
                &decision.language,
            )
            .await
        {
            Ok(summary) => {
                eprintln!("sonicboom: {summary}");
                Some(true)
            }
            Err(error) => {
                eprintln!("sonicboom: {error}");
                Some(false)
            }
        }
    }
}

const SPEECH_QUEUE_CAPACITY: usize = 64;

struct SpeechJob {
    text: String,
    author: Author,
    config: config::BackendConfig,
    admitted_at: u64,
}

#[derive(Default)]
struct SpeechStats {
    queued: std::sync::atomic::AtomicU64,
    spoken: std::sync::atomic::AtomicU64,
    failed: std::sync::atomic::AtomicU64,
    rejected: std::sync::atomic::AtomicU64,
    cancelled: std::sync::atomic::AtomicU64,
}

struct SonicBoom {
    settings: config::ConfigCache,
    stats: std::sync::Arc<SpeechStats>,
    jobs: Option<tokio::sync::mpsc::Sender<Box<SpeechJob>>>,
    cancel: tokio::sync::watch::Sender<bool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl Default for SonicBoom {
    fn default() -> Self {
        let (jobs, mut receiver) = tokio::sync::mpsc::channel(SPEECH_QUEUE_CAPACITY);
        let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
        let stats = std::sync::Arc::new(SpeechStats::default());
        let worker_stats = std::sync::Arc::clone(&stats);
        let worker =
            std::thread::Builder::new()
                .name("sonicboom-speech".into())
                .spawn(move || {
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("speech runtime");
                    runtime.block_on(async move {
                let mut engine = SpeechEngine::default();
                loop {
                    let job = tokio::select! {
                        biased;
                        _ = cancelled.changed() => break,
                        job = receiver.recv() => match job { Some(job) => job, None => break },
                    };
                    tokio::select! {
                        biased;
                        _ = cancelled.changed() => { worker_stats.cancelled.fetch_add(1, std::sync::atomic::Ordering::Relaxed); break; },
                        outcome = engine.process(job) => match outcome {
                            Some(true) => { worker_stats.spoken.fetch_add(1, std::sync::atomic::Ordering::Relaxed); },
                            Some(false) => { worker_stats.failed.fetch_add(1, std::sync::atomic::Ordering::Relaxed); },
                            None => {},
                        },
                    }
                }
                receiver.close();
                let pending = receiver.len();
                worker_stats.cancelled.fetch_add(pending as u64, std::sync::atomic::Ordering::Relaxed);
                if pending > 0 { eprintln!("sonicboom: cancelled {pending} queued speech jobs"); }
            });
                })
                .expect("speech worker");
        Self {
            settings: config::ConfigCache::new(),
            stats,
            jobs: Some(jobs),
            cancel,
            worker: Some(worker),
        }
    }
}

impl SonicBoom {
    fn stop(&mut self) {
        let _ = self.cancel.send(true);
        self.jobs.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
            use std::sync::atomic::Ordering::Relaxed;
            eprintln!(
                "sonicboom: speech totals queued={} spoken={} failed={} rejected={} cancelled={}",
                self.stats.queued.load(Relaxed),
                self.stats.spoken.load(Relaxed),
                self.stats.failed.load(Relaxed),
                self.stats.rejected.load(Relaxed),
                self.stats.cancelled.load(Relaxed)
            );
        }
    }
}

impl Drop for SonicBoom {
    fn drop(&mut self) {
        self.stop();
    }
}

impl Plugin for SonicBoom {
    fn shutdown(&mut self, _context: &PluginContext) -> PluginResult<()> {
        self.stop();
        Ok(())
    }

    fn event(&mut self, _context: &PluginContext, event: DomainEventEnvelope) -> PluginResult<()> {
        if event.topic != "live.ui-event" {
            return Ok(());
        }
        let Some(chat) = event.data.get("event") else {
            return Ok(());
        };
        if chat.get("kind").and_then(serde_json::Value::as_str) != Some("chat") {
            return Ok(());
        }
        let text = chat
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if text.trim().is_empty() {
            return Ok(());
        }
        let author = Author {
            handle: chat
                .get("author")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("viewer")
                .to_owned(),
            // Delivered totals gate affordability; role flags are absent
            // on this topic, so role-gated rules correctly stay closed.
            points: chat.get("points").and_then(serde_json::Value::as_f64),
            roles: policy::AuthorRoles::default(),
        };
        let config = self.settings.get().clone();
        if !config.policy.enabled {
            return Ok(());
        }
        // Eligibility needs no HTTP. Voice choice and replay dedup run in
        // the ordered worker with the admission timestamp.
        if !policy::decide(text, &author, &config.policy, &[], |_| 0).speak {
            return Ok(());
        }
        let job = Box::new(SpeechJob {
            text: text.to_owned(),
            author,
            config,
            admitted_at: now_millis(),
        });
        match self.jobs.as_ref().map(|jobs| jobs.try_send(job)) {
            Some(Ok(())) => {
                self.stats
                    .queued
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            Some(Err(tokio::sync::mpsc::error::TrySendError::Full(_))) => {
                self.stats
                    .rejected
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                eprintln!("sonicboom: speech queue full; rejected job");
            }
            _ => return Err(PluginError::other("speech worker stopped")),
        }
        Ok(())
    }
}

tiktools_process_plugin!(SonicBoom);

#[cfg(test)]
mod tests {
    use super::*;

    fn speech_job(server_url: String) -> Box<SpeechJob> {
        let config = config::BackendConfig {
            server_url,
            policy: policy::TtsSettings {
                enabled: true,
                default_voice: "M1".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        Box::new(SpeechJob {
            text: "test".into(),
            author: Author {
                handle: "viewer".into(),
                points: None,
                roles: Default::default(),
            },
            config,
            admitted_at: now_millis(),
        })
    }

    #[test]
    fn slow_http_does_not_block_admission_and_shutdown_cancels_full_queue() {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (started, ready) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut buffer = [0; 4096];
            assert!(stream.read(&mut buffer).unwrap() > 0);
            started.send(()).unwrap();
            // Keep the HTTP response unavailable until the test has stopped
            // the plugin; this exercises cancellation rather than a timeout.
            let _ = released.recv_timeout(Duration::from_secs(5));
        });
        let mut plugin = SonicBoom::default();
        assert!(plugin
            .jobs
            .as_ref()
            .unwrap()
            .try_send(speech_job(url.clone()))
            .is_ok());
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        for _ in 0..SPEECH_QUEUE_CAPACITY {
            assert!(plugin
                .jobs
                .as_ref()
                .unwrap()
                .try_send(speech_job(url.clone()))
                .is_ok());
        }
        assert!(matches!(
            plugin.jobs.as_ref().unwrap().try_send(speech_job(url)),
            Err(tokio::sync::mpsc::error::TrySendError::Full(_))
        ));
        let start = std::time::Instant::now();
        plugin.stop();
        assert!(start.elapsed() < Duration::from_secs(1));
        plugin.stop();
        let _ = release.send(());
        server.join().unwrap();
    }

    #[test]
    fn repeated_speech_worker_creation_and_teardown() {
        for _ in 0..128 {
            let mut plugin = SonicBoom::default();
            plugin.stop();
            assert!(plugin.worker.is_none());
            assert!(plugin.jobs.is_none());
        }
    }

    #[test]
    fn param_encoding_escapes_reserved_characters() {
        assert_eq!(encode_param("M1"), "M1");
        assert_eq!(encode_param("en-US"), "en-US");
        assert_eq!(encode_param("a b&c=d"), "a%20b%26c%3Dd");
    }

    #[test]
    fn voice_extraction_mirrors_host_option_mapping() {
        let body = serde_json::json!([
            "M1",
            {"id": "F1", "name": "Female 1"},
            {"value": "M2"},
            {"name": "nameless"},
            "",
            42,
        ]);
        assert_eq!(
            voice_values(body),
            vec!["M1".to_owned(), "F1".to_owned(), "M2".to_owned()]
        );
    }

    #[test]
    fn package_manifest_matches_the_backend_contract() {
        // The backend, the manifest, and the UI entry evolve together:
        // this test pins the package contract (webview UI, event
        // subscription, process entry) so drift fails loudly.
        let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin.json");
        let raw = std::fs::read_to_string(&manifest_path).expect("plugin.json must exist");
        let manifest =
            tiktools_plugin_sdk::tiktools_plugin_api::manifest::PluginManifest::from_json_str(&raw)
                .expect("plugin.json must parse");
        assert_eq!(manifest.id, "sonicboom.server");
        assert!(
            manifest
                .event_subscriptions
                .iter()
                .any(|subscription| subscription == "live.ui-event"),
            "backend observes live.ui-event"
        );
        let ui = manifest.ui.as_ref().expect("plugin declares its UI");
        assert_eq!(
            ui.mode,
            tiktools_plugin_sdk::tiktools_plugin_api::ui::PluginUiMode::Webview
        );
        let entry = ui.entry.as_deref().expect("webview entry must be set");
        assert!(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("../{entry}"))
                .is_file(),
            "built UI entry must exist at {entry}"
        );
    }
    #[tokio::test]
    async fn catalog_cache_tracks_revision_provider_and_auth_even_with_explicit_default() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (report, received) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            for (code, body) in [
                (
                    "200 OK",
                    r#"[{"id":"supertonic:M1"},{"id":"pocket-tts:old"}]"#,
                ),
                ("200 OK", r#"[{"id":"supertonic:F1"}]"#),
                (
                    "200 OK",
                    r#"[{"id":"pocket-tts:new"},{"id":"qwen3-gguf:foreign"}]"#,
                ),
                ("403 Forbidden", "{}"),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut raw = [0_u8; 4096];
                let n = stream.read(&mut raw).unwrap();
                let line = String::from_utf8_lossy(&raw[..n])
                    .lines()
                    .next()
                    .unwrap()
                    .to_owned();
                report.send(line).unwrap();
                write!(stream, "HTTP/1.1 {code}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let mut engine = SpeechEngine::default();
        let mut config = config::BackendConfig {
            server_url: format!("http://{address}"),
            ..Default::default()
        };
        config.policy.default_voice = "M1".into();
        engine.ensure_voices(&config).await;
        assert_eq!(engine.voices, ["supertonic:M1"]);
        engine.ensure_voices(&config).await; // Cached despite explicit default.
        assert_eq!(received.try_iter().count(), 1);
        config.policy.voice_catalog_revision = "new-ui-reload".into();
        engine.ensure_voices(&config).await;
        assert_eq!(engine.voices, ["supertonic:F1"]);
        config.policy.provider_id = "pocket-tts".into();
        engine.ensure_voices(&config).await;
        assert_eq!(engine.voices, ["pocket-tts:new"]);
        config.api_token = "test-other-tenant".into();
        engine.ensure_voices(&config).await;
        assert!(engine.voices.is_empty());
        assert!(!format!("{:?}", engine.catalog_key).contains(&config.api_token));
        engine.ensure_voices(&config).await; // Empty/error catalogs are cached too.
        server.join().unwrap();
        assert_eq!(
            received.try_iter().collect::<Vec<_>>(),
            vec!["GET /api/tts/plugin/voices HTTP/1.1"; 3]
        );
    }
}
