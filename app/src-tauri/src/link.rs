//! The link to the browser extension: a Unix socket the relay connects to.
//! Each connection carries native messaging frames. This module answers
//! pings and reports every message to the webview.

use std::fs;
use std::io::{self, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::host_manifest::{self, Installed};

/// Event the webview listens to. Payload: a `LinkMessage`.
const EVENT: &str = "link-message";

/// What the webview shows about the link.
#[derive(Clone, Serialize)]
pub struct Status {
    pub socket: PathBuf,
    pub relay: Option<PathBuf>,
    pub manifests: Vec<Installed>,
    pub errors: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct LinkMessage {
    pub direction: Direction,
    pub message: String,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    In,
    Out,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Request {
    Ping { id: u64 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Reply {
    Pong { id: u64 },
    Error { message: String },
}

/// Registers the relay with the browsers and starts listening. Failures
/// end up in the status; the window opens either way.
pub fn start(app: AppHandle) -> Status {
    let mut errors = Vec::new();
    let (relay, manifests) = match relay_path() {
        Ok(relay) => {
            let manifests = host_manifest::install(&relay);
            (Some(relay), manifests)
        }
        Err(err) => {
            errors.push(format!("cannot locate the relay binary: {err}"));
            (None, Vec::new())
        }
    };
    let socket = onay_ipc::socket_path();
    match bind(&socket) {
        Ok(listener) => {
            thread::spawn(move || accept_loop(listener, app));
        }
        Err(err) => errors.push(format!("cannot listen on {}: {err}", socket.display())),
    }
    Status {
        socket,
        relay,
        manifests,
        errors,
    }
}

#[tauri::command]
pub fn status(status: tauri::State<'_, Status>) -> Status {
    status.inner().clone()
}

/// The relay ships next to the app binary: in `target/` during development,
/// inside the bundle after packaging.
fn relay_path() -> io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe
        .parent()
        .ok_or_else(|| io::Error::other("executable has no parent directory"))?;
    Ok(dir.join("onay-relay"))
}

fn bind(path: &Path) -> io::Result<UnixListener> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("socket path has no directory"))?;
    fs::create_dir_all(dir)?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    // A socket file left behind by a crashed instance blocks the bind.
    // Remove it only when nothing answers on it.
    if path.exists() {
        if UnixStream::connect(path).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "another Onay instance is running",
            ));
        }
        fs::remove_file(path)?;
    }
    UnixListener::bind(path)
}

fn accept_loop(listener: UnixListener, app: AppHandle) {
    for connection in listener.incoming() {
        match connection {
            Ok(stream) => {
                let app = app.clone();
                thread::spawn(move || {
                    let report = |message| {
                        if let Err(err) = app.emit(EVENT, message) {
                            eprintln!("onay: cannot report to the webview: {err}");
                        }
                    };
                    if let Err(err) = serve(stream, &report) {
                        eprintln!("onay: link connection ended: {err}");
                    }
                });
            }
            Err(err) => eprintln!("onay: accept failed: {err}"),
        }
    }
}

/// Answers every message on one connection until the other side closes.
fn serve(stream: UnixStream, report: &impl Fn(LinkMessage)) -> io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut writer = stream;
    while let Some(bytes) = onay_ipc::read_message(&mut reader)? {
        report(LinkMessage {
            direction: Direction::In,
            message: String::from_utf8_lossy(&bytes).into_owned(),
        });
        let reply = match serde_json::from_slice::<Request>(&bytes) {
            Ok(Request::Ping { id }) => Reply::Pong { id },
            Err(err) => Reply::Error {
                message: format!("unknown request: {err}"),
            },
        };
        let json = serde_json::to_vec(&reply)?;
        onay_ipc::write_message(&mut writer, &json)?;
        report(LinkMessage {
            direction: Direction::Out,
            message: String::from_utf8_lossy(&json).into_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A socket in a private directory, because `bind` chmods the directory.
    fn temp_socket(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("onay-link-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{name}.sock"));
        let _ = fs::remove_file(&path);
        path
    }

    #[test]
    fn answers_ping_with_pong_and_reports_both() {
        let path = temp_socket("ping");
        let listener = bind(&path).unwrap();
        let mut client = UnixStream::connect(&path).unwrap();
        let (server, _) = listener.accept().unwrap();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || serve(server, &move |m| tx.send(m).unwrap()));

        onay_ipc::write_message(&mut client, br#"{"type":"ping","id":7}"#).unwrap();
        let reply = onay_ipc::read_message(&mut client).unwrap().unwrap();
        assert_eq!(reply, br#"{"type":"pong","id":7}"#);

        onay_ipc::write_message(&mut client, br#"{"type":"nonsense"}"#).unwrap();
        let reply = onay_ipc::read_message(&mut client).unwrap().unwrap();
        let json: serde_json::Value = serde_json::from_slice(&reply).unwrap();
        assert_eq!(json["type"], "error");

        drop(client);
        let reported: Vec<LinkMessage> = rx.iter().collect();
        assert_eq!(reported.len(), 4);
        assert!(matches!(reported[0].direction, Direction::In));
        assert!(matches!(reported[1].direction, Direction::Out));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn stale_socket_file_is_replaced_but_a_live_one_is_not() {
        let path = temp_socket("stale");
        let first = bind(&path).unwrap();
        assert!(bind(&path).is_err());
        drop(first);
        // The file stays behind after the listener is gone.
        assert!(path.exists());
        assert!(bind(&path).is_ok());
        let _ = fs::remove_file(&path);
    }
}
