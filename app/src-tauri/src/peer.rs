//! Checks who is on the other end of the socket before the app talks to
//! it. The model is the one 1Password documents for its browser link.
//!
//! On Linux:
//! 1. The kernel gives the process and the user of the peer.
//! 2. The peer must be our relay, run by the same user.
//! 3. The parent of the relay is the browser. It must be an approved
//!    browser, and it must look installed by a package manager: the binary
//!    and all its parent directories belong to root, and only root can
//!    write to them.
//!
//! Linux has no code signatures, so step 3 is the strongest check there
//! is. On macOS the check is the code signature of the browser. That is
//! not implemented yet, and the verdict there is `Unsupported`.
//!
//! This check does not stop a program that controls a real browser.

use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

pub enum Verdict {
    /// The peer is our relay, started by this browser.
    Verified {
        browser: PathBuf,
    },
    /// This system has no check yet.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    Unsupported,
    Rejected(String),
}

#[cfg(not(target_os = "linux"))]
pub fn verify(_stream: &UnixStream, _relay: &Path) -> Verdict {
    Verdict::Unsupported
}

#[cfg(target_os = "linux")]
pub fn verify(stream: &UnixStream, relay: &Path) -> Verdict {
    match linux::verify(stream, relay) {
        Ok(browser) => Verdict::Verified { browser },
        Err(reason) => Verdict::Rejected(reason),
    }
}

/// Browser binaries that may start the relay. The file
/// `/etc/onay/custom_allowed_browsers` adds more.
const APPROVED_BROWSERS: &[&str] = &["chrome", "chromium", "chromium-browser"];

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const CUSTOM_BROWSERS_FILE: &str = "/etc/onay/custom_allowed_browsers";

/// Owner and permission bits of a file.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
struct Owner {
    uid: u32,
    mode: u32,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
impl Owner {
    /// True if the file belongs to root and only root can write to it.
    fn is_root_only(&self) -> bool {
        self.uid == 0 && self.mode & 0o022 == 0
    }
}

/// Reads the parent process ID from the content of `/proc/<pid>/stat`.
/// The process name is in parentheses and can contain any character, so
/// the fields start after the last `)`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_parent_pid(stat: &str) -> Option<i32> {
    let fields = &stat[stat.rfind(')')? + 1..];
    // The fields after the name are: state, parent process ID, ...
    fields.split_ascii_whitespace().nth(1)?.parse().ok()
}

/// One binary name for each line. Lines that start with `#` are comments.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_custom_browsers(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .collect()
}

/// Decides if `browser` is an approved browser from a package manager.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn check_browser(
    browser: &Path,
    custom: &[String],
    owner: &impl Fn(&Path) -> std::io::Result<Owner>,
) -> Result<(), String> {
    let name = browser
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has no file name", browser.display()))?;
    if !APPROVED_BROWSERS.contains(&name) && !custom.iter().any(|allowed| allowed == name) {
        return Err(format!("{} is not an approved browser", browser.display()));
    }
    // The binary and each directory above it, up to the root.
    for path in browser.ancestors() {
        let owner =
            owner(path).map_err(|err| format!("cannot inspect {}: {err}", path.display()))?;
        if !owner.is_root_only() {
            return Err(format!(
                "{} is not installed by a package manager: {} can be changed without root",
                browser.display(),
                path.display()
            ));
        }
    }
    Ok(())
}

/// What the app knows about the peer process and about the relay binary.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
struct RelayFacts<'a> {
    peer_gid: u32,
    /// The binary of the peer process. Unknown for a setgid process.
    peer_binary: Option<&'a Path>,
    relay: &'a Path,
    relay_gid: u32,
    relay_is_setgid: bool,
}

/// Decides if the peer process is our relay.
///
/// A packaged relay is setgid to its own group. Only that binary can run
/// with the group, and the user cannot trace it or preload code into it.
/// A development relay has no such group, so the binary path decides.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn check_relay(facts: &RelayFacts) -> Result<(), String> {
    if facts.relay_is_setgid {
        if facts.peer_gid == facts.relay_gid {
            return Ok(());
        }
        return Err("the peer does not run with the group of the relay".into());
    }
    match facts.peer_binary {
        Some(binary) if binary == facts.relay => Ok(()),
        Some(binary) => Err(format!("the peer is {}, not the relay", binary.display())),
        None => Err("the binary of the peer is unknown".into()),
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::fs;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::MetadataExt;

    const SETGID: u32 = 0o2000;

    pub fn verify(stream: &UnixStream, relay: &Path) -> Result<PathBuf, String> {
        let peer = credentials(stream).map_err(|err| format!("no peer credentials: {err}"))?;

        let own_uid = fs::metadata("/proc/self")
            .map_err(|err| format!("cannot read the own user: {err}"))?
            .uid();
        if peer.uid != own_uid {
            return Err("the peer runs as a different user".into());
        }

        let relay =
            fs::canonicalize(relay).map_err(|err| format!("cannot find the relay: {err}"))?;
        let relay_meta =
            fs::metadata(&relay).map_err(|err| format!("cannot inspect the relay: {err}"))?;
        let peer_binary = fs::read_link(format!("/proc/{}/exe", peer.pid)).ok();
        check_relay(&RelayFacts {
            peer_gid: peer.gid,
            peer_binary: peer_binary.as_deref(),
            relay: &relay,
            relay_gid: relay_meta.gid(),
            relay_is_setgid: relay_meta.mode() & SETGID != 0,
        })?;

        let stat = fs::read_to_string(format!("/proc/{}/stat", peer.pid))
            .map_err(|err| format!("cannot read the relay process: {err}"))?;
        let parent = parse_parent_pid(&stat).ok_or("cannot find the parent of the relay")?;
        let browser = fs::read_link(format!("/proc/{parent}/exe"))
            .map_err(|err| format!("cannot read the parent of the relay: {err}"))?;

        check_browser(&browser, &custom_browsers(), &|path| {
            fs::metadata(path).map(|meta| Owner {
                uid: meta.uid(),
                mode: meta.mode(),
            })
        })?;
        Ok(browser)
    }

    /// The extra browsers. The file counts only if it belongs to root and
    /// only root can write to it.
    fn custom_browsers() -> Vec<String> {
        let trusted = fs::metadata(CUSTOM_BROWSERS_FILE).is_ok_and(|meta| {
            Owner {
                uid: meta.uid(),
                mode: meta.mode(),
            }
            .is_root_only()
        });
        if !trusted {
            return Vec::new();
        }
        fs::read_to_string(CUSTOM_BROWSERS_FILE)
            .map(|text| parse_custom_browsers(&text))
            .unwrap_or_default()
    }

    /// Asks the kernel who connected (`SO_PEERCRED`). The peer cannot
    /// change the answer.
    fn credentials(stream: &UnixStream) -> std::io::Result<libc::ucred> {
        let mut cred = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut len = size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: `cred` and `len` are valid for the call, and `len` is the
        // size of `cred`. The kernel writes at most `len` bytes.
        let result = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&raw mut cred).cast(),
                &raw mut len,
            )
        };
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(cred)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_test_process_is_not_the_relay() {
            let (ours, _theirs) = UnixStream::pair().unwrap();
            let relay = std::env::current_exe()
                .unwrap()
                .with_file_name("no-such-relay");
            assert!(verify(&ours, &relay).is_err());

            // With the test binary as the "relay", the peer check passes
            // and the parent check decides. The parent is cargo or a
            // shell, never an approved browser.
            let relay = std::env::current_exe().unwrap();
            let reason = verify(&ours, &relay).unwrap_err();
            assert!(
                reason.contains("approved browser") || reason.contains("package manager"),
                "{reason}"
            );
        }

        #[test]
        fn credentials_name_this_process() {
            let (ours, _theirs) = UnixStream::pair().unwrap();
            let cred = credentials(&ours).unwrap();
            assert_eq!(cred.pid as u32, std::process::id());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    fn root() -> io::Result<Owner> {
        Ok(Owner {
            uid: 0,
            mode: 0o755,
        })
    }

    #[test]
    fn parent_pid_survives_odd_process_names() {
        assert_eq!(parse_parent_pid("42 (relay) S 7 42 42 0"), Some(7));
        assert_eq!(parse_parent_pid("42 (a b) c) R) S 1234 1 1"), Some(1234));
        assert_eq!(parse_parent_pid("42 (relay"), None);
        assert_eq!(parse_parent_pid("42 (relay) S"), None);
    }

    #[test]
    fn custom_browsers_skip_comments_and_blank_lines() {
        let text = "# extra browsers\n\nvivaldi-bin\n  opera  \n#chrome-dev\n";
        assert_eq!(parse_custom_browsers(text), ["vivaldi-bin", "opera"]);
    }

    #[test]
    fn approved_browser_in_a_root_location_passes() {
        let browser = Path::new("/opt/google/chrome/chrome");
        assert_eq!(check_browser(browser, &[], &|_| root()), Ok(()));
    }

    #[test]
    fn unknown_browser_needs_the_custom_list() {
        let browser = Path::new("/opt/vivaldi/vivaldi-bin");
        assert!(check_browser(browser, &[], &|_| root()).is_err());
        assert_eq!(
            check_browser(browser, &["vivaldi-bin".into()], &|_| root()),
            Ok(())
        );
    }

    #[test]
    fn browser_that_the_user_can_change_is_rejected() {
        // The binary itself belongs to the user.
        let home = Path::new("/home/user/chrome/chrome");
        let user_owned = |path: &Path| {
            if path.starts_with("/home/user") {
                Ok(Owner {
                    uid: 1000,
                    mode: 0o755,
                })
            } else {
                root()
            }
        };
        assert!(check_browser(home, &[], &user_owned).is_err());

        // One directory above the binary is writable by everyone.
        let browser = Path::new("/opt/google/chrome/chrome");
        let open_dir = |path: &Path| {
            Ok(Owner {
                uid: 0,
                mode: if path == Path::new("/opt/google") {
                    0o777
                } else {
                    0o755
                },
            })
        };
        assert!(check_browser(browser, &[], &open_dir).is_err());

        // A file that cannot be inspected counts as a failure.
        let missing = |_: &Path| Err(io::Error::from(io::ErrorKind::NotFound));
        assert!(check_browser(browser, &[], &missing).is_err());
    }

    #[test]
    fn relay_is_known_by_its_group_or_by_its_path() {
        let relay = Path::new("/usr/bin/onay-relay");
        let facts = |peer_gid, peer_binary, relay_is_setgid| RelayFacts {
            peer_gid,
            peer_binary,
            relay,
            relay_gid: 990,
            relay_is_setgid,
        };
        // Packaged: the group decides, the path is unknown.
        assert!(check_relay(&facts(990, None, true)).is_ok());
        assert!(check_relay(&facts(1000, Some(relay), true)).is_err());
        // Development: the path decides.
        assert!(check_relay(&facts(1000, Some(relay), false)).is_ok());
        assert!(check_relay(&facts(1000, Some(Path::new("/tmp/fake")), false)).is_err());
        assert!(check_relay(&facts(1000, None, false)).is_err());
    }
}
