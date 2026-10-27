//! Opens a link in the default browser of the desktop. The webview has no
//! window for a link, so it asks the app. Only the few sites the webview
//! links to are allowed.

use std::process::Command;

// The explorer hosts are the ones of EXPLORER_HOSTS in
// src/context/explorers.ts. Keep both lists the same.
const ALLOWED: &[&str] = &[
    "https://github.com/",
    "https://4byte.sourcify.dev/",
    "https://repo.sourcify.dev/",
    "https://etherscan.io/",
    "https://sepolia.etherscan.io/",
    "https://hoodi.etherscan.io/",
    "https://arbiscan.io/",
    "https://optimistic.etherscan.io/",
    "https://basescan.org/",
    "https://lineascan.build/",
    "https://eth.blockscout.com/",
    "https://eth-sepolia.blockscout.com/",
    "https://eth-hoodi.blockscout.com/",
    "https://arbitrum.blockscout.com/",
    "https://explorer.optimism.io/",
    "https://base.blockscout.com/",
    "https://explorer.linea.build/",
];

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
    fn allows_the_explorers_and_the_sourcify_repository() {
        let address = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
        let hosts = [
            "https://etherscan.io",
            "https://sepolia.etherscan.io",
            "https://hoodi.etherscan.io",
            "https://arbiscan.io",
            "https://optimistic.etherscan.io",
            "https://basescan.org",
            "https://lineascan.build",
        ];
        for host in hosts {
            let url = format!("{host}/address/{address}#code");
            assert!(allowed(&url), "{url}");
        }
        let hosts = [
            "https://eth.blockscout.com",
            "https://eth-sepolia.blockscout.com",
            "https://eth-hoodi.blockscout.com",
            "https://arbitrum.blockscout.com",
            "https://explorer.optimism.io",
            "https://base.blockscout.com",
            "https://explorer.linea.build",
        ];
        for host in hosts {
            let url = format!("{host}/address/{address}?tab=contract");
            assert!(allowed(&url), "{url}");
        }
        assert!(allowed(&format!("https://repo.sourcify.dev/1/{address}")));
        assert!(allowed("https://etherscan.io/apis"));
        assert!(!allowed("https://etherscan.io.evil.com/"));
        assert!(!allowed("https://eth.blockscout.com.evil.com/"));
        assert!(!allowed("https://api.etherscan.io/v2/api"));
        assert!(!allowed("https://evil.com/https://etherscan.io/"));
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
