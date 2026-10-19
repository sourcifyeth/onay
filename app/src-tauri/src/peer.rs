//! Checks who is on the other end of the socket before the app talks to
//! it. The model is the one 1Password documents for its browser link.
//!
//! 1. The kernel gives the process and the user of the peer.
//! 2. The peer must be our relay, run by the same user.
//! 3. The parent of the relay is the browser. It must be an approved
//!    browser.
//!
//! On Linux, an approved browser has an approved binary name, and it must
//! look installed by a package manager: the binary and all its parent
//! directories belong to root, and only root can write to them. Linux has
//! no code signatures, so this is the strongest check there is.
//!
//! On macOS, an approved browser has a valid code signature from an
//! approved vendor. The kernel tracks if the running process still matches
//! its signature.
//!
//! This check keeps out stray programs, but not a program of the same
//! user. Such a program can start the relay and then replace itself with a
//! real browser, which keeps its process ID. The pairing approval in the
//! window is the boundary against it.

use std::fs;
use std::io;
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

#[cfg(target_os = "linux")]
use linux::Os;
#[cfg(target_os = "macos")]
use macos::Os;

/// Browser binaries that may start the relay on Linux: Chrome, Chromium,
/// Brave, Edge, and Vivaldi. The file `/etc/onay/custom_allowed_browsers`
/// adds more.
const APPROVED_BROWSERS: &[&str] = &[
    "chrome",
    "chromium",
    "chromium-browser",
    "brave",
    "msedge",
    "vivaldi-bin",
];

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const CUSTOM_BROWSERS_FILE: &str = "/etc/onay/custom_allowed_browsers";

/// Linux adds this to the path of a binary that is gone from the disk. A
/// package update replaces the binary of a running browser.
const DELETED: &str = " (deleted)";

const SETGID: u32 = 0o2000;

/// The process, the user, and the group of the peer.
struct Peer {
    pid: libc::pid_t,
    uid: libc::uid_t,
    gid: libc::gid_t,
}

/// The relay binary: its real path, its group, and its permission bits.
struct RelayFile {
    path: PathBuf,
    gid: u32,
    mode: u32,
}

/// What the peer check asks the system. Each system has one
/// implementation, and the tests use a fake.
trait System {
    /// Asks the kernel who connected.
    fn peer(&self, stream: &UnixStream) -> io::Result<Peer>;

    fn own_uid(&self) -> libc::uid_t {
        // SAFETY: `geteuid` has no preconditions and cannot fail.
        unsafe { libc::geteuid() }
    }

    fn relay(&self, path: &Path) -> io::Result<RelayFile> {
        let path = fs::canonicalize(path)?;
        let meta = fs::metadata(&path)?;
        Ok(RelayFile {
            path,
            gid: meta.gid(),
            mode: meta.mode(),
        })
    }

    fn binary(&self, pid: libc::pid_t) -> io::Result<PathBuf>;

    fn parent(&self, pid: libc::pid_t) -> io::Result<libc::pid_t>;

    /// Names the approved browser that runs as `pid`, or tells why it is
    /// not one.
    fn browser(&self, pid: libc::pid_t) -> Result<String, String>;
}

/// The browser that started the relay on the other end of `stream`, or
/// why the app refuses the peer.
pub fn verify(stream: &UnixStream, relay: &Path) -> Result<String, String> {
    check_peer(&Os, stream, relay)
}

fn check_peer(system: &impl System, stream: &UnixStream, relay: &Path) -> Result<String, String> {
    let peer = system
        .peer(stream)
        .map_err(|err| format!("no peer credentials: {err}"))?;
    if peer.uid != system.own_uid() {
        return Err("the peer runs as a different user".into());
    }
    let relay = system
        .relay(relay)
        .map_err(|err| format!("cannot find the relay: {err}"))?;
    let peer_binary = system.binary(peer.pid).ok();
    check_relay(&RelayFacts {
        peer_gid: peer.gid,
        peer_binary: peer_binary.as_deref(),
        relay: &relay.path,
        relay_gid: relay.gid,
        relay_is_setgid: relay.mode & SETGID != 0,
    })?;
    let parent = system
        .parent(peer.pid)
        .map_err(|err| format!("cannot find the parent of the relay: {err}"))?;
    system.browser(parent)
}

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

/// The path of a binary as `/proc/<pid>/exe` shows it, without the mark of
/// a replaced binary. The checks then look at the installed binary.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn installed_path(exe: &Path) -> &Path {
    exe.to_str()
        .and_then(|exe| exe.strip_suffix(DELETED))
        .map_or(exe, Path::new)
}

/// Decides if `browser` is an approved browser from a package manager.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn check_browser(
    browser: &Path,
    custom: &[String],
    owner: &impl Fn(&Path) -> io::Result<Owner>,
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
struct RelayFacts<'a> {
    peer_gid: u32,
    /// The binary of the peer process. Linux hides it for a setgid process.
    peer_binary: Option<&'a Path>,
    relay: &'a Path,
    relay_gid: u32,
    relay_is_setgid: bool,
}

/// Decides if the peer process is our relay.
///
/// The Linux package makes the relay setgid to its own group. Only that
/// binary can run with the group, and the user cannot trace it or preload
/// code into it. A relay without such a group, as in development or on
/// macOS, is known by its binary path.
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
    use std::os::fd::AsRawFd;

    pub struct Os;

    impl System for Os {
        /// `SO_PEERCRED`: the kernel saves the process, the user, and the
        /// group at connect time. The peer cannot change them.
        fn peer(&self, stream: &UnixStream) -> io::Result<Peer> {
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
                return Err(io::Error::last_os_error());
            }
            Ok(Peer {
                pid: cred.pid,
                uid: cred.uid,
                gid: cred.gid,
            })
        }

        fn binary(&self, pid: libc::pid_t) -> io::Result<PathBuf> {
            fs::read_link(format!("/proc/{pid}/exe"))
        }

        fn parent(&self, pid: libc::pid_t) -> io::Result<libc::pid_t> {
            let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
            parse_parent_pid(&stat).ok_or_else(|| io::Error::other("no parent in the status"))
        }

        fn browser(&self, pid: libc::pid_t) -> Result<String, String> {
            let exe = self
                .binary(pid)
                .map_err(|err| format!("cannot read the parent of the relay: {err}"))?;
            let browser = installed_path(&exe);
            check_browser(browser, &custom_browsers(), &|path| {
                fs::metadata(path).map(|meta| Owner {
                    uid: meta.uid(),
                    mode: meta.mode(),
                })
            })?;
            Ok(browser.display().to_string())
        }
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
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::ffi::OsString;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStringExt;

    use security_framework::base::Error;
    use security_framework::os::macos::code_signing::{
        Flags, GuestAttributes, SecCode, SecRequirement,
    };

    // Status codes of the Security framework.
    const INVALID_FLAGS: i32 = -67070;
    const UNSIGNED: i32 = -67062;
    const REQUIREMENT_FAILED: i32 = -67050;
    const CHANGED_ON_DISK: i32 = -67034;

    /// An approved browser: the name of its app, its bundle identifier, and
    /// the Team ID of its vendor.
    struct Browser {
        app: &'static str,
        identifier: &'static str,
        team: &'static str,
    }

    /// Chromium builds have an ad hoc signature without a Team ID. Any
    /// program can make such a signature, so the app refuses them.
    const BROWSERS: &[Browser] = &[
        Browser {
            app: "Google Chrome",
            identifier: "com.google.Chrome",
            team: "EQHXZ8M8AV",
        },
        Browser {
            app: "Brave Browser",
            identifier: "com.brave.Browser",
            team: "KL8N8XSYF4",
        },
        Browser {
            app: "Microsoft Edge",
            identifier: "com.microsoft.edgemac",
            team: "UBF8T346G9",
        },
        Browser {
            app: "Vivaldi",
            identifier: "com.vivaldi.Vivaldi",
            team: "4XF3XNRN6Y",
        },
        Browser {
            app: "Arc",
            identifier: "company.thebrowser.Browser",
            team: "S6N382Y83G",
        },
        // The other channels of Chrome and Edge. On Linux they have the
        // binary names of the stable channel.
        Browser {
            app: "Google Chrome Beta",
            identifier: "com.google.Chrome.beta",
            team: "EQHXZ8M8AV",
        },
        Browser {
            app: "Google Chrome Dev",
            identifier: "com.google.Chrome.dev",
            team: "EQHXZ8M8AV",
        },
        Browser {
            app: "Google Chrome Canary",
            identifier: "com.google.Chrome.canary",
            team: "EQHXZ8M8AV",
        },
        Browser {
            app: "Microsoft Edge Beta",
            identifier: "com.microsoft.edgemac.Beta",
            team: "UBF8T346G9",
        },
        Browser {
            app: "Microsoft Edge Dev",
            identifier: "com.microsoft.edgemac.Dev",
            team: "UBF8T346G9",
        },
        Browser {
            app: "Microsoft Edge Canary",
            identifier: "com.microsoft.edgemac.Canary",
            team: "UBF8T346G9",
        },
    ];

    impl Browser {
        /// A Developer ID certificate from Apple for the team of the vendor,
        /// and the bundle identifier of the browser.
        fn requirement(&self) -> String {
            format!(
                "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] \
                 and certificate leaf[field.1.2.840.113635.100.6.1.13] \
                 and certificate leaf[subject.OU] = \"{}\" and identifier \"{}\"",
                self.team, self.identifier
            )
        }
    }

    pub struct Os;

    impl System for Os {
        /// `getpeereid` gives the user and the group at connect time.
        /// `LOCAL_PEERPID` gives the last process that used the socket of
        /// the peer, so a peer that shares its socket can change it.
        fn peer(&self, stream: &UnixStream) -> io::Result<Peer> {
            let fd = stream.as_raw_fd();
            let (mut uid, mut gid) = (0, 0);
            // SAFETY: `uid` and `gid` are valid for writes.
            if unsafe { libc::getpeereid(fd, &raw mut uid, &raw mut gid) } != 0 {
                return Err(io::Error::last_os_error());
            }
            let mut pid: libc::pid_t = 0;
            let mut len = size_of::<libc::pid_t>() as libc::socklen_t;
            // SAFETY: `pid` and `len` are valid for the call, and `len` is the
            // size of `pid`. The kernel writes at most `len` bytes.
            let result = unsafe {
                libc::getsockopt(
                    fd,
                    libc::SOL_LOCAL,
                    libc::LOCAL_PEERPID,
                    (&raw mut pid).cast(),
                    &raw mut len,
                )
            };
            if result != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Peer { pid, uid, gid })
        }

        fn binary(&self, pid: libc::pid_t) -> io::Result<PathBuf> {
            let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
            // SAFETY: `path` is valid for writes of its full length.
            let len =
                unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
            if len <= 0 {
                return Err(io::Error::last_os_error());
            }
            path.truncate(len as usize);
            Ok(OsString::from_vec(path).into())
        }

        fn parent(&self, pid: libc::pid_t) -> io::Result<libc::pid_t> {
            // SAFETY: all fields are integers, so zero is a valid value.
            let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
            let size = size_of::<libc::proc_bsdinfo>() as libc::c_int;
            // SAFETY: `info` is valid for writes of `size` bytes.
            let written = unsafe {
                libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size)
            };
            if written != size {
                return Err(io::Error::last_os_error());
            }
            Ok(info.pbi_ppid as libc::pid_t)
        }

        /// The name comes from the signature. The path can show a hard link
        /// in a temporary folder, for example the clone that Chromium keeps
        /// of its app.
        fn browser(&self, pid: libc::pid_t) -> Result<String, String> {
            match approved_browser(pid) {
                Ok(browser) => Ok(format!(
                    "{} ({}, team {})",
                    browser.app, browser.identifier, browser.team
                )),
                Err(err) => {
                    let name = self.binary(pid).map_or_else(
                        |_| format!("process {pid}"),
                        |path| path.display().to_string(),
                    );
                    Err(refusal(&name, &err))
                }
            }
        }
    }

    /// The running code of a process.
    fn guest(pid: libc::pid_t) -> Result<SecCode, Error> {
        let mut attributes = GuestAttributes::new();
        attributes.set_pid(pid);
        SecCode::copy_guest_with_attribues(None, &attributes, Flags::NONE)
    }

    fn approved_browser(pid: libc::pid_t) -> Result<&'static Browser, Error> {
        let code = guest(pid)?;
        for browser in BROWSERS {
            match check(&code, &browser.requirement()) {
                Ok(()) => return Ok(browser),
                Err(err) if err.code() == REQUIREMENT_FAILED => {}
                Err(err) => return Err(err),
            }
        }
        Err(Error::from_code(REQUIREMENT_FAILED))
    }

    /// Checks running code against a code requirement. The check does not
    /// use the network, because a revocation check online can stall the
    /// connection.
    fn check(code: &SecCode, requirement: &str) -> Result<(), Error> {
        let requirement: SecRequirement = requirement.parse()?;
        match code.check_validity(Flags::NO_NETWORK_ACCESS, &requirement) {
            // Before macOS 11.3, running code does not accept the flag.
            Err(err) if err.code() == INVALID_FLAGS => {
                code.check_validity(Flags::NONE, &requirement)
            }
            result => result,
        }
    }

    /// Tells why the signature check refuses the process `name`.
    fn refusal(name: &str, err: &Error) -> String {
        match err.code() {
            REQUIREMENT_FAILED | UNSIGNED => format!("{name} is not an approved browser"),
            CHANGED_ON_DISK => format!(
                "{name} changed on disk while it runs: restart the browser to finish its update"
            ),
            _ => format!("cannot check the code signature of {name}: {err}"),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn requirements_are_valid() {
            for browser in BROWSERS {
                let requirement = browser.requirement();
                assert!(
                    requirement.parse::<SecRequirement>().is_ok(),
                    "{requirement}"
                );
            }
        }

        #[test]
        fn installed_browsers_meet_their_requirement() {
            // The macOS runners of GitHub have Chrome and Edge.
            for browser in BROWSERS {
                let app = format!("/Applications/{}.app", browser.app);
                if !Path::new(&app).exists() {
                    continue;
                }
                let status = std::process::Command::new("codesign")
                    .args([
                        "--verify",
                        "-R",
                        &format!("={}", browser.requirement()),
                        &app,
                    ])
                    .status()
                    .unwrap();
                assert!(status.success(), "{app} does not meet its requirement");
            }
        }

        #[test]
        fn launchd_has_the_signature_of_apple_but_not_of_a_browser() {
            let launchd = guest(1).unwrap();
            let apple = "anchor apple and identifier \"com.apple.xpc.launchd\"";
            assert!(check(&launchd, apple).is_ok());
            let reason = Os.browser(1).unwrap_err();
            assert!(reason.ends_with("is not an approved browser"), "{reason}");
        }

        #[test]
        fn refusal_tells_the_cause() {
            let refusal = |code| refusal("/Applications/X.app", &Error::from_code(code));
            assert!(refusal(REQUIREMENT_FAILED).ends_with("is not an approved browser"));
            assert!(refusal(UNSIGNED).ends_with("is not an approved browser"));
            assert!(refusal(CHANGED_ON_DISK).contains("restart the browser"));
            assert!(refusal(INVALID_FLAGS).starts_with("cannot check the code signature"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> io::Result<Owner> {
        Ok(Owner {
            uid: 0,
            mode: 0o755,
        })
    }

    const RELAY: &str = "/usr/bin/onay-relay";

    /// A relay with the process ID 10, started by a browser with the
    /// process ID 1.
    struct Fake {
        peer_uid: u32,
        peer_binary: Option<&'static str>,
        parent: Option<libc::pid_t>,
        browser: Result<&'static str, &'static str>,
    }

    fn fake() -> Fake {
        Fake {
            peer_uid: 1000,
            peer_binary: Some(RELAY),
            parent: Some(1),
            browser: Ok("Google Chrome"),
        }
    }

    impl System for Fake {
        fn peer(&self, _: &UnixStream) -> io::Result<Peer> {
            Ok(Peer {
                pid: 10,
                uid: self.peer_uid,
                gid: 1000,
            })
        }

        fn own_uid(&self) -> libc::uid_t {
            1000
        }

        fn relay(&self, path: &Path) -> io::Result<RelayFile> {
            Ok(RelayFile {
                path: path.to_owned(),
                gid: 990,
                mode: 0o755,
            })
        }

        fn binary(&self, pid: libc::pid_t) -> io::Result<PathBuf> {
            assert_eq!(pid, 10);
            self.peer_binary
                .map(PathBuf::from)
                .ok_or_else(|| io::ErrorKind::NotFound.into())
        }

        fn parent(&self, pid: libc::pid_t) -> io::Result<libc::pid_t> {
            assert_eq!(pid, 10);
            self.parent.ok_or_else(|| io::ErrorKind::NotFound.into())
        }

        fn browser(&self, pid: libc::pid_t) -> Result<String, String> {
            assert_eq!(pid, 1);
            self.browser.map(str::to_owned).map_err(str::to_owned)
        }
    }

    #[test]
    fn approved_browser_behind_our_relay_passes() {
        let (ours, _theirs) = UnixStream::pair().unwrap();
        let checked = check_peer(&fake(), &ours, Path::new(RELAY));
        assert_eq!(checked, Ok("Google Chrome".into()));
    }

    #[test]
    fn each_failed_step_refuses_the_peer() {
        let (ours, _theirs) = UnixStream::pair().unwrap();
        let reason = |fake: Fake| check_peer(&fake, &ours, Path::new(RELAY)).unwrap_err();
        let other_user = Fake {
            peer_uid: 0,
            ..fake()
        };
        assert!(reason(other_user).contains("different user"));
        let not_the_relay = Fake {
            peer_binary: Some("/tmp/fake"),
            ..fake()
        };
        assert!(reason(not_the_relay).contains("not the relay"));
        let no_parent = Fake {
            parent: None,
            ..fake()
        };
        assert!(reason(no_parent).contains("parent of the relay"));
        let not_approved = Fake {
            browser: Err("not approved"),
            ..fake()
        };
        assert_eq!(reason(not_approved), "not approved");
    }

    #[test]
    fn the_system_names_this_process_and_its_parent() {
        let (ours, _theirs) = UnixStream::pair().unwrap();
        let pid = std::process::id() as libc::pid_t;
        assert_eq!(Os.peer(&ours).unwrap().pid, pid);
        let exe = fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
        assert_eq!(Os.binary(pid).unwrap(), exe);
        assert_eq!(
            Os.parent(pid).unwrap() as u32,
            std::os::unix::process::parent_id()
        );
    }

    #[test]
    fn a_test_process_is_not_the_relay() {
        let (ours, _theirs) = UnixStream::pair().unwrap();
        let relay = std::env::current_exe()
            .unwrap()
            .with_file_name("no-such-relay");
        assert!(verify(&ours, &relay).is_err());

        // With the test binary as the "relay", the relay check passes and
        // the browser check decides. The parent is cargo or a shell, never
        // an approved browser.
        let relay = std::env::current_exe().unwrap();
        let reason = verify(&ours, &relay).unwrap_err();
        assert!(
            reason.contains("approved browser") || reason.contains("package manager"),
            "{reason}"
        );
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
    fn replaced_binary_is_checked_at_its_installed_path() {
        let chrome = Path::new("/opt/google/chrome/chrome");
        let replaced = Path::new("/opt/google/chrome/chrome (deleted)");
        assert_eq!(installed_path(replaced), chrome);
        assert_eq!(installed_path(chrome), chrome);
    }

    #[test]
    fn approved_browser_in_a_root_location_passes() {
        let browser = Path::new("/opt/google/chrome/chrome");
        assert_eq!(check_browser(browser, &[], &|_| root()), Ok(()));
    }

    #[test]
    fn unknown_browser_needs_the_custom_list() {
        let browser = Path::new("/usr/lib/x86_64-linux-gnu/opera/opera");
        assert!(check_browser(browser, &[], &|_| root()).is_err());
        assert_eq!(
            check_browser(browser, &["opera".into()], &|_| root()),
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
