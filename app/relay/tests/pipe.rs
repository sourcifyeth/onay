//! Runs the relay binary against a fake app socket.

use std::io::Read;
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// A private runtime dir per test, so tests never share a socket.
fn runtime_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("onay-relay-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("onay")).unwrap();
    dir
}

fn spawn_relay(runtime_dir: &PathBuf) -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_onay-relay"))
        .env("XDG_RUNTIME_DIR", runtime_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

#[test]
fn forwards_both_directions_and_exits_when_the_app_closes() {
    let dir = runtime_dir("pipe");
    let listener = UnixListener::bind(dir.join("onay/onay.sock")).unwrap();
    let mut relay = spawn_relay(&dir);
    let (mut app, _) = listener.accept().unwrap();

    let mut stdin = relay.stdin.take().unwrap();
    onay_ipc::write_message(&mut stdin, b"to app").unwrap();
    assert_eq!(
        onay_ipc::read_message(&mut app).unwrap().unwrap(),
        b"to app"
    );

    onay_ipc::write_message(&mut app, b"to browser").unwrap();
    let mut stdout = relay.stdout.take().unwrap();
    assert_eq!(
        onay_ipc::read_message(&mut stdout).unwrap().unwrap(),
        b"to browser"
    );

    // The browser hangs up: the app sees the end of the stream.
    drop(stdin);
    assert!(onay_ipc::read_message(&mut app).unwrap().is_none());

    // The app hangs up: the relay exits and stdout ends.
    drop(app);
    let mut rest = Vec::new();
    stdout.read_to_end(&mut rest).unwrap();
    assert!(rest.is_empty());
    assert!(relay.wait().unwrap().success());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn reports_when_the_app_is_not_running() {
    let dir = runtime_dir("no-app");
    let mut relay = spawn_relay(&dir);
    let mut stdout = relay.stdout.take().unwrap();
    let reply = onay_ipc::read_message(&mut stdout).unwrap().unwrap();
    assert_eq!(reply, br#"{"type":"error","message":"app not running"}"#);
    assert!(!relay.wait().unwrap().success());
    let _ = std::fs::remove_dir_all(dir);
}
