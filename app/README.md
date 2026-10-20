# The Onay app

A Tauri desktop app: a Rust program that shows a web page in its window. The Rust side owns the link to the browser extension, the keys, and later the verification. The web page in the window shows the result. The app never holds wallet keys and never answers a signing request. The wallet decides.

## Build and test

```
pnpm tauri dev         # build the relay, start the page with hot reload, open the window
pnpm build             # type-check and build the page only
pnpm test              # type-check and run the tests of the page's pure modules
pnpm bundle            # the package with the relay inside, in target/release/bundle/
cargo build            # both binaries
cargo test             # all Rust tests
cargo clippy --all-targets -- -D warnings
cargo fmt --all --check
cargo deny check       # advisories, licenses, sources, bans
```

The Rust tests cover the channel against the shared vectors, the key store, the peer rules, the whole link with a fake extension over a socket pair, and the relay binary against a fake app. The page tests in `test/` cover the pure gate modules: what a request names and what it runs, how a gate reports, the contract set and its verdicts, the Sourcify lookup, the compiler list and its hash check, the creation transaction, and the state of the simulation on a fake chain. Two tests run the real compiler: one with the real lib-sourcify on a small contract, one with the real EVM on three contracts that call each other. Both take the compiler build from `test/.cache/`, downloaded on the first run.

The package settings live in `src-tauri/tauri.bundle.conf.json`, apart from the main Tauri config, so that `tauri dev` works without a packaged relay. `src-tauri/packaging/postinstall.sh` is the install script of the Linux packages.

## The parts

Three Rust crates in one Cargo workspace, and one web user interface.

```mermaid
flowchart LR
  subgraph browser [Browser]
    extension[extension]
  end
  relay[onay-relay]
  subgraph app [onay]
    rust[Rust side]
    webview[web user interface]
  end
  ipc[(onay-ipc)]

  extension -- native messaging<br/>stdin and stdout --> relay
  relay -- Unix socket --> rust
  rust -- events and commands --> webview
  relay -. uses .-> ipc
  rust -. uses .-> ipc
```

| Path         | Builds                  | Does                                                                                                                                                                                                        |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipc/`       | a library               | What relay and app share: the host name, the extension ID, the socket path, and the framing of one native message. No dependencies.                                                                         |
| `relay/`     | the `onay-relay` binary | The bridge that Chrome starts. It copies bytes between the browser and the app's socket and does not read them. No dependencies except `ipc`.                                                               |
| `src-tauri/` | the `onay` binary       | The app. It registers the relay with the browsers, listens on the socket, checks who connects, runs the encrypted channel and the pairing, and keeps the state the window shows. Tauri gives it the window. |
| `src/`       | the page in the window  | React and Tailwind, same setup as the mock. It reads the state through Tauri commands and listens for one event that says "the state changed".                                                              |

The files inside `src/` and `src-tauri/src/` change with every step of the plan, so this document does not list them. The two lasting parts are the relay and the way a message gets into the app.

## From the extension to the window

Chrome can start a program for an extension, but it cannot connect to a program that already runs. This is the native messaging rule, and it is why the relay exists. One connection goes through these steps.

1. **The host manifest.** At start, the app writes a file for each installed browser, for example `~/.config/google-chrome/NativeMessagingHosts/dev.sourcify.onay.json`. The file names the path of the relay binary and the one extension ID that may use it. Brave on macOS reads the file in the directory of Chrome.
2. **Chrome starts the relay.** When the extension connects to the host `dev.sourcify.onay`, Chrome reads that file and starts the relay as a child process. Chrome talks to it over stdin and stdout. Each message is a 4-byte length followed by JSON.
3. **The relay connects to the app.** It opens the app's Unix socket at `$XDG_RUNTIME_DIR/onay/onay.sock` on Linux, or `$TMPDIR/onay/onay.sock` on macOS. Only the user can open that directory. From then on the relay copies bytes in both directions. It does not parse, buffer, or change them. When either side closes, it exits, and Chrome sees the port close. If the app is not running, the relay sends one message, `{"type":"error","message":"app not running"}`, and exits. The extension shows that and tries again later.
4. **The app checks the peer.** The app asks the kernel who connected. The peer must be our relay, run by the same user, and the relay's parent must be an approved browser: Chrome, Brave, Edge, or Vivaldi, Chromium on Linux, Arc on macOS, and the other channels of Chrome and Edge. On Linux that browser must be installed by a package manager: the binary and its directories belong to root. On macOS the running browser must have a valid code signature with an approved bundle identifier and Team ID, for example `com.google.Chrome` from Google's team `EQHXZ8M8AV`. Chromium has only an ad hoc signature, which any program can make, so the app refuses it on macOS. On Linux, the file `/etc/onay/custom_allowed_browsers` adds binary names, one for each line, if it belongs to root. A peer that fails gets one error message, and the window lists the reason.
5. **Hello.** Both sides send one message in the clear: their long-term X25519 public key and a random salt. Both derive the session keys with HKDF-SHA-256, two AES-256-GCM keys, one for each direction. The specification and the test vectors are shared with the extension, see `src-tauri/src/channel.rs` and `../testdata/`.
6. **Pairing.** If the app does not know the extension's key, both sides show a six-digit code computed from the two public keys. The user compares the codes and approves in the window. The app stores the key next to its own in the app data directory, for example `~/.local/share/dev.sourcify.onay/link.json` on Linux, and tells the extension. Delete that file to reset all pairings. A rejection closes the connection and stores nothing.
7. **Sealed messages.** Every later message is encrypted with a counter as nonce. A lost, repeated, reordered, or changed message fails to open, and the connection ends. The extension sends three kinds: a signing request that a page made, with the origin that the browser reported, the outcome the wallet gave, and a request to bring the window to the front. The app sends two kinds: paired, and pairing rejected.
8. **State and window.** The app keeps the connections, the pairing requests, and the last 50 signing requests in memory. After each change it emits one event to the page. The page then calls a command that returns the whole state and renders it. Two more commands answer a pairing and dismiss a request.

The relay ships inside the app package, next to the `onay` binary, so the user installs only app and extension. During development both binaries are in `target/debug/`. The Linux package makes the relay setgid to its own group, so the user cannot trace it or preload code into it.

## The simulation

Next to the gates of the contracts that the request names, the page runs the calls of a transaction in a local EVM, the one of ethereumjs, for one purpose: the call tree. Every contract whose code runs on the way joins the list of contracts, and the Sourcify gate checks each one. The EVM reads accounts, code and storage slots as it needs them, through `chain_request` in Helios mode, where each read comes with a Merkle proof against the state root of the block, or straight from the endpoint in RPC mode. `src/gates/state.ts` is that state: it reads each value once, at the block that the request is checked at, and keeps the writes of the EVM with the checkpoints that a reverted call undoes. `src/gates/simulation.ts` runs the calls and records each message as a frame of the tree: call, staticcall, delegatecall or create, the address whose code ran, the selector, the value, and the error if the message failed. A revert is a result, not a failure of the gate: the review shows the reason. The gate fails when the chain cannot be read.

A contract that the request names must pass both gates. A contract whose code runs as a named contract, the implementation of a proxy or a facet of a diamond, must pass too: the simulation records the context of each frame, and a delegatecall keeps the context of its caller. A contract that only the simulation found may have nothing on Sourcify: the request still passes, with the status `flagged`, and the review marks that contract. A contract on the way whose sources do not match the chain fails the request, like a named one. A call that reverts leaves the request `flagged` too: the review says so, and `src/gates/run.ts` is where these rules live. An account with a delegate under EIP-7702 skips the Sourcify gate, since the code of the delegate is what runs, in the context of the account: the same rule makes the delegate of a named account count as named, and the delegate of an account on the way one more contract on the way. A transaction that the simulation cannot run, a contract creation or a batch without a sender for example, leaves the request `flagged`, because the call tree was not checked. A signature runs nothing on chain and is not flagged for it.

What the simulation is not: a prediction of the gas, the fees or the effects. The EVM runs the calls alone, not in a block, with the rules of the newest Ethereum hardfork on every chain, the header of the block the request is checked at, and no block hashes. The calls of a batch (`wallet_sendCalls`) run one after the other from the sender of the batch, which is how a plain account would run them, not how a smart account does. An account under EIP-7702 runs the code of its delegate, and the delegate joins the list too.

## The Solidity compiler

The Sourcify gate compiles the sources in the page, with the official emscripten build of solc for the version Sourcify names. The build comes from `binaries.soliditylang.org`, and runs only if its SHA-256 is the one in the official list, which the page fetches fresh at each session. After the check the page keeps the build in the Cache API of the webview, so the next start does not download it again, and hashes it again each time it comes out of the cache. The cache is not trusted: a build that another process planted there fails the check and is thrown out.

web-solc runs the build in a worker made from a Blob, and the worker loads the build with `importScripts` from a Blob too. The Content Security Policy in `src-tauri/tauri.conf.json` therefore allows `blob:` in `script-src` and `worker-src`, and `'wasm-unsafe-eval'` because the build is WebAssembly. This widens the policy: any script in the page that can make a Blob can run it as code, and any script can instantiate WebAssembly. It is acceptable because the only scripts in the page are the bundle itself and the compiler builds, and a build reaches a Blob only after its hash matched the list. `connect-src` allows any HTTPS host and local ports, because the RPC endpoint of a chain is the user's choice. Tauri applies the policy to the packaged app only, not to `tauri dev`, so a change to it must be checked with the bundle.

In development the page runs on `localhost`. The packaged app serves the page from Tauri's own scheme, and WebKitGTK offers the Cache API there too: the Linux bundle keeps the builds in `~/.local/share/dev.sourcify.onay/CacheStorage/`, checked on 2026-10-13. The code handles a missing cache all the same, by downloading the build at each start.
