//! Registers the relay with Chromium-based browsers. Each browser reads a
//! JSON file from a fixed per-user directory and starts the binary named
//! in it. Only the extension IDs listed in the file may connect.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use onay_ipc::{EXTENSION_ID, HOST_NAME};
use serde::Serialize;

/// Browser configuration directories, relative to the user's home. A
/// browser that has none is not installed and is skipped.
#[cfg(target_os = "linux")]
const BROWSER_DIRS: &[&str] = &[".config/google-chrome", ".config/chromium"];
#[cfg(target_os = "macos")]
const BROWSER_DIRS: &[&str] = &[
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Chromium",
];
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
compile_error!("Onay supports Linux and macOS only");

#[derive(Serialize)]
struct HostManifest<'a> {
    name: &'a str,
    description: &'a str,
    path: &'a Path,
    #[serde(rename = "type")]
    kind: &'a str,
    allowed_origins: [String; 1],
}

/// One manifest file and whether writing it worked.
#[derive(Clone, Serialize)]
pub struct Installed {
    pub path: PathBuf,
    pub error: Option<String>,
}

/// Writes the manifest into every installed browser's directory.
pub fn install(relay: &Path) -> Vec<Installed> {
    match std::env::home_dir() {
        Some(home) => install_into(&home, relay),
        None => vec![Installed {
            path: PathBuf::new(),
            error: Some("home directory unknown".into()),
        }],
    }
}

fn install_into(home: &Path, relay: &Path) -> Vec<Installed> {
    let manifest = HostManifest {
        name: HOST_NAME,
        description: "Onay native messaging relay",
        path: relay,
        kind: "stdio",
        allowed_origins: [format!("chrome-extension://{EXTENSION_ID}/")],
    };
    let json = serde_json::to_vec_pretty(&manifest).expect("manifest serializes");
    BROWSER_DIRS
        .iter()
        .map(|dir| home.join(dir))
        .filter(|dir| dir.is_dir())
        .map(|dir| {
            let path = dir
                .join("NativeMessagingHosts")
                .join(format!("{HOST_NAME}.json"));
            let error = write(&path, &json).err().map(|e| e.to_string());
            Installed { path, error }
        })
        .collect()
}

fn write(path: &Path, json: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_one_manifest_per_installed_browser() {
        let home = std::env::temp_dir().join(format!("onay-manifest-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join(BROWSER_DIRS[1])).unwrap();

        let installed = install_into(&home, Path::new("/opt/onay/onay-relay"));
        assert_eq!(installed.len(), 1);
        assert!(installed[0].error.is_none());
        assert!(installed[0].path.starts_with(home.join(BROWSER_DIRS[1])));

        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(&installed[0].path).unwrap()).unwrap();
        assert_eq!(json["name"], HOST_NAME);
        assert_eq!(json["type"], "stdio");
        assert_eq!(json["path"], "/opt/onay/onay-relay");
        assert_eq!(
            json["allowed_origins"][0],
            format!("chrome-extension://{EXTENSION_ID}/")
        );
        let _ = fs::remove_dir_all(&home);
    }
}
