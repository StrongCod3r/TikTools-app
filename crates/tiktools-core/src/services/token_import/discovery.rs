//! Bounded metadata-only discovery. No recursive user-directory traversal.
use super::TokenImportCandidate;
use serde_json::Value;
use std::{
    collections::{hash_map::DefaultHasher, BTreeSet},
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
};
const MAX_ENTRIES: usize = 128;
const MAX_CANDIDATES: usize = 64;
pub(super) struct ImportCandidate {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
}
impl ImportCandidate {
    pub fn descriptor(&self) -> TokenImportCandidate {
        TokenImportCandidate {
            id: self.id.clone(),
            label: self.label.clone(),
        }
    }
}
fn contained(root: &Path, relative: &str) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let path = root.join(relative).canonicalize().ok()?;
    (path.starts_with(&root) && path.is_file()).then_some(path)
}
pub(super) fn folder_config(root: &Path, spec: &Value) -> Option<PathBuf> {
    let parts: Vec<_> = spec
        .pointer("/discovery/relativePath")?
        .as_str()?
        .split('/')
        .collect();
    (0..parts.len()).find_map(|i| contained(root, &parts[i..].join("/")))
}
fn add(found: &mut Vec<ImportCandidate>, root: &Path, relative: &str, label: &str) {
    if found.len() >= MAX_CANDIDATES {
        return;
    }
    let Some(path) = contained(root, relative) else {
        return;
    };
    if found.iter().any(|c| c.path == path) {
        return;
    }
    let mut hash = DefaultHasher::new();
    path.hash(&mut hash);
    // ID is a selector, not authorization: every import re-discovers its path.
    found.push(ImportCandidate {
        id: format!("{:016x}", hash.finish()),
        label: format!("{label} — {}", root.display()),
        path,
    });
}
fn library_paths(text: &str) -> Vec<PathBuf> {
    let mut tokens = Vec::new();
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch != '"' {
            continue;
        }
        let mut token = String::new();
        while let Some(ch) = chars.next() {
            match ch {
                '"' => break,
                '\\' => {
                    if let Some(next) = chars.next() {
                        token.push(next);
                    }
                }
                _ => token.push(ch),
            }
        }
        tokens.push(token);
    }
    tokens
        .windows(2)
        .filter(|p| p[0] == "path")
        .take(MAX_ENTRIES)
        .map(|p| PathBuf::from(&p[1]))
        .collect()
}
fn roots() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default();
    let mut steam = vec![
        home.join(".local/share/Steam"),
        home.join(".steam/steam"),
        home.join(".steam/root"),
        home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        home.join("Library/Application Support/Steam"),
    ];
    for key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(path) = std::env::var_os(key) {
            steam.push(PathBuf::from(path).join("Steam"));
        }
    }
    steam.retain(|p| p.is_absolute());
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let mut bases = vec![config, home.join("Library/Application Support")];
    if let Some(path) = std::env::var_os("APPDATA") {
        bases.push(PathBuf::from(path));
    }
    let managers = bases
        .into_iter()
        .flat_map(|base| {
            [
                base.join("r2modmanPlus-local"),
                base.join("Thunderstore Mod Manager/DataFolder"),
            ]
        })
        .filter(|p| p.is_absolute())
        .collect();
    (steam, managers)
}
pub(super) fn discover(spec: &Value) -> Result<Vec<ImportCandidate>, String> {
    let (steam, managers) = roots();
    discover_at(spec, &steam, &managers)
}
fn discover_at(
    spec: &Value,
    steam: &[PathBuf],
    managers: &[PathBuf],
) -> Result<Vec<ImportCandidate>, String> {
    let d = spec.get("discovery").ok_or("Missing discovery settings")?;
    let relative = d["relativePath"]
        .as_str()
        .ok_or("Missing configuration path")?;
    let folder = d["steamFolder"].as_str().ok_or("Missing game folder")?;
    let game = d["modManagerGame"]
        .as_str()
        .ok_or("Missing mod-manager game")?;
    let mut libraries: BTreeSet<PathBuf> = steam.iter().cloned().collect();
    for root in steam {
        let metadata = root.join("steamapps/libraryfolders.vdf");
        if !std::fs::metadata(&metadata).is_ok_and(|m| m.is_file() && m.len() <= 128 * 1024) {
            continue;
        }
        let Ok(file) = std::fs::File::open(metadata) else {
            continue;
        };
        if !file
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() <= 128 * 1024)
        {
            continue;
        }
        let mut text = String::new();
        if file.take(128 * 1024 + 1).read_to_string(&mut text).is_ok() && text.len() <= 128 * 1024 {
            for path in library_paths(&text) {
                if path.is_absolute() && libraries.len() < MAX_ENTRIES {
                    libraries.insert(path);
                }
            }
        }
    }
    let mut found = Vec::new();
    for library in libraries {
        add(
            &mut found,
            &library.join("steamapps/common").join(folder),
            relative,
            "Steam",
        );
    }
    for manager in managers {
        let profiles = manager.join(game).join("profiles");
        let Ok(root) = profiles.canonicalize() else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(&profiles) else {
            continue;
        };
        let mut profiles: Vec<_> = entries
            .take(MAX_ENTRIES)
            .flatten()
            .map(|e| e.path())
            .collect();
        profiles.sort();
        for profile in profiles {
            if !profile.canonicalize().is_ok_and(|p| p.starts_with(&root)) {
                continue;
            }
            let name = profile
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("profile");
            add(
                &mut found,
                &profile,
                relative,
                &format!("Mod profile: {name}"),
            );
        }
    }
    Ok(found)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn spec() -> Value {
        serde_json::json!({"discovery":{"relativePath":"BepInEx/config/test.cfg","steamFolder":"REPO","modManagerGame":"REPO"}})
    }
    #[test]
    fn discovers_libraries_and_profiles_without_reading_credentials() {
        let root = std::env::temp_dir().join(format!("setup-discovery-{}", fastrand::u64(..)));
        let steam = root.join("Steam");
        let library = root.join("Other");
        let manager = root.join("r2modmanPlus-local");
        for path in [
            steam.join("steamapps/common/REPO"),
            library.join("steamapps/common/REPO"),
            manager.join("REPO/profiles/Default"),
            manager.join("REPO/profiles/Stream"),
        ] {
            std::fs::create_dir_all(path.join("BepInEx/config")).unwrap();
            std::fs::write(path.join("BepInEx/config/test.cfg"), [0xff, 0xfe]).unwrap();
        }
        std::fs::write(
            steam.join("steamapps/libraryfolders.vdf"),
            format!("\"path\" \"{}\"", library.display()),
        )
        .unwrap();
        let found = discover_at(&spec(), std::slice::from_ref(&steam), &[manager]).unwrap();
        assert_eq!(found.len(), 4);
        assert!(found.iter().any(|c| c.label.contains("Stream")));
        assert!(folder_config(&steam.join("steamapps/common/REPO"), &spec()).is_some());
        assert!(folder_config(&root.join("missing"), &spec()).is_none());
        assert_eq!(discover_at(&spec(), &[], &[]).unwrap().len(), 0);
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn windows_library_paths_decode_backslashes() {
        assert_eq!(
            library_paths(r#""path" "D:\\SteamLibrary""#),
            vec![PathBuf::from("D:\\SteamLibrary")]
        );
    }
    #[cfg(unix)]
    #[test]
    fn configuration_symlinks_cannot_escape_selected_folder() {
        let root = std::env::temp_dir().join(format!("discovery-links-{}", fastrand::u64(..)));
        std::fs::create_dir_all(root.join("game/BepInEx")).unwrap();
        std::fs::create_dir_all(root.join("outside")).unwrap();
        std::fs::write(root.join("outside/test.cfg"), "private fixture").unwrap();
        std::os::unix::fs::symlink(root.join("outside"), root.join("game/BepInEx/config")).unwrap();
        assert!(folder_config(&root.join("game"), &spec()).is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}
