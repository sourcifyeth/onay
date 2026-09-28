//! Shared between the relay and the app: where the socket lives, how
//! messages are framed, and which extension may connect.

use std::io::{self, Read, Write};
use std::path::PathBuf;

/// Name of the native messaging host. Browsers look up `<HOST_NAME>.json`.
pub const HOST_NAME: &str = "dev.sourcify.onay";

/// ID of our extension. Derived from the `key` in extension/manifest.json.
pub const EXTENSION_ID: &str = "jhopbgoicoiceialjejgojebmeijklbn";

/// Largest message in either direction. Chrome rejects host messages above 1 MiB.
pub const MAX_MESSAGE_LEN: usize = 1024 * 1024;

/// Per-user directory for the socket: `XDG_RUNTIME_DIR` on Linux, the
/// per-user temp dir elsewhere. Both are private to the user.
pub fn socket_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("onay")
}

pub fn socket_path() -> PathBuf {
    socket_dir().join("onay.sock")
}

/// Reads one native messaging frame: a 4-byte native-endian length, then
/// that many bytes of JSON. Returns `None` on a clean end of stream.
pub fn read_message(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    let first = loop {
        match reader.read(&mut len) {
            Ok(n) => break n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    };
    if first == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut len[first..])?;
    let len = u32::from_ne_bytes(len) as usize;
    if len > MAX_MESSAGE_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("message of {len} bytes exceeds the {MAX_MESSAGE_LEN} byte limit"),
        ));
    }
    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

/// Writes one native messaging frame and flushes it.
pub fn write_message(writer: &mut impl Write, payload: &[u8]) -> io::Result<()> {
    let Ok(len) = u32::try_from(payload.len()) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "message too long",
        ));
    };
    if payload.len() > MAX_MESSAGE_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("message of {len} bytes exceeds the {MAX_MESSAGE_LEN} byte limit"),
        ));
    }
    writer.write_all(&len.to_ne_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn round_trip() {
        let mut buf = Vec::new();
        write_message(&mut buf, br#"{"type":"ping","id":1}"#).unwrap();
        write_message(&mut buf, b"").unwrap();
        let mut reader = Cursor::new(buf);
        assert_eq!(
            read_message(&mut reader).unwrap().as_deref(),
            Some(&br#"{"type":"ping","id":1}"#[..])
        );
        assert_eq!(
            read_message(&mut reader).unwrap().as_deref(),
            Some(&b""[..])
        );
        assert!(read_message(&mut reader).unwrap().is_none());
    }

    #[test]
    fn truncated_stream_is_an_error() {
        let mut buf = Vec::new();
        write_message(&mut buf, b"hello").unwrap();
        buf.truncate(6);
        assert!(read_message(&mut Cursor::new(&buf[..2])).is_err());
        assert!(read_message(&mut Cursor::new(buf)).is_err());
    }

    #[test]
    fn oversized_messages_are_rejected() {
        let big = vec![0u8; MAX_MESSAGE_LEN + 1];
        assert!(write_message(&mut Vec::new(), &big).is_err());
        let mut buf = ((MAX_MESSAGE_LEN + 1) as u32).to_ne_bytes().to_vec();
        buf.extend_from_slice(&big);
        assert!(read_message(&mut Cursor::new(buf)).is_err());
    }

    #[test]
    fn socket_path_is_under_the_runtime_dir() {
        let path = socket_path();
        assert_eq!(path.file_name().unwrap(), "onay.sock");
        assert_eq!(path.parent().unwrap().file_name().unwrap(), "onay");
    }
}
