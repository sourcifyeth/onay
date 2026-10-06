//! The app's long-term key and the list of paired extensions. Both are in
//! one file in the app data directory. Only the user can read the file.

use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};

use crate::channel::{Identity, KEY_LEN};

const FILE_NAME: &str = "link.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    secret_key: String,
    paired: Vec<Paired>,
}

/// One extension that the user approved.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paired {
    public_key: String,
    /// Seconds since the Unix epoch.
    paired_at: u64,
}

pub struct Store {
    path: PathBuf,
    identity: Identity,
    paired: Vec<Paired>,
}

impl Store {
    /// Reads the file in `dir`. Makes a new key if there is no file. A
    /// damaged file is an error: a silent new key would drop all pairings.
    pub fn open(dir: &Path) -> io::Result<Self> {
        let path = dir.join(FILE_NAME);
        match fs::read(&path) {
            Ok(bytes) => {
                let data: Data = serde_json::from_slice(&bytes)?;
                let secret: [u8; KEY_LEN] = decode_key(&data.secret_key)
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bad secret key"))?;
                Ok(Self {
                    path,
                    identity: Identity::from_bytes(secret),
                    paired: data.paired,
                })
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                let store = Self {
                    path,
                    identity: Identity::generate().map_err(io::Error::other)?,
                    paired: Vec::new(),
                };
                store.save()?;
                Ok(store)
            }
            Err(err) => Err(err),
        }
    }

    pub fn identity(&self) -> &Identity {
        &self.identity
    }

    pub fn is_paired(&self, extension_key: &[u8; KEY_LEN]) -> bool {
        let key = BASE64.encode(extension_key);
        self.paired.iter().any(|paired| paired.public_key == key)
    }

    pub fn pair(&mut self, extension_key: &[u8; KEY_LEN]) -> io::Result<()> {
        if self.is_paired(extension_key) {
            return Ok(());
        }
        self.paired.push(Paired {
            public_key: BASE64.encode(extension_key),
            paired_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_secs()),
        });
        self.save()
    }

    /// Writes a new file and moves it into place, so a crash cannot leave
    /// half a file.
    fn save(&self) -> io::Result<()> {
        let data = Data {
            secret_key: BASE64.encode(self.identity.secret_bytes()),
            paired: self.paired.clone(),
        };
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
        }
        let temp = self.path.with_extension("json.tmp");
        let _ = fs::remove_file(&temp);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(&serde_json::to_vec_pretty(&data)?)?;
        file.sync_all()?;
        fs::rename(&temp, &self.path)
    }
}

pub fn decode_key<const N: usize>(text: &str) -> Option<[u8; N]> {
    BASE64.decode(text).ok()?.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::MetadataExt;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("onay-store-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn keeps_the_key_and_the_pairings_between_runs() {
        let dir = temp_dir("keeps");
        let mut store = Store::open(&dir).unwrap();
        let public_key = store.identity().public_key();
        assert!(!store.is_paired(&[7; KEY_LEN]));
        store.pair(&[7; KEY_LEN]).unwrap();
        store.pair(&[7; KEY_LEN]).unwrap();

        let store = Store::open(&dir).unwrap();
        assert_eq!(store.identity().public_key(), public_key);
        assert!(store.is_paired(&[7; KEY_LEN]));
        assert!(!store.is_paired(&[8; KEY_LEN]));
        assert_eq!(store.paired.len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn only_the_user_can_read_the_file() {
        let dir = temp_dir("mode");
        Store::open(&dir).unwrap();
        let mode = fs::metadata(dir.join(FILE_NAME)).unwrap().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_damaged_file_is_an_error() {
        let dir = temp_dir("damaged");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), b"not json").unwrap();
        assert!(Store::open(&dir).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
