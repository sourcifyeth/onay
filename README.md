# Onay: local signing companion

A second, independent check on every transaction before you sign.

Ethereum is built to be verifiable, and verification is cheap. Yet most users still sign transactions without independently checking what they approve. Onay makes that second check seamless: it verifies the transaction locally, explains what it does, and lets you compare against your wallet before signing.

Onay is a local desktop app with a thin browser extension that sits between the dapp and the wallet. It intercepts the signing request, verifies chain state through an embedded [Helios](https://github.com/a16z/helios) light client, recompiles and verifies the source code locally, simulates the transaction, renders its intent in readable form with ERC-7730 clear signing, and finally displays the ERC-8213 calldata digest for an equivalence check with the wallet. Onay is view only: it holds no keys and does not replace your wallet.

The plan of record is [PLAN.md](PLAN.md).

## What is in this repo

| Folder       | What it is                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`       | The desktop app (Tauri). The web user interface is in `app/src/`, the Rust side in `app/src-tauri/`. Also holds the relay (`app/relay/`) and the code that relay and app share (`app/ipc/`). |
| `extension/` | The Chrome extension (Manifest V3). No runtime dependencies.                                                                                                                                 |

## Prerequisites

- Node.js 22 or newer and pnpm. The exact pnpm version is pinned in `package.json`; pnpm switches to it automatically.
- Rust through [rustup](https://rustup.rs). The compiler version is pinned in `app/rust-toolchain.toml`; rustup installs it on first use.
- Google Chrome or Chromium, installed as a normal package. Snap and Flatpak browsers cannot start the relay.
- Linux only: the Tauri system libraries.

  ```
  sudo apt install libwebkit2gtk-4.1-dev libdbus-1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

- macOS only: the Xcode Command Line Tools (`xcode-select --install`).

Then install the JavaScript dependencies once, from the repo root:

```
pnpm install
```

## Development

### 1. Run the app

```
pnpm --filter app tauri dev
```

This builds the relay, starts the web user interface with hot reload, compiles the app, and opens its window. At startup the app does two things:

- It writes the native messaging host manifest for each installed browser, for example `~/.config/google-chrome/NativeMessagingHosts/dev.sourcify.onay.json`. The manifest points to the relay in `app/target/debug/`.
- It opens a Unix socket at `$XDG_RUNTIME_DIR/onay/onay.sock` (Linux) or `$TMPDIR/onay/onay.sock` (macOS).

The window lists both under "Browser link".

### 2. Load the extension

```
pnpm --filter extension build
```

1. Open `chrome://extensions` and turn on "Developer mode".
2. Click "Load unpacked" and select `extension/dist`.
3. Check that the ID is `jhopbgoicoiceialjejgojebmeijklbn`. The app accepts only this ID. The `key` field in `extension/manifest.json` keeps it the same on every machine.

After a code change, build again and click the reload icon on the extension card.

### 3. Pair and test

1. The first time the extension reaches the app, both show a six-digit code: the extension in a small window, the app in its main window. Check that the codes are equal and press "Approve" in the app. The pairing is stored on both sides.
2. Open a dapp with a wallet extension installed, for example the [MetaMask test dapp](https://metamask.github.io/test-dapp/), and trigger a signature or a transaction.
3. The wallet opens as usual. At the same time the request appears in the app under "Signing requests", with the site, the method, and the raw parameters. When you answer in the wallet, the app shows the outcome.

To pair again, quit the app and delete its key store: `~/.local/share/dev.sourcify.onay/link.json` (Linux) or `~/Library/Application Support/dev.sourcify.onay/link.json` (macOS). At the next start the app makes a new key and knows no extension, so the extension shows a new pairing code. The development and the production app use the same file, so this resets both. To give the extension a new key too, run `indexedDB.deleteDatabase('onay')` in the console of its service worker (`chrome://extensions`, "service worker" link on the Onay card) and reload the extension.

The Onay icon in the Chrome toolbar shows the state of the link. If the app is not running when a site asks for a signature, the extension opens a small window that asks you to start the app, and it forwards the request when the app is there.

On Linux the app accepts a connection only from an approved browser that is installed by a package manager. It reads more browser names from `/etc/onay/custom_allowed_browsers`, one binary name per line, if that file belongs to root.

### Checks

Run these before you push. Continuous integration (CI) runs the same commands.

| Command                                     | Where     | What it does                                                                                                       |
| ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm -r build`                             | repo root | Type-checks and builds the mock, the app's web user interface, and the extension.                                  |
| `pnpm format:check`                         | repo root | Checks the formatting with oxfmt. `pnpm format` fixes it.                                                          |
| `pnpm -r lint`                              | repo root | Runs oxlint.                                                                                                       |
| `pnpm -r test`                              | repo root | Runs the extension tests with the Node.js test runner.                                                             |
| `cargo test`                                | `app/`    | Runs the Rust tests, including one that drives the real relay binary.                                              |
| `cargo clippy --all-targets -- -D warnings` | `app/`    | Rust lints.                                                                                                        |
| `cargo fmt --all --check`                   | `app/`    | Rust formatting.                                                                                                   |
| `cargo deny check`                          | `app/`    | Advisories, licenses, and sources of the Rust dependencies. Install once with `cargo install --locked cargo-deny`. |

## Production

Nothing is published yet. These commands produce the same artifacts a release will ship. Signing, notarization, and the release pipeline are tracked in [issue 15](https://github.com/sourcifyeth/onay/issues/15).

### The app package

```
pnpm --filter app bundle
```

This builds the relay in release mode, copies it to where Tauri expects an extra binary, and runs `tauri build` with the settings in `app/src-tauri/tauri.bundle.conf.json`. The packages land in `app/target/release/bundle/`:

- Linux: a `.deb` in `deb/` and an `.rpm` in `rpm/`.
- macOS: `Onay.app` in `macos/` and a `.dmg` in `dmg/`.

The package contains two binaries side by side: `onay` (the app) and `onay-relay`. On Linux its install script gives the relay its own group and the setgid bit, as hardening. To install and run on Debian or Ubuntu:

```
sudo apt install ./app/target/release/bundle/deb/Onay_0.0.0_amd64.deb
onay
```

Start the app once after installing. The first start writes the host manifest, now pointing to the installed relay (`/usr/bin/onay-relay`).

### The extension package

```
pnpm --filter extension package
```

This writes `extension/onay-extension.zip` for the Chrome Web Store. It is the same code as the development build, without the `key` field in the manifest, because the store rejects it.

To keep the extension ID that the app accepts, the first upload to the store must include the private key as `key.pem` in the root of the zip. That key is `extension/key.pem`, which is not in the repo. After the first upload the store holds the key, and later uploads do not need it.

### Development and production side by side

There is one host manifest per browser, and each start of the app overwrites it. The app you started last is the one the extension reaches. To switch back to the development build, start it again with `pnpm --filter app tauri dev`.

## How the parts talk

```
web page -> extension -> Chrome -> relay -> app
                       (starts it)  (Unix socket)
```

- The extension asks Chrome to connect to the host named `dev.sourcify.onay`.
- Chrome reads the host manifest, checks that the extension ID is allowed, and starts the relay.
- The relay connects to the app's socket and copies bytes in both directions. It does not read the messages.
- The app checks that the relay was started by an approved browser. Then extension and app exchange public keys, and every later message is encrypted. The app's long-term key is in its data directory, the extension's key is in the browser's key store.
- The extension only copies signing requests to the app. The wallet gets each request unchanged and at the same time.
- No network port is opened at any point.

## License

[GPL-3.0-only](LICENSE).

## User experience mock

The `mock/` folder holds a clickable mock of the first release with fake data. It is live at [sourcifyeth.github.io/onay](https://sourcifyeth.github.io/onay/). To run it locally: `pnpm --filter mock dev`.
