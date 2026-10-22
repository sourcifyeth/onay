//! Opens a link in the default browser of the desktop. The webview has no
//! window for a link, so it asks the app. Only the few sites the webview
//! links to are allowed.

use std::process::Command;

const ALLOWED: &[&str] = &["https://github.com/", "https://4byte.sourcify.dev/"];

/// True if the URL starts with an allowed site and has no blank or
/// control character.
pub fn allowed(url: &str) -> bool {
    ALLOWED.iter().any(|site| url.starts_with(site))
        && url.chars().all(|c| !c.is_whitespace() && !c.is_control())
}

/// The command of the desktop that opens a URL in the default browser.
fn opener(url: &str) -> Command {
    let mut command = if cfg!(target_os = "macos") {
        Command::new("open")
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    } else {
        Command::new("xdg-open")
    };
    command.arg(url);
    command
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !allowed(&url) {
        return Err(format!("not an allowed link: {url}"));
    }
    let mut child = opener(&url)
        .spawn()
        .map_err(|err| format!("cannot open the browser: {err}"))?;
    // Reap the opener when it exits. The browser runs on its own.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_linked_sites_only() {
        assert!(allowed(
            "https://github.com/ethereum/clear-signing-erc7730-registry"
        ));
        assert!(allowed("https://4byte.sourcify.dev/?q=0xa9059cbb"));
        assert!(!allowed("https://github.evil.com/"));
        assert!(!allowed("http://github.com/"));
        assert!(!allowed("https://example.com/https://github.com/"));
        assert!(!allowed("file:///etc/passwd"));
    }

    #[test]
    fn rejects_blank_and_control_characters() {
        assert!(!allowed("https://github.com/a b"));
        assert!(!allowed("https://github.com/a\nb"));
        assert!(!allowed("https://github.com/a\u{0}b"));
    }

    #[test]
    fn opener_takes_the_url_as_the_last_argument() {
        let command = opener("https://github.com/x");
        let last = command.get_args().last().unwrap();
        assert_eq!(last, "https://github.com/x");
    }
}
