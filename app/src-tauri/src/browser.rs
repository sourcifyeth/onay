//! Opens a link in the default browser of the desktop. The webview has no
//! window for a link, so it asks the app. Only the few sites the webview
//! links to are allowed.

use std::process::Command;

const ALLOWED: &[&str] = &["https://github.com/", "https://4byte.sourcify.dev/"];

/// True if the URL starts with an allowed site and has only the
/// characters a URL is made of. The path of a link can come from the
/// registry index, which is third-party data.
pub fn allowed(url: &str) -> bool {
    ALLOWED.iter().any(|site| url.starts_with(site))
        && url
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-._~:/?#[]@!$&'()*+,;=%".contains(&c))
}

/// The command of the desktop that opens a URL in the default browser.
/// None of them goes through a shell, so the URL is one argument and
/// never a command.
fn opener(url: &str) -> Command {
    let mut command = if cfg!(target_os = "macos") {
        Command::new("open")
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
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
    fn rejects_what_a_url_is_not_made_of() {
        assert!(!allowed("https://github.com/a b"));
        assert!(!allowed("https://github.com/a\nb"));
        assert!(!allowed("https://github.com/a\u{0}b"));
        assert!(!allowed("https://github.com/a|b"));
        assert!(!allowed("https://github.com/a^b"));
        assert!(!allowed("https://github.com/a\"b"));
        assert!(!allowed("https://github.com/a<b>"));
        assert!(!allowed("https://github.com/ü"));
        assert!(allowed(
            "https://github.com/x/blob/master/registry/a/calldata-b.json"
        ));
        assert!(allowed("https://4byte.sourcify.dev/?q=0xa9059cbb&x=1"));
    }

    #[test]
    fn opener_never_uses_a_shell_and_passes_the_url_as_one_argument() {
        let url = "https://github.com/registry/x&calc.exe&.json";
        let command = opener(url);
        let program = command.get_program().to_string_lossy();
        assert!(!program.contains("cmd"), "{program}");
        assert!(!program.contains("sh"), "{program}");
        assert_eq!(command.get_args().last().unwrap(), url);
    }
}
