//! The link to the browser extension: a Unix socket the relay connects to.
//!
//! One connection goes through these steps:
//! 1. The peer check (`peer.rs`). A peer that fails gets one error message.
//! 2. Both sides send a `hello` in the clear: public key and salt.
//! 3. All later messages are sealed (`channel.rs`).
//! 4. An extension the user did not approve before must be paired first.
//!    The window shows a code, and the extension shows the same code.
//! 5. The extension sends each signing request it sees. The wallet gets
//!    the same request at the same time. The app only shows it.
//!
//! `extension/src/messages.ts` has the same message types.

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, BufReader};
use std::net::Shutdown;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::channel::{self, Hello, KEY_LEN, Opener, Role, SALT_LEN, Sealer};
use crate::host_manifest::Installed;
use crate::peer::Verdict;
use crate::store::{Store, decode_key};

/// How long a new connection has to send its hello.
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// The window keeps this many requests and this many rejected connections.
const MAX_REQUESTS: usize = 50;
const MAX_REJECTED: usize = 5;
/// Limits for text fields that come from the extension.
const MAX_ID_LEN: usize = 128;
const MAX_METHOD_LEN: usize = 64;
const MAX_ORIGIN_LEN: usize = 2048;
/// The largest chain ID that JavaScript can hold as a number.
const MAX_CHAIN_ID: u64 = (1 << 53) - 1;

// ---- Messages on the wire ----

/// From the extension, in the clear.
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum ClientFrame {
    Hello {
        version: u32,
        public_key: String,
        salt: String,
    },
    Sealed {
        data: String,
    },
}

/// To the extension, in the clear.
#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum ServerFrame {
    Hello {
        version: u32,
        public_key: String,
        salt: String,
        paired: bool,
    },
    Sealed {
        data: String,
    },
    Error {
        message: String,
    },
}

/// From the extension, inside a sealed frame.
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum ClientMessage {
    /// A page asked the wallet to sign.
    Request {
        id: String,
        origin: String,
        method: String,
        params: Value,
        /// The wallet's chain, for eth_sendTransaction only. The page
        /// reports it, so it is not verified.
        chain_id: Option<u64>,
    },
    /// The wallet answered the page.
    Settled { id: String, outcome: Outcome },
}

/// To the extension, inside a sealed frame.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerMessage {
    Paired,
    PairingRejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Fulfilled,
    Rejected,
}

// ---- What the window shows ----

/// Mirrored by `Snapshot` in app/src/messages.ts.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    socket: PathBuf,
    relay: Option<PathBuf>,
    manifests: Vec<Installed>,
    errors: Vec<String>,
    connections: Vec<ConnectionInfo>,
    requests: Vec<SigningRequest>,
    /// Why the app refused the most recent connections.
    rejected: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    id: u64,
    /// The browser binary, if the peer check found it.
    browser: Option<String>,
    verified: bool,
    /// Set while the user must approve this extension.
    pairing_code: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningRequest {
    connection: u64,
    id: String,
    origin: String,
    method: String,
    params: Value,
    /// Not verified: the page reports it.
    chain_id: Option<u64>,
    /// Milliseconds since the Unix epoch.
    received_at: u64,
    /// The answer of the wallet, when it is known.
    outcome: Option<Outcome>,
}

pub enum Notice {
    Changed,
    NewRequest,
}

/// What the app set up at start, and what went wrong.
#[derive(Default)]
pub struct Setup {
    pub socket: PathBuf,
    pub relay: Option<PathBuf>,
    pub manifests: Vec<Installed>,
    pub errors: Vec<String>,
}

struct Connection {
    info: ConnectionInfo,
    extension_key: [u8; KEY_LEN],
    sealer: Sealer,
    writer: UnixStream,
}

struct State {
    setup: Setup,
    store: Store,
    next_connection: u64,
    connections: BTreeMap<u64, Connection>,
    requests: Vec<SigningRequest>,
    rejected: Vec<String>,
}

type Verify = dyn Fn(&UnixStream) -> Verdict + Send + Sync;
type Notify = dyn Fn(Notice) + Send + Sync;

pub struct Link {
    state: Mutex<State>,
    verify: Box<Verify>,
    notify: Box<Notify>,
}

fn protocol_error(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn send_clear(writer: &mut UnixStream, frame: &ServerFrame) -> io::Result<()> {
    onay_ipc::write_message(writer, &serde_json::to_vec(frame)?)
}

impl Connection {
    fn send(&mut self, message: &ServerMessage) -> io::Result<()> {
        let sealed = self
            .sealer
            .seal(&serde_json::to_vec(message)?)
            .map_err(io::Error::other)?;
        let frame = ServerFrame::Sealed {
            data: BASE64.encode(sealed),
        };
        send_clear(&mut self.writer, &frame)
    }
}

impl Link {
    pub fn new(setup: Setup, store: Store, verify: Box<Verify>, notify: Box<Notify>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                setup,
                store,
                next_connection: 1,
                connections: BTreeMap::new(),
                requests: Vec::new(),
                rejected: Vec::new(),
            }),
            verify,
            notify,
        })
    }

    fn state(&self) -> MutexGuard<'_, State> {
        // A panic in another thread must not stop the link.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn snapshot(&self) -> Snapshot {
        let state = self.state();
        Snapshot {
            socket: state.setup.socket.clone(),
            relay: state.setup.relay.clone(),
            manifests: state.setup.manifests.clone(),
            errors: state.setup.errors.clone(),
            connections: state.connections.values().map(|c| c.info.clone()).collect(),
            requests: state.requests.clone(),
            rejected: state.rejected.clone(),
        }
    }

    /// The answer of the user to a pairing request.
    pub fn answer_pairing(&self, connection: u64, approve: bool) -> Result<(), String> {
        let mut state = self.state();
        let State {
            connections, store, ..
        } = &mut *state;
        let pending = connections
            .get_mut(&connection)
            .filter(|c| c.info.pairing_code.is_some())
            .ok_or("this connection does not wait for pairing")?;
        if approve {
            store
                .pair(&pending.extension_key)
                .map_err(|err| format!("cannot save the pairing: {err}"))?;
            pending.info.pairing_code = None;
            pending.send(&ServerMessage::Paired)
        } else {
            let sent = pending.send(&ServerMessage::PairingRejected);
            // The reader thread sees the end of the stream and removes the connection.
            let _ = pending.writer.shutdown(Shutdown::Both);
            sent
        }
        .map_err(|err| format!("cannot tell the extension: {err}"))?;
        drop(state);
        (self.notify)(Notice::Changed);
        Ok(())
    }

    pub fn dismiss_request(&self, connection: u64, id: &str) {
        self.state()
            .requests
            .retain(|r| !(r.connection == connection && r.id == id));
        (self.notify)(Notice::Changed);
    }

    pub fn listen(self: &Arc<Self>, listener: UnixListener) {
        let link = Arc::clone(self);
        thread::spawn(move || {
            for connection in listener.incoming() {
                match connection {
                    Ok(stream) => {
                        let link = Arc::clone(&link);
                        thread::spawn(move || {
                            if let Err(err) = link.serve(stream) {
                                eprintln!("onay: link connection ended: {err}");
                            }
                        });
                    }
                    Err(err) => eprintln!("onay: accept failed: {err}"),
                }
            }
        });
    }

    /// Runs one connection until the other side closes it.
    fn serve(&self, stream: UnixStream) -> io::Result<()> {
        let mut writer = stream.try_clone()?;
        let (browser, verified) = match (self.verify)(&stream) {
            Verdict::Verified { browser } => (Some(browser.display().to_string()), true),
            Verdict::Unsupported => (None, false),
            Verdict::Rejected(reason) => {
                let message = format!("The Onay app refused the connection: {reason}.");
                let sent = send_clear(&mut writer, &ServerFrame::Error { message });
                let mut state = self.state();
                state.rejected.push(reason);
                let excess = state.rejected.len().saturating_sub(MAX_REJECTED);
                state.rejected.drain(..excess);
                drop(state);
                (self.notify)(Notice::Changed);
                return sent;
            }
        };

        stream.set_read_timeout(Some(HELLO_TIMEOUT))?;
        let mut reader = BufReader::new(stream.try_clone()?);
        let (id, mut opener) = self.handshake(&mut reader, writer, browser, verified)?;
        stream.set_read_timeout(None)?;
        (self.notify)(Notice::Changed);

        let result = self.read_messages(id, &mut reader, &mut opener);
        self.state().connections.remove(&id);
        let _ = stream.shutdown(Shutdown::Both);
        (self.notify)(Notice::Changed);
        result
    }

    /// Exchanges the hellos and registers the connection.
    fn handshake(
        &self,
        reader: &mut BufReader<UnixStream>,
        mut writer: UnixStream,
        browser: Option<String>,
        verified: bool,
    ) -> io::Result<(u64, Opener)> {
        let bytes = onay_ipc::read_message(reader)?.ok_or_else(|| protocol_error("no hello"))?;
        let ClientFrame::Hello {
            version,
            public_key,
            salt,
        } = serde_json::from_slice(&bytes)?
        else {
            return Err(protocol_error("the first message is not a hello"));
        };
        if version != channel::VERSION {
            let message = "The Onay app and the extension have different versions.".into();
            send_clear(&mut writer, &ServerFrame::Error { message })?;
            return Err(protocol_error("unsupported version"));
        }
        let extension = Hello {
            public_key: decode_key::<KEY_LEN>(&public_key)
                .ok_or_else(|| protocol_error("bad public key"))?,
            salt: decode_key::<SALT_LEN>(&salt).ok_or_else(|| protocol_error("bad salt"))?,
        };

        let mut state = self.state();
        let app = Hello {
            public_key: state.store.identity().public_key(),
            salt: channel::random().map_err(io::Error::other)?,
        };
        let (sealer, opener) =
            channel::session(state.store.identity(), Role::App, &extension, &app)
                .map_err(io::Error::other)?;
        let paired = state.store.is_paired(&extension.public_key);
        send_clear(
            &mut writer,
            &ServerFrame::Hello {
                version: channel::VERSION,
                public_key: BASE64.encode(app.public_key),
                salt: BASE64.encode(app.salt),
                paired,
            },
        )?;

        let id = state.next_connection;
        state.next_connection += 1;
        let pairing_code =
            (!paired).then(|| channel::pairing_code(&extension.public_key, &app.public_key));
        state.connections.insert(
            id,
            Connection {
                info: ConnectionInfo {
                    id,
                    browser,
                    verified,
                    pairing_code,
                },
                extension_key: extension.public_key,
                sealer,
                writer,
            },
        );
        Ok((id, opener))
    }

    fn read_messages(
        &self,
        connection: u64,
        reader: &mut BufReader<UnixStream>,
        opener: &mut Opener,
    ) -> io::Result<()> {
        while let Some(bytes) = onay_ipc::read_message(reader)? {
            let ClientFrame::Sealed { data } = serde_json::from_slice(&bytes)? else {
                return Err(protocol_error("a message after the hello is not sealed"));
            };
            let sealed = BASE64
                .decode(data)
                .map_err(|_| protocol_error("bad base64"))?;
            let plaintext = opener.open(&sealed).map_err(io::Error::other)?;
            self.handle(connection, serde_json::from_slice(&plaintext)?)?;
        }
        Ok(())
    }

    fn handle(&self, connection: u64, message: ClientMessage) -> io::Result<()> {
        let mut state = self.state();
        let paired = state
            .connections
            .get(&connection)
            .is_some_and(|c| c.info.pairing_code.is_none());
        if !paired {
            return Err(protocol_error("a message before the pairing"));
        }
        let notice = match message {
            ClientMessage::Request {
                id,
                origin,
                method,
                params,
                chain_id,
            } => {
                if id.len() > MAX_ID_LEN
                    || method.len() > MAX_METHOD_LEN
                    || origin.len() > MAX_ORIGIN_LEN
                {
                    return Err(protocol_error("a request field is too long"));
                }
                if chain_id.is_some_and(|chain_id| chain_id == 0 || chain_id > MAX_CHAIN_ID) {
                    return Err(protocol_error("the chain ID is not valid"));
                }
                if state
                    .requests
                    .iter()
                    .any(|r| r.connection == connection && r.id == id)
                {
                    return Err(protocol_error("a request ID was used twice"));
                }
                state.requests.push(SigningRequest {
                    connection,
                    id,
                    origin,
                    method,
                    params,
                    chain_id,
                    received_at: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map_or(0, |elapsed| elapsed.as_millis() as u64),
                    outcome: None,
                });
                let excess = state.requests.len().saturating_sub(MAX_REQUESTS);
                state.requests.drain(..excess);
                Notice::NewRequest
            }
            ClientMessage::Settled { id, outcome } => {
                // The request can be gone already: dismissed, or pushed out.
                if let Some(request) = state
                    .requests
                    .iter_mut()
                    .find(|r| r.connection == connection && r.id == id)
                {
                    request.outcome = Some(outcome);
                }
                Notice::Changed
            }
        };
        drop(state);
        (self.notify)(notice);
        Ok(())
    }
}

/// The relay ships next to the app binary: in `target/` during development,
/// inside the package after installation.
pub fn relay_path() -> io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe
        .parent()
        .ok_or_else(|| io::Error::other("executable has no parent directory"))?;
    Ok(dir.join("onay-relay"))
}

pub fn bind(path: &Path) -> io::Result<UnixListener> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channel::Identity;
    use serde_json::json;
    use std::sync::mpsc::{self, Receiver};

    const WAIT: Duration = Duration::from_secs(5);

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("onay-link-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn link(name: &str, verdict: fn() -> Verdict) -> (Arc<Link>, Receiver<()>) {
        let store = Store::open(&temp_dir(name)).unwrap();
        let (tx, rx) = mpsc::channel();
        let notify = move |_| {
            let _ = tx.send(());
        };
        let link = Link::new(
            Setup::default(),
            store,
            Box::new(move |_| verdict()),
            Box::new(notify),
        );
        (link, rx)
    }

    fn verified() -> Verdict {
        Verdict::Verified {
            browser: "/opt/google/chrome/chrome".into(),
        }
    }

    /// A stand-in for the extension.
    struct Client {
        stream: UnixStream,
        sealer: Sealer,
        opener: Opener,
        paired: bool,
        code: String,
    }

    impl Client {
        /// Connects to `link` and does the hello exchange.
        fn connect(link: &Arc<Link>, identity: &Identity) -> Self {
            let (stream, server) = UnixStream::pair().unwrap();
            let link = Arc::clone(link);
            thread::spawn(move || link.serve(server));
            stream.set_read_timeout(Some(WAIT)).unwrap();

            let hello = Hello {
                public_key: identity.public_key(),
                salt: channel::random().unwrap(),
            };
            let frame = json!({
                "type": "hello",
                "version": 1,
                "publicKey": BASE64.encode(hello.public_key),
                "salt": BASE64.encode(hello.salt),
            });
            onay_ipc::write_message(&mut &stream, frame.to_string().as_bytes()).unwrap();

            let reply = read_json(&stream).unwrap();
            assert_eq!(reply["type"], "hello");
            let app = Hello {
                public_key: decode_key(reply["publicKey"].as_str().unwrap()).unwrap(),
                salt: decode_key(reply["salt"].as_str().unwrap()).unwrap(),
            };
            let (sealer, opener) =
                channel::session(identity, Role::Extension, &hello, &app).unwrap();
            Self {
                stream,
                sealer,
                opener,
                paired: reply["paired"].as_bool().unwrap(),
                code: channel::pairing_code(&hello.public_key, &app.public_key),
            }
        }

        fn send(&mut self, message: Value) {
            let sealed = self.sealer.seal(message.to_string().as_bytes()).unwrap();
            let frame = json!({ "type": "sealed", "data": BASE64.encode(sealed) });
            onay_ipc::write_message(&mut &self.stream, frame.to_string().as_bytes()).unwrap();
        }

        /// The next sealed message, or `None` at the end of the stream.
        fn receive(&mut self) -> Option<Value> {
            let frame = read_json(&self.stream)?;
            assert_eq!(frame["type"], "sealed");
            let sealed = BASE64.decode(frame["data"].as_str().unwrap()).unwrap();
            Some(serde_json::from_slice(&self.opener.open(&sealed).unwrap()).unwrap())
        }
    }

    fn read_json(mut stream: &UnixStream) -> Option<Value> {
        let bytes = onay_ipc::read_message(&mut stream).unwrap()?;
        Some(serde_json::from_slice(&bytes).unwrap())
    }

    /// Waits until the link reports a change and `done` is true.
    fn wait_for(link: &Link, changes: &Receiver<()>, done: impl Fn(&Snapshot) -> bool) -> Snapshot {
        loop {
            let snapshot = link.snapshot();
            if done(&snapshot) {
                return snapshot;
            }
            changes
                .recv_timeout(WAIT)
                .expect("the link did not reach the expected state");
        }
    }

    fn request(id: &str) -> Value {
        json!({
            "type": "request",
            "id": id,
            "origin": "https://example.org",
            "method": "personal_sign",
            "params": ["0x68656c6c6f", "0x0000000000000000000000000000000000000001"],
        })
    }

    #[test]
    fn pairing_then_requests_then_reconnect() {
        let (link, changes) = link("flow", verified);
        let identity = Identity::generate().unwrap();

        let mut client = Client::connect(&link, &identity);
        assert!(!client.paired);
        let snapshot = wait_for(&link, &changes, |s| s.connections.len() == 1);
        let connection = snapshot.connections[0].clone();
        assert!(connection.verified);
        assert_eq!(
            connection.browser.as_deref(),
            Some("/opt/google/chrome/chrome")
        );
        assert_eq!(
            connection.pairing_code.as_deref(),
            Some(client.code.as_str())
        );

        link.answer_pairing(connection.id, true).unwrap();
        assert_eq!(client.receive().unwrap(), json!({ "type": "paired" }));
        assert!(link.answer_pairing(connection.id, true).is_err());

        client.send(request("a"));
        let snapshot = wait_for(&link, &changes, |s| s.requests.len() == 1);
        assert_eq!(snapshot.requests[0].origin, "https://example.org");
        assert_eq!(snapshot.requests[0].method, "personal_sign");
        assert_eq!(snapshot.requests[0].outcome, None);

        client.send(json!({ "type": "settled", "id": "a", "outcome": "fulfilled" }));
        wait_for(&link, &changes, |s| {
            s.requests[0].outcome == Some(Outcome::Fulfilled)
        });

        link.dismiss_request(connection.id, "a");
        assert!(link.snapshot().requests.is_empty());

        drop(client);
        wait_for(&link, &changes, |s| s.connections.is_empty());

        // The same extension is known at the next connection.
        let client = Client::connect(&link, &identity);
        assert!(client.paired);
        let snapshot = wait_for(&link, &changes, |s| s.connections.len() == 1);
        assert_eq!(snapshot.connections[0].pairing_code, None);
    }

    #[test]
    fn transaction_keeps_its_chain_id_and_a_bad_one_closes_the_connection() {
        let (link, changes) = link("chain", verified);
        let identity = Identity::generate().unwrap();
        let mut client = Client::connect(&link, &identity);
        let snapshot = wait_for(&link, &changes, |s| s.connections.len() == 1);
        link.answer_pairing(snapshot.connections[0].id, true)
            .unwrap();
        client.receive().unwrap();

        let transaction = |id: &str, chain_id: Value| {
            json!({
                "type": "request",
                "id": id,
                "origin": "https://example.org",
                "method": "eth_sendTransaction",
                "params": [{ "to": "0x0000000000000000000000000000000000000001" }],
                "chainId": chain_id,
            })
        };
        client.send(transaction("a", json!(137)));
        client.send(transaction("b", Value::Null));
        client.send(request("c"));
        let snapshot = wait_for(&link, &changes, |s| s.requests.len() == 3);
        let chain_ids: Vec<_> = snapshot.requests.iter().map(|r| r.chain_id).collect();
        assert_eq!(chain_ids, [Some(137), None, None]);

        client.send(transaction("d", json!(0)));
        assert_eq!(client.receive(), None);
        let snapshot = wait_for(&link, &changes, |s| s.connections.is_empty());
        assert_eq!(snapshot.requests.len(), 3);
    }

    #[test]
    fn chain_id_beyond_the_javascript_limit_closes_the_connection() {
        let (link, changes) = link("chain-limit", verified);
        let identity = Identity::generate().unwrap();
        let mut client = Client::connect(&link, &identity);
        let snapshot = wait_for(&link, &changes, |s| s.connections.len() == 1);
        link.answer_pairing(snapshot.connections[0].id, true)
            .unwrap();
        client.receive().unwrap();

        let mut message = request("a");
        message["chainId"] = json!(MAX_CHAIN_ID + 1);
        client.send(message);
        assert_eq!(client.receive(), None);
        let snapshot = wait_for(&link, &changes, |s| s.connections.is_empty());
        assert!(snapshot.requests.is_empty());
    }

    #[test]
    fn rejected_pairing_closes_the_connection() {
        let (link, changes) = link("reject", verified);
        let identity = Identity::generate().unwrap();
        let mut client = Client::connect(&link, &identity);
        let snapshot = wait_for(&link, &changes, |s| s.connections.len() == 1);

        link.answer_pairing(snapshot.connections[0].id, false)
            .unwrap();
        assert_eq!(
            client.receive().unwrap(),
            json!({ "type": "pairing-rejected" })
        );
        assert_eq!(client.receive(), None);
        wait_for(&link, &changes, |s| s.connections.is_empty());

        // The rejection is not stored: the next connection asks again.
        assert!(!Client::connect(&link, &identity).paired);
    }

    #[test]
    fn request_before_pairing_closes_the_connection() {
        let (link, changes) = link("early", verified);
        let mut client = Client::connect(&link, &Identity::generate().unwrap());
        wait_for(&link, &changes, |s| s.connections.len() == 1);

        client.send(request("a"));
        assert_eq!(client.receive(), None);
        let snapshot = wait_for(&link, &changes, |s| s.connections.is_empty());
        assert!(snapshot.requests.is_empty());
    }

    #[test]
    fn message_that_does_not_open_closes_the_connection() {
        let (link, changes) = link("garbage", verified);
        let identity = Identity::generate().unwrap();
        let mut client = Client::connect(&link, &identity);
        let snapshot = wait_for(&link, &changes, |s| s.connections.len() == 1);
        link.answer_pairing(snapshot.connections[0].id, true)
            .unwrap();
        client.receive().unwrap();

        let frame = json!({ "type": "sealed", "data": BASE64.encode([0u8; 40]) });
        onay_ipc::write_message(&mut &client.stream, frame.to_string().as_bytes()).unwrap();
        assert_eq!(client.receive(), None);
        wait_for(&link, &changes, |s| s.connections.is_empty());
    }

    #[test]
    fn peer_that_fails_the_check_gets_one_error() {
        let (link, changes) = link("peer", || Verdict::Rejected("not a browser".into()));
        let (stream, server) = UnixStream::pair().unwrap();
        let serving = Arc::clone(&link);
        thread::spawn(move || serving.serve(server));
        stream.set_read_timeout(Some(WAIT)).unwrap();

        let reply = read_json(&stream).unwrap();
        assert_eq!(reply["type"], "error");
        assert!(reply["message"].as_str().unwrap().contains("not a browser"));
        assert_eq!(read_json(&stream), None);
        let snapshot = wait_for(&link, &changes, |s| !s.rejected.is_empty());
        assert_eq!(snapshot.rejected, ["not a browser"]);
        assert!(snapshot.connections.is_empty());
    }

    #[test]
    fn system_without_a_peer_check_is_shown_as_not_verified() {
        let (link, changes) = link("unsupported", || Verdict::Unsupported);
        let _client = Client::connect(&link, &Identity::generate().unwrap());
        let snapshot = wait_for(&link, &changes, |s| s.connections.len() == 1);
        assert!(!snapshot.connections[0].verified);
        assert_eq!(snapshot.connections[0].browser, None);
    }

    #[test]
    fn stale_socket_file_is_replaced_but_a_live_one_is_not() {
        let path = temp_dir("stale").join("onay.sock");
        let first = bind(&path).unwrap();
        assert!(bind(&path).is_err());
        drop(first);
        // The file stays behind after the listener is gone.
        assert!(path.exists());
        assert!(bind(&path).is_ok());
    }
}
