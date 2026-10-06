//! The encrypted channel between the extension and the app, version 1.
//!
//! Each side has a long-term X25519 key. For each connection, each side
//! sends its public key and a random salt in the clear. Both then derive
//! two AES-256-GCM keys, one for each direction:
//!
//! ```text
//! shared = X25519(my secret, their public)
//! key    = HKDF-SHA-256(salt = ext salt || app salt, ikm = shared,
//!                       info = label || ext public || app public)
//! ```
//!
//! Only the owners of the two secrets can derive the keys, so a sealed
//! message proves who sent it. The salts make the keys new for each
//! connection, so a recorded message is useless in a later one. The nonce
//! is a counter that is never sent: a lost, repeated, or reordered message
//! fails to open.
//!
//! `extension/src/channel.ts` is the other implementation. The file
//! `testdata/channel-v1.json` holds test vectors that both must match.

use std::fmt;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub const VERSION: u32 = 1;
pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 32;

const LABEL_EXT_TO_APP: &[u8] = b"onay v1 ext->app";
const LABEL_APP_TO_EXT: &[u8] = b"onay v1 app->ext";
const LABEL_PAIRING: &[u8] = b"onay v1 pairing";

#[derive(Debug, PartialEq)]
pub enum Error {
    /// The other public key gives a shared secret that anyone can compute.
    WeakPublicKey,
    /// The message is not from the other side, or it is out of order.
    Open,
    Seal,
    /// The counter reached its end. Does not occur in practice.
    Exhausted,
    Random,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Error::WeakPublicKey => "the public key is not acceptable",
            Error::Open => "the message cannot be opened",
            Error::Seal => "the message cannot be sealed",
            Error::Exhausted => "the message counter is exhausted",
            Error::Random => "the system gave no random bytes",
        })
    }
}

impl std::error::Error for Error {}

/// Which end of the channel this is.
#[derive(Clone, Copy)]
pub enum Role {
    /// The app never takes this role. The tests do.
    #[cfg_attr(not(test), allow(dead_code))]
    Extension,
    App,
}

/// A long-term X25519 key.
pub struct Identity(StaticSecret);

impl Identity {
    pub fn generate() -> Result<Self, Error> {
        Ok(Self::from_bytes(random()?))
    }

    pub fn from_bytes(secret: [u8; KEY_LEN]) -> Self {
        Self(StaticSecret::from(secret))
    }

    pub fn secret_bytes(&self) -> [u8; KEY_LEN] {
        self.0.to_bytes()
    }

    pub fn public_key(&self) -> [u8; KEY_LEN] {
        PublicKey::from(&self.0).to_bytes()
    }
}

pub fn random<const N: usize>() -> Result<[u8; N], Error> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| Error::Random)?;
    Ok(bytes)
}

/// The public half of one side's hello message.
pub struct Hello {
    pub public_key: [u8; KEY_LEN],
    pub salt: [u8; SALT_LEN],
}

/// Derives the two directions of a session.
pub fn session(
    identity: &Identity,
    role: Role,
    extension: &Hello,
    app: &Hello,
) -> Result<(Sealer, Opener), Error> {
    let their_public = match role {
        Role::Extension => app.public_key,
        Role::App => extension.public_key,
    };
    let shared = identity.0.diffie_hellman(&PublicKey::from(their_public));
    if !shared.was_contributory() {
        return Err(Error::WeakPublicKey);
    }
    let mut salt = [0u8; 2 * SALT_LEN];
    salt[..SALT_LEN].copy_from_slice(&extension.salt);
    salt[SALT_LEN..].copy_from_slice(&app.salt);
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes());

    let key = |label: &[u8]| {
        let info = [label, &extension.public_key, &app.public_key].concat();
        let mut key = [0u8; KEY_LEN];
        hkdf.expand(&info, &mut key)
            .expect("32 bytes is a valid HKDF output length");
        Aes256Gcm::new_from_slice(&key).expect("32 bytes is a valid AES-256 key")
    };
    let ext_to_app = key(LABEL_EXT_TO_APP);
    let app_to_ext = key(LABEL_APP_TO_EXT);
    Ok(match role {
        Role::Extension => (Sealer::new(ext_to_app), Opener::new(app_to_ext)),
        Role::App => (Sealer::new(app_to_ext), Opener::new(ext_to_app)),
    })
}

/// The code that both sides show during pairing. Equal codes mean that
/// both sides see the same two public keys.
pub fn pairing_code(extension_key: &[u8; KEY_LEN], app_key: &[u8; KEY_LEN]) -> String {
    let digest = Sha256::new()
        .chain_update(LABEL_PAIRING)
        .chain_update(extension_key)
        .chain_update(app_key)
        .finalize();
    let number = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{:03} {:03}", number / 1000, number % 1000)
}

fn nonce(counter: u64) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[4..].copy_from_slice(&counter.to_be_bytes());
    nonce
}

/// Encrypts the messages of one direction.
pub struct Sealer {
    cipher: Aes256Gcm,
    counter: u64,
}

impl Sealer {
    fn new(cipher: Aes256Gcm) -> Self {
        Self { cipher, counter: 0 }
    }

    pub fn seal(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, Error> {
        let next = self.counter.checked_add(1).ok_or(Error::Exhausted)?;
        let sealed = self
            .cipher
            .encrypt(&Nonce::from(nonce(self.counter)), plaintext)
            .map_err(|_| Error::Seal)?;
        self.counter = next;
        Ok(sealed)
    }
}

/// Decrypts the messages of one direction, in the order they were sealed.
pub struct Opener {
    cipher: Aes256Gcm,
    counter: u64,
}

impl Opener {
    fn new(cipher: Aes256Gcm) -> Self {
        Self { cipher, counter: 0 }
    }

    pub fn open(&mut self, sealed: &[u8]) -> Result<Vec<u8>, Error> {
        let next = self.counter.checked_add(1).ok_or(Error::Exhausted)?;
        let plaintext = self
            .cipher
            .decrypt(&Nonce::from(nonce(self.counter)), sealed)
            .map_err(|_| Error::Open)?;
        self.counter = next;
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;

    fn pair() -> ((Sealer, Opener), (Sealer, Opener)) {
        let extension = Identity::generate().unwrap();
        let app = Identity::generate().unwrap();
        let ext_hello = Hello {
            public_key: extension.public_key(),
            salt: random().unwrap(),
        };
        let app_hello = Hello {
            public_key: app.public_key(),
            salt: random().unwrap(),
        };
        (
            session(&extension, Role::Extension, &ext_hello, &app_hello).unwrap(),
            session(&app, Role::App, &ext_hello, &app_hello).unwrap(),
        )
    }

    #[test]
    fn both_directions_round_trip() {
        let ((mut ext_seal, mut ext_open), (mut app_seal, mut app_open)) = pair();
        for message in [&b"first"[..], b"", b"third"] {
            let sealed = ext_seal.seal(message).unwrap();
            assert_eq!(app_open.open(&sealed).unwrap(), message);
            let sealed = app_seal.seal(message).unwrap();
            assert_eq!(ext_open.open(&sealed).unwrap(), message);
        }
    }

    #[test]
    fn repeated_reordered_and_changed_messages_fail() {
        let ((mut ext_seal, _), (_, mut app_open)) = pair();
        let first = ext_seal.seal(b"first").unwrap();
        let second = ext_seal.seal(b"second").unwrap();

        // Out of order.
        assert_eq!(app_open.open(&second), Err(Error::Open));
        assert_eq!(app_open.open(&first).unwrap(), b"first");
        // Repeated.
        assert_eq!(app_open.open(&first), Err(Error::Open));
        // Changed.
        let mut changed = second.clone();
        changed[0] ^= 1;
        assert_eq!(app_open.open(&changed), Err(Error::Open));
        // A failure does not move the counter.
        assert_eq!(app_open.open(&second).unwrap(), b"second");
    }

    #[test]
    fn a_message_does_not_open_in_its_own_direction() {
        let ((mut ext_seal, mut ext_open), _) = pair();
        let sealed = ext_seal.seal(b"hello").unwrap();
        assert_eq!(ext_open.open(&sealed), Err(Error::Open));
    }

    #[test]
    fn another_identity_cannot_open() {
        let ((mut ext_seal, _), _) = pair();
        let (_, (_, mut other_open)) = pair();
        let sealed = ext_seal.seal(b"hello").unwrap();
        assert_eq!(other_open.open(&sealed), Err(Error::Open));
    }

    #[test]
    fn new_salts_give_new_keys() {
        let extension = Identity::generate().unwrap();
        let app = Identity::generate().unwrap();
        let hello = |identity: &Identity, salt| Hello {
            public_key: identity.public_key(),
            salt: [salt; SALT_LEN],
        };
        let (mut seal, _) = session(
            &extension,
            Role::Extension,
            &hello(&extension, 1),
            &hello(&app, 2),
        )
        .unwrap();
        let (_, mut open) =
            session(&app, Role::App, &hello(&extension, 1), &hello(&app, 3)).unwrap();
        assert_eq!(open.open(&seal.seal(b"hello").unwrap()), Err(Error::Open));
    }

    #[test]
    fn weak_public_key_is_rejected() {
        let app = Identity::generate().unwrap();
        let weak = Hello {
            public_key: [0; KEY_LEN],
            salt: [0; SALT_LEN],
        };
        let mine = Hello {
            public_key: app.public_key(),
            salt: [0; SALT_LEN],
        };
        assert!(matches!(
            session(&app, Role::App, &weak, &mine),
            Err(Error::WeakPublicKey)
        ));
    }

    #[test]
    fn pairing_code_has_six_digits_and_depends_on_both_keys() {
        let code = pairing_code(&[1; KEY_LEN], &[2; KEY_LEN]);
        assert_eq!(code.len(), 7);
        assert!(code.chars().all(|c| c.is_ascii_digit() || c == ' '));
        assert_eq!(code, pairing_code(&[1; KEY_LEN], &[2; KEY_LEN]));
        assert_ne!(code, pairing_code(&[2; KEY_LEN], &[1; KEY_LEN]));
    }

    /// The same vectors are checked by extension/test/channel.test.ts.
    #[test]
    fn matches_the_shared_test_vectors() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/channel-v1.json"
        );
        let vectors: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let bytes = |name: &str| -> [u8; 32] {
            BASE64
                .decode(vectors[name].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap()
        };

        let extension = Identity::from_bytes(bytes("extensionSecret"));
        let app = Identity::from_bytes(bytes("appSecret"));
        assert_eq!(extension.public_key(), bytes("extensionPublic"));
        assert_eq!(app.public_key(), bytes("appPublic"));
        assert_eq!(
            pairing_code(&extension.public_key(), &app.public_key()),
            vectors["pairingCode"].as_str().unwrap()
        );

        let ext_hello = Hello {
            public_key: extension.public_key(),
            salt: bytes("extensionSalt"),
        };
        let app_hello = Hello {
            public_key: app.public_key(),
            salt: bytes("appSalt"),
        };
        let (mut ext_seal, mut ext_open) =
            session(&extension, Role::Extension, &ext_hello, &app_hello).unwrap();
        let (mut app_seal, mut app_open) =
            session(&app, Role::App, &ext_hello, &app_hello).unwrap();

        for message in vectors["messages"].as_array().unwrap() {
            let plaintext = message["plaintext"].as_str().unwrap().as_bytes();
            let sealed = BASE64.decode(message["sealed"].as_str().unwrap()).unwrap();
            let (seal, open) = match message["from"].as_str().unwrap() {
                "extension" => (&mut ext_seal, &mut app_open),
                "app" => (&mut app_seal, &mut ext_open),
                other => panic!("unknown sender {other}"),
            };
            assert_eq!(seal.seal(plaintext).unwrap(), sealed);
            assert_eq!(open.open(&sealed).unwrap(), plaintext);
        }
    }
}
