# Onay: local signing companion

A second, independent check on every transaction before you sign.

Ethereum is built to be verifiable, and verification is cheap. Yet most users still sign transactions without independently checking what they approve. Onay makes that second check seamless: it verifies the transaction locally, explains what it does, and lets you compare against your wallet before signing.

Onay is a local desktop app with a thin browser extension that sits between the dapp and the wallet. It intercepts the signing request, verifies chain state through an embedded [Helios](https://github.com/a16z/helios) light client, recompiles and verifies the source code locally, simulates the transaction, renders its intent in readable form with ERC-7730 Clear Signing, and finally displays the ERC-8213 calldata digest for an equivalence check with the wallet. Onay is view only: it holds no keys and does not replace your wallet.

The plan of record is [PLAN.md](PLAN.md).

## What is in this repo

| Folder       | What it is                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`       | The desktop app (Tauri). The web user interface is in `app/src/`, the Rust side in `app/src-tauri/`. Also holds the relay (`app/relay/`) and the code that relay and app share (`app/ipc/`). |
| `site/`      | The download page at [onay.sh](https://onay.sh). Static HTML, built with Vite and Tailwind.                                                                                                  |
| `extension/` | The Chrome extension (Manifest V3). No runtime dependencies.                                                                                                                                 |

## Prerequisites

- Node.js 22 or newer and pnpm. The exact pnpm version is pinned in `package.json`; pnpm switches to it automatically.
- Rust through [rustup](https://rustup.rs). The compiler version is pinned in `app/rust-toolchain.toml`; rustup installs it on first use.
- A Chromium-based browser: Google Chrome, Brave, Microsoft Edge, or Vivaldi, Chromium on Linux, Arc on macOS. On Linux, install it as a normal package: Snap and Flatpak browsers cannot start the relay.
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

The settings list both under "Browser link".

### 2. Load the extension

```
pnpm --filter extension build
```

1. Open `chrome://extensions` and turn on "Developer mode".
2. Click "Load unpacked" and select `extension/dist`.
3. Check that the ID is `iobfgkmfcccohihielbadfbebklmbdbp`. The app accepts only this ID. The `key` field in `extension/manifest.json` keeps it the same on every machine.

After a code change, build again and click the reload icon on the extension card.

### 3. Pair and test

1. The first time the extension reaches the app, both show a six-digit code: the extension in a small window, the app in its main window. Check that the codes are equal and press "Approve" in the app. The pairing is stored on both sides.
2. Open a dapp with a wallet extension installed, for example the [MetaMask test dapp](https://metamask.github.io/test-dapp/), and trigger a signature or a transaction.
3. The wallet opens as usual. At the same time the request appears in the app under "Signing requests", with the site, the method, and the raw parameters. When you answer in the wallet, the app shows the outcome.
4. Under "settings", add the addresses of the auditors whose ERC-7730 attestations you trust. The app counts a descriptor from the [clear-signing registry](https://github.com/ethereum/clear-signing-erc7730-registry) as reviewed only after one of them attested it; otherwise it shows the descriptor as a preview with a warning. The registry's `auditors/` directory lists them. The same page holds the token lists: a call to a listed token renders with the ERC-20 template. The Uniswap Labs Default list is there from the start; add more by URL, in the Uniswap Token Lists format.

To pair again, quit the app and delete its key store: `~/.local/share/dev.sourcify.onay/link.json` (Linux) or `~/Library/Application Support/dev.sourcify.onay/link.json` (macOS). At the next start the app makes a new key and knows no extension, so the extension shows a new pairing code. The development and the production app use the same file, so this resets both. To give the extension a new key too, run `indexedDB.deleteDatabase('onay')` in the console of its service worker (`chrome://extensions`, "service worker" link on the Onay card) and reload the extension.

The Onay icon in the Chrome toolbar shows the state of the link. If the app is not running when a site asks for a signature, the extension opens a small window that asks you to start the app, and it forwards the request when the app is there.

The app accepts a connection only from an approved browser. On Linux that browser must be installed by a package manager, and the app reads more browser names from `/etc/onay/custom_allowed_browsers`, one binary name per line, if that file belongs to root. Such a browser also needs a copy of the host manifest in its own `NativeMessagingHosts` directory. On macOS the browser must have a valid code signature from its vendor. This check keeps out stray programs, but a program that runs as you can pass it, so approve a pairing only when the extension shows the same code.

### Checks

Run these before you push. Continuous integration (CI) runs the same commands.

| Command                                     | Where     | What it does                                                                                                                                                        |
| ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r build`                             | repo root | Type-checks and builds the mock, the app's web user interface, the extension, and the site.                                                                         |
| `pnpm format:check`                         | repo root | Checks the formatting with oxfmt. `pnpm format` fixes it.                                                                                                           |
| `pnpm -r lint`                              | repo root | Runs oxlint.                                                                                                                                                        |
| `pnpm -r test`                              | repo root | Runs the extension, app, and site tests with the Node.js test runner. The app tests download one compiler build on the first run and keep it in `app/test/.cache/`. |
| `pnpm test`                                 | repo root | Runs the tests of the scripts in `scripts/`.                                                                                                                        |
| `cargo test`                                | `app/`    | Runs the Rust tests, including one that drives the real relay binary.                                                                                               |
| `cargo clippy --all-targets -- -D warnings` | `app/`    | Rust lints.                                                                                                                                                         |
| `cargo fmt --all --check`                   | `app/`    | Rust formatting.                                                                                                                                                    |
| `cargo deny check`                          | `app/`    | Advisories, licenses, and sources of the Rust dependencies. Install once with `cargo install --locked cargo-deny`.                                                  |

## Production

Releases are built and published only by CI, from a version tag on `main`. The commands below produce the same artifacts locally, for a check before the tag. The remaining steps of the pipeline, such as build provenance and the store upload, are tracked in [issue 15](https://github.com/sourcifyeth/onay/issues/15).

### The app package

```
pnpm --filter app bundle
```

This builds the relay in release mode, copies it to where Tauri expects an extra binary, and runs `tauri build` with the settings in `app/src-tauri/tauri.bundle.conf.json`. The packages land in `app/target/release/bundle/`:

- Linux: a `.deb` in `deb/` and an `.rpm` in `rpm/`.
- macOS: `Onay.app` in `macos/` and a `.dmg` in `dmg/`. A local bundle carries an ad-hoc signature and is not notarized, so macOS blocks its first start: click "Done", then open System Settings, Privacy & Security, and click "Open Anyway" at the bottom. The release build signs with the Sourcify Developer ID and notarizes, see below.

The package contains two binaries side by side: `onay` (the app) and `onay-relay`. On Linux its install script gives the relay its own group and the setgid bit, as hardening. To install and run on Debian or Ubuntu:

```
sudo apt install ./app/target/release/bundle/deb/Onay_<version>_amd64.deb
onay
```

Start the app once after installing. The first start writes the host manifest, now pointing to the installed relay (`/usr/bin/onay-relay`).

### The extension package

```
pnpm --filter extension package
```

This writes `extension/onay-extension.zip` for the Chrome Web Store. It is the same code as the development build, without the `key` field in the manifest, because the store rejects it.

The zip is reproducible: with `SOURCE_DATE_EPOCH` set to the commit time, two builds of one commit give the same bytes. The bytes also depend on the zip tool: the store uploads are made with Info-ZIP `zip` 3.0, the `zip` of Debian, Ubuntu, and macOS, at its default compression. To compare a store submission with the commit it was built from:

```
git checkout <commit>
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) pnpm --filter extension package
sha256sum extension/onay-extension.zip
```

To keep the extension ID that the app accepts, the first upload to the store must include the private key as `key.pem` in the root of the zip. `pnpm --filter extension package:first` builds that zip from `extension/key.pem`, which is not in the repo (it is in the team password manager). The first upload is done by hand in the developer dashboard. After it the store holds the key, and later uploads use `package`. For now every store upload is by hand; the store API step of the release workflow is a follow-up in issue 15.

### The icon

The Onay mark, a round Nazar-inspired eye, has two vector sources: `app/src-tauri/app-icon.svg` for the app and `extension/store/icon.svg` for the extension and its store listing. The app source keeps the eye at 824 of 1024 pixels, like other macOS icons; the extension source fills the canvas, because Chrome shows it small. Every raster file comes from them:

```
pnpm --filter app exec tauri icon -o /tmp/onay-icons app-icon.png   # app-icon.png is app-icon.svg at 1024 pixels, then copy the files that icons/ has
rsvg-convert -w 32 -h 32 extension/store/icon.svg -o extension/icons/icon-32.png
rsvg-convert -w 128 -h 128 extension/store/icon.svg -o extension/icons/icon-128.png
cp extension/icons/icon-128.png extension/store/icon-128.png
```

### Releasing a version

The app and the extension have their own versions. The extension changes rarely, and the app states the oldest extension it works with: the two refuse each other when their channel protocol version (`VERSION` in `app/src-tauri/src/channel.rs` and `extension/src/channel.ts`) differs. A release of the app says in its notes which extension version it needs.

To release app `0.2.0`:

1. `pnpm version:set app 0.2.0` writes it into `app/package.json`, the Tauri config, and the Cargo workspace and lockfile. Open a pull request with the change and merge it.
2. Tag the merge commit on `main` and push the tag: `git tag 0.2.0 && git push origin 0.2.0`.

The `Release` workflow then checks that the tag is on `main` and equals the app version in the repo, builds the app packages (Linux x64, macOS arm64), and creates the GitHub release with them attached, with a `SHA256SUMS` file, and with the extension version at the tag in the first line of the notes. A tag that fails a check or a build publishes nothing.

A tag push is a release, so a tag ruleset in the repository settings (Rules, Rulesets, target all tags, rule "Restrict creations", with the repository admins in the bypass list) limits who creates version tags to the maintainers.

The signing secrets live in the `release` environment of the repository, whose deployment policy admits only tags matching `[0-9]*.[0-9]*.[0-9]*`. A workflow on a branch cannot use the environment, so no branch can reach the secrets, whatever its workflow files say. The workflow has no manual trigger for the same reason. The first tag after a change to the workflow is its test.

The macOS build signs and notarizes when these six secrets exist in the `release` environment, and makes an ad-hoc build when none of them does. Some of them set, and some not, fails the build:

- `APPLE_CERTIFICATE`: the Developer ID Application certificate with its private key, as a base64 `.p12` (`openssl base64 -A -in certificate.p12`). Only the Account Holder of the Apple Developer account can create this certificate. `APPLE_CERTIFICATE_PASSWORD` is the password of the `.p12`.
- `APPLE_SIGNING_IDENTITY`: the name of the certificate, such as `Developer ID Application: Sourcify (TEAMID)`.
- `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_CONTENT`: an App Store Connect API key with Developer access, for the notarization: the Issuer ID shown above the keys table, the Key ID, and the text of the downloaded `.p8` file.

The Rust compile runs before the secrets enter the environment, so no build script of the dependency tree sees them. Then Tauri imports the certificate into a keychain of its own on the runner, signs the app and the relay with the hardened runtime, sends the app to the Apple notary service, and staples the ticket.

To release extension `0.1.1`: `pnpm version:set extension 0.1.1`, merge, build the zip with `package` from the merge commit, and upload it in the developer dashboard. The store refuses a version that is not higher than the last one.

### The website

`site/` is the download page at [onay.sh](https://onay.sh). It is one static page with no script: the download links of the newest release are rendered at build time. `site/releases.mjs` writes the answer of the GitHub API to `site/releases.json`. A Vite plugin then keeps the published releases, checks them, and renders the newest one into `index.html`, with links to its release notes and its `SHA256SUMS` file. A failed API call fails the build, so an empty page never goes live. To run it locally:

```
pnpm --filter site dev
```

Cloudflare Pages builds and hosts the page. It builds on each push to `main` that changes `site/`, and gives each pull request that changes `site/` a preview link. The last job of the `Release` workflow calls a Pages deploy hook, so each release rebuilds the page with the new version. `site/public/_headers` sets the response headers, among them a Content Security Policy that allows no script and no inline style, so every animation lives in a stylesheet. The animation of the logo is in `site/src/style.css`. The scene next to the headline, a swap and a fake airdrop with the wallet and Onay side by side, is in `site/src/scene.css`; its first comment explains the timeline. The platform and browser icons are inline paths from [Simple Icons](https://simpleicons.org) 16.36.0 (CC0). The Sourcify mark in the footer comes from [sourcifyeth/assets](https://github.com/sourcifyeth/assets) (CC BY 4.0). `site/og-image.html` is the source of the link preview image `site/public/og-image.png`, a page of 1200 by 630 pixels that headless Chrome saves as a screenshot; the command is in its first comment.

The Pages project was set up by hand in the Cloudflare dashboard, with these settings:

1. Workers & Pages, Create, Pages, Connect to Git. The Cloudflare GitHub App has access to the `onay` repository only.
2. Project name `onay`, production branch `main`, framework preset None, build command `pnpm install --frozen-lockfile --filter site... && pnpm --filter site build`, build output directory `site/dist`, root directory empty. The build command installs only the packages of the site, not the whole workspace.
3. Environment variables for production and preview: `PNPM_VERSION` with the version of the `packageManager` field in `package.json` (the build image ignores that field), `NODE_VERSION` = `22`, and `SKIP_DEPENDENCY_INSTALL` = `1`, so that the build image does not install the whole workspace before the build command. If a build fails on the GitHub API rate limit, add `GITHUB_TOKEN` with a fine-grained token that can only read public repositories.
4. Settings, Build, Build watch paths: include `site/*`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `package.json`. A push that changes only the app or the extension then does not rebuild the page. A deploy hook builds in any case.
5. Custom domains: `onay.sh`. Cloudflare creates the DNS record and the certificate.
6. Settings, Build, Deploy hooks: a hook named `release` for the branch `main`. Its URL is the secret `CLOUDFLARE_PAGES_DEPLOY_HOOK` of the `release` environment in GitHub.

When the pnpm version in `package.json` changes, change `PNPM_VERSION` in the Pages project too.

### Development and production side by side

There is one host manifest per browser, and each start of the app overwrites it. An app that starts while another one runs stops before it writes the file, so quit the running app first. The app you started last is the one the extension reaches. To switch back to the development build, start it again with `pnpm --filter app tauri dev`.

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
