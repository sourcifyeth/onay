//! Native messaging relay. The browser starts this binary for each
//! connection and talks to it over stdin and stdout. It connects to the
//! running app's socket and copies bytes in both directions, without
//! looking at them. When the app is not running it answers with one error
//! message and exits.

use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::process::ExitCode;
use std::thread;

const APP_NOT_RUNNING: &[u8] = br#"{"type":"error","message":"app not running"}"#;

fn main() -> ExitCode {
    let path = onay_ipc::socket_path();
    let app = match UnixStream::connect(&path) {
        Ok(stream) => stream,
        Err(err) => {
            // The browser logs stderr; the extension gets the message on stdout.
            eprintln!("onay-relay: cannot connect to {}: {err}", path.display());
            let _ = onay_ipc::write_message(&mut io::stdout(), APP_NOT_RUNNING);
            return ExitCode::FAILURE;
        }
    };
    match relay(app) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("onay-relay: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Copies stdin to the app and the app to stdout until either side closes.
fn relay(app: UnixStream) -> io::Result<()> {
    let mut to_app = app.try_clone()?;
    let mut from_app = app;
    // Browser to app. When the browser closes stdin, closing our write
    // side tells the app.
    thread::spawn(move || {
        let _ = pump(&mut io::stdin().lock(), &mut to_app);
        let _ = to_app.shutdown(Shutdown::Write);
    });
    // App to browser, on this thread. When the app closes, the process
    // exits, which also ends the thread above.
    pump(&mut from_app, &mut io::stdout().lock())
}

/// Forwards every chunk as soon as it arrives. Stdout is line buffered, so
/// each chunk is flushed by hand.
fn pump(reader: &mut impl Read, writer: &mut impl Write) -> io::Result<()> {
    let mut buf = [0u8; 8192];
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => return Ok(()),
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        writer.write_all(&buf[..n])?;
        writer.flush()?;
    }
}
