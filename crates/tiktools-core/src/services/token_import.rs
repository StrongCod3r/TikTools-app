//! User-selected local credential import. Plugins declare a parser, never a path.
//! File bytes and extracted credentials stay inside the host.

use serde_json::Value;
use std::{fs::File, io::Read, path::Path};
use tiktools_plugin_api::PluginManifest;

const MAX_CONFIG_BYTES: u64 = 64 * 1024;

pub(crate) fn supports_token_import(manifest: &PluginManifest) -> bool {
    let Some(http) = manifest.http.as_ref() else {
        return false;
    };
    let Some(spec) = http.get("tokenImport") else {
        return false;
    };
    let setting = http
        .pointer("/auth/tokenSetting")
        .and_then(Value::as_str)
        .unwrap_or_default();
    spec.get("format").and_then(Value::as_str) == Some("ini")
        && crate::services::capabilities::secret_setting_keys(manifest)
            .iter()
            .any(|key| key == setting)
}

fn read_token(path: &Path, spec: &Value) -> Result<String, String> {
    // Reject special files before opening (e.g. a FIFO that could block).
    if !std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return Err("Select a regular configuration file.".to_owned());
    }
    // Recheck the opened handle and bound reads even if the file grows.
    let file = File::open(path).map_err(|_| "Could not open the selected configuration file.")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Could not inspect the selected file.")?;
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
        return Err("Select a regular configuration file smaller than 64 KiB.".to_owned());
    }
    let mut bytes = Vec::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the selected configuration file.")?;
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err("Configuration file exceeds 64 KiB.".to_owned());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Configuration must be UTF-8 text.")?;
    parse_ini_token(text, spec)
}

fn parse_ini_token(text: &str, spec: &Value) -> Result<String, String> {
    let section = spec["section"]
        .as_str()
        .ok_or("Invalid token import section.")?;
    let key = spec["key"].as_str().ok_or("Invalid token import key.")?;
    let mut current = "";
    let mut token = None;
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current = line[1..line.len() - 1].trim();
            continue;
        }
        if current != section {
            continue;
        }
        if let Some((name, value)) = line.split_once('=') {
            if name.trim() == key {
                if token.is_some() {
                    return Err("The configuration has duplicate token entries; select an unambiguous file.".to_owned());
                }
                token = Some(value.trim());
            }
        }
    }
    let token = token.ok_or("Token entry was not found. Start the game/server once, then select its generated configuration file.")?;
    let minimum = spec.get("minLength").and_then(Value::as_u64).unwrap_or(1) as usize;
    if token.len() < minimum
        || token.len() > 4096
        || token.chars().any(char::is_whitespace)
        || token.chars().any(char::is_control)
    {
        return Err("The configuration contains an empty or invalid token. Start the game/server to generate one.".to_owned());
    }
    Ok(token.to_owned())
}

impl crate::AppCore {
    /// The native picker is the authorization boundary: no caller- or
    /// manifest-supplied filesystem path is accepted by the control API.
    pub async fn plugin_token_import(
        self: &std::sync::Arc<Self>,
        id: &str,
    ) -> Result<crate::control::PluginProvisionResult, crate::control::OperationError> {
        use crate::control::{OperationError, PluginProvisionResult};
        use tiktools_plugin_api::{MediaKind, MediaPickerMode, MediaPickerOptions};
        let plugin = self.require_discovered(id)?;
        let id = plugin.manifest.id.clone();
        let failure = |message: &str| PluginProvisionResult {
            plugin_id: id.clone(),
            ok: false,
            error: Some(message.to_owned()),
        };
        if !self.plugin_ready(&id) || !supports_token_import(&plugin.manifest) {
            return Ok(failure(
                "Enable a plugin declaring a supported secret token import first.",
            ));
        }
        static PICKER: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
        let Ok(_permit) = PICKER.try_acquire() else {
            return Ok(failure("Another token import is already in progress."));
        };
        let spec = plugin.manifest.http.as_ref().unwrap()["tokenImport"].clone();
        let file_name = spec["fileName"].as_str().unwrap_or("server configuration");
        let selected = match self.media.open_picker(MediaPickerOptions {
            mode: MediaPickerMode::File, kind: MediaKind::Other,
            title: Some(format!("Import token — select {file_name}")),
            extensions: vec!["cfg".to_owned(), "ini".to_owned(), "conf".to_owned()],
            ..Default::default()
        }).await {
            Ok(Some(path)) => path,
            Ok(None) => return Ok(PluginProvisionResult { plugin_id: id, ok: false, error: None }),
            Err(_) => return Ok(failure("The native file picker is unavailable. Use the desktop app or enter the token manually.")),
        };
        let read_spec = spec.clone();
        let token =
            match tokio::task::spawn_blocking(move || read_token(&selected, &read_spec)).await {
                Ok(Ok(token)) => token,
                Ok(Err(error)) => return Ok(failure(&error)),
                Err(_) => return Ok(failure("Could not read the selected configuration.")),
            };
        // A dialog may remain open while a plugin is disabled or replaced.
        let current = self.require_discovered(&id)?;
        if !self.plugin_ready(&id)
            || current.manifest.http != plugin.manifest.http
            || !supports_token_import(&current.manifest)
        {
            return Ok(failure(
                "Plugin configuration changed while selecting the file. Try importing again.",
            ));
        }
        let setting = current
            .manifest
            .http
            .as_ref()
            .unwrap()
            .pointer("/auth/tokenSetting")
            .and_then(Value::as_str)
            .unwrap();
        let settings = self
            .capabilities
            .load_plugin_settings_raw(&current.manifest)
            .map_err(|_| OperationError::internal("Could not load plugin settings."))?;
        let mut values: std::collections::BTreeMap<String, Value> = settings
            .as_object()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect();
        values.insert(setting.to_owned(), Value::String(token));
        self.plugin_settings_save(&id, values)
            .map_err(|_| OperationError::internal("Could not securely save the imported token."))?;
        Ok(PluginProvisionResult {
            plugin_id: id,
            ok: true,
            error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn spec() -> Value {
        json!({"section":"HTTP", "key":"AuthenticationToken", "minLength":43})
    }
    #[test]
    fn bepinex_ini_preserves_base64_padding_and_ignores_other_sections() {
        let token = "x".repeat(43) + "=";
        let text = format!("\u{feff}# BepInEx\r\n[Other]\r\nAuthenticationToken = ignored\r\n[HTTP]\r\n## secret\r\nAuthenticationToken = {token}\r\n");
        assert_eq!(parse_ini_token(&text, &spec()).unwrap(), token);
    }
    #[test]
    fn errors_never_echo_configuration_or_credentials() {
        for text in [
            "[HTTP]\nAuthenticationToken=secret",
            "[HTTP]\nAuthenticationToken=",
            "[HTTP]\nAuthenticationToken=private one",
            "[Other]\nAuthenticationToken=private",
            "[HTTP]\nAuthenticationToken=private\nAuthenticationToken=private",
        ] {
            let error = parse_ini_token(text, &spec()).unwrap_err();
            assert!(!error.contains("private") && !error.contains("secret"));
        }
    }
    #[test]
    fn only_repo_opts_in_and_requires_a_secret_destination() {
        let mut doc: Value =
            serde_json::from_str(include_str!("../../../../examples/repo-game/plugin.json"))
                .unwrap();
        let manifest = PluginManifest::from_json_str(&doc.to_string()).unwrap();
        assert!(supports_token_import(&manifest));
        doc["settings"]["schema"]["properties"]["apiToken"]["secret"] = json!(false);
        assert!(!supports_token_import(
            &PluginManifest::from_json_str(&doc.to_string()).unwrap()
        ));
        for source in [
            include_str!("../../../../examples/sonicboom-server/plugin.json"),
            include_str!("../../../../examples/minecraft-server/plugin.json"),
        ] {
            assert!(!supports_token_import(
                &PluginManifest::from_json_str(source).unwrap()
            ));
        }
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::{MediaHost, MediaHostError, MediaHostFuture};
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };
    use tiktools_plugin_api::{
        AudioPlayOptions, AudioPlaybackResult, MediaFileRef, MediaPickerOptions,
    };

    struct Picker {
        path: Mutex<Option<PathBuf>>,
        calls: AtomicUsize,
    }
    impl MediaHost for Picker {
        fn open_picker(&self, options: MediaPickerOptions) -> MediaHostFuture<Option<PathBuf>> {
            assert_eq!(options.kind, tiktools_plugin_api::MediaKind::Other);
            assert!(options.title.unwrap().contains("org.repo.rest-api.cfg"));
            self.calls.fetch_add(1, Ordering::SeqCst);
            let path = self.path.lock().unwrap().clone();
            Box::pin(async move { Ok(path) })
        }
        fn play_audio(
            &self,
            _: MediaFileRef,
            _: AudioPlayOptions,
        ) -> MediaHostFuture<AudioPlaybackResult> {
            Box::pin(async { Err(MediaHostError::Failed("not used".to_owned())) })
        }
    }
    struct Emitter;
    impl crate::HostEmitter for Emitter {
        fn emit(&self, _: crate::ipc::messages::HostMessage) {}
    }

    #[tokio::test]
    async fn native_import_persists_only_secret_and_preserves_settings_on_cancel_or_error() {
        let root = std::env::temp_dir().join(format!(
            "tiktools-import-{}-{}",
            std::process::id(),
            fastrand::u64(..)
        ));
        let package = root.join("packages/repo.game");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(
            package.join("plugin.json"),
            include_str!("../../../../examples/repo-game/plugin.json"),
        )
        .unwrap();
        let config = root.join("org.repo.rest-api.cfg");
        let token = "fixture".repeat(7) + "==";
        std::fs::write(&config, format!("[HTTP]\nAuthenticationToken = {token}\n")).unwrap();
        let picker = Arc::new(Picker {
            path: Mutex::new(Some(config.clone())),
            calls: AtomicUsize::new(0),
        });
        let manager =
            tiktools_plugin_loader::PluginManager::new(vec![tiktools_plugin_loader::PluginRoot {
                path: root.join("packages"),
                source: tiktools_plugin_loader::PluginSource::Development,
            }]);
        manager.scan().unwrap();
        let mut core = crate::AppCore::with_media_host(Arc::new(Emitter), picker.clone());
        core.plugins = Arc::new(manager);
        core.capabilities = Arc::new(crate::services::capabilities::CapabilityBroker::new(
            root.join("data"),
        ));
        let core = Arc::new(core);
        core.set_plugin_activation("repo.game", true, true);
        core.plugin_settings_save(
            "repo.game",
            [("quantity".to_owned(), serde_json::json!(3))].into(),
        )
        .unwrap();
        let result = core.plugin_token_import("repo.game").await.unwrap();
        assert!(result.ok, "{result:?}");
        assert!(!serde_json::to_string(&result).unwrap().contains(&token));
        let display = core.plugin_settings("repo.game").unwrap();
        assert_eq!(display.values["quantity"], 3);
        assert_eq!(
            display.values["apiToken"],
            crate::services::capabilities::SECRET_SETTING_PLACEHOLDER
        );
        let manifest = &core.plugins.get("repo.game").unwrap().manifest;
        assert_eq!(
            core.capabilities
                .load_plugin_settings_raw(manifest)
                .unwrap()["apiToken"],
            token
        );
        // Autosaving a masked value after import must keep the credential.
        core.plugin_settings_save("repo.game", display.values)
            .unwrap();
        assert_eq!(
            core.capabilities
                .load_plugin_settings_raw(manifest)
                .unwrap()["apiToken"],
            token
        );
        *picker.path.lock().unwrap() = None;
        let cancelled = core.plugin_token_import("repo.game").await.unwrap();
        assert!(!cancelled.ok && cancelled.error.is_none());
        *picker.path.lock().unwrap() = Some(config.clone());
        std::fs::write(
            &config,
            "[HTTP]\nAuthenticationToken = invalid-private-value\n",
        )
        .unwrap();
        let invalid = core.plugin_token_import("repo.game").await.unwrap();
        assert!(!invalid.ok);
        assert!(!invalid.error.unwrap().contains("invalid-private-value"));
        assert_eq!(
            core.capabilities
                .load_plugin_settings_raw(manifest)
                .unwrap()["apiToken"],
            token
        );
        core.set_plugin_activation("repo.game", true, false);
        let before = picker.calls.load(Ordering::SeqCst);
        assert!(!core.plugin_token_import("repo.game").await.unwrap().ok);
        assert_eq!(picker.calls.load(Ordering::SeqCst), before);
        // Oversized and missing files fail without echoing file contents/paths.
        std::fs::write(&config, vec![b'x'; MAX_CONFIG_BYTES as usize + 1]).unwrap();
        assert!(read_token(
            &config,
            &serde_json::json!({"section":"HTTP","key":"AuthenticationToken"})
        )
        .is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
