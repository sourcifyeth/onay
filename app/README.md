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

The Rust tests cover the channel against the shared vectors, the key store, the peer rules, the whole link with a fake extension over a socket pair, and the relay binary against a fake app. The page tests in `test/` cover the pure gate modules: what a request names and what it runs, how a gate reports, the contract set and its verdicts, the Sourcify lookup, the compiler list and its hash check, the creation transaction, the state of the simulation on a fake chain, and the forms of a pasted request. Two tests run the real compiler: one with the real lib-sourcify on a small contract, one with the real EVM on three contracts that call each other. Both take the compiler build from `test/.cache/`, downloaded on the first run. The Clear Signing tests cover the trusted auditors, the plain decoding with the verified ABI, the data provider over a fake chain, the token lists, and the rendering with the real clear-signing library over a registry in memory. The compare tests check the digests against the test cases of ERC-8213, the example of EIP-712, and the snapshots of MetaMask's eth-sig-util, and the fields of each kind of request.

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
8. **State and window.** The app keeps the connections, the pairing requests, and the last 50 signing requests in memory. After each change it emits one event to the page. The page then calls a command that returns the whole state and renders it. Three more commands answer a pairing, add a request that the user pasted, and dismiss a request.

## Clear Signing

The page renders each request with `@ethereum-sourcify/clear-signing`, Sourcify's ERC-7730 library, in `src/clear-signing/`. The library gets a descriptor from the registry on GitHub and the values it needs from the page. The page keeps the trust decisions: a descriptor from the registry counts as reviewed only when an auditor from the user's list attested it, and otherwise renders as a preview with a warning, and the library reads the revocation state of the attestation on Ethereum mainnet through the same chain command as the gates, so Helios checks it with a proof. Token names and decimals, NFT collection names, block times, and ENS names come from the chain the same way; an ENS name counts only when its forward record points back to the address. A contract that one of the user's token lists holds renders with the bundled ERC-20 template, with its own name and symbol read from the chain. The lists, in `src/clear-signing/tokenLists.ts`, follow the Uniswap Token Lists format and are fetched over HTTPS from the webview, at most once a day, with a size cap; the last good copy of each stays in use when a fetch fails, and a major version bump waits for the user. The app starts with the Uniswap Labs Default list. A list is a claim of its publisher, so the page marks what comes from it with the third-party icon. With or without a descriptor, an ABI-Decoded tab shows the calldata as the verified ABI decodes it, through ethers, which lib-sourcify brings in already. A call to a proxy decodes with the ABI of the contract whose code ran in its context in the simulation, the implementation of a proxy, the facet of a diamond or a library: the decoder tries the ABI of the callee first, then those contracts, and says which one matched. The Sourcify lookup asks for the proxy detection of the server too. It is a claim, not a finding: when it names that contract, the page says that Sourcify confirms the proxy; otherwise the page says that the contract may be a facet or a library.

The last step of the review, in `src/compare/`, lists what the user compares with the confirmation screen of the wallet: the network, the recipient, the value, the calldata, and the signer, and the ERC-8213 digest that stands for the data. The digests have the names of the standard: the Calldata Digest of each call, the EIP-712 Digest with its Domain Hash and Message Hash for typed data, and the ERC-191 Digest of a personal_sign message. eth_sign gets no digest, because wallets sign it with or without the ERC-191 prefix. ethers hashes the typed data. Wallets read loose data in different ways (MetaMask takes a string for a bool or a missing field), so the page shows a digest only for data in the one form that all of them read alike, and says why otherwise. A wallet signs only the domain fields that the EIP712Domain type lists, so the rows, the gates, and Clear Signing read only those (`signedDomain` in `src/gates/request.ts`). Each digest shows in a box as the mock has it, and a click copies it. Above the values, the step shows the verdict of each step before it: a coral box names each step that failed and the reason, and an amber box each step that warns. The card stands out with the text about how to confirm only when every step passed. `stepVerdicts` in `src/gates/verdict.ts` gives the verdicts from the run and the Clear Signing result, and `GatePage` computes them once. The steps take their numbers and titles from `stepsOf` in the same module. A request that Onay could not check stops before the first step, and its verdict names the request and the reason. A transaction that sets a delegate (EIP-7702) is such a request, because no gate checks the delegate yet.

Links to the registry and to the signature database open in the browser of the desktop through the `open_url` command in `src-tauri/src/browser.rs`. The webview has no window for a link. The command allows a few sites only and runs `xdg-open` on Linux, `open` on macOS, and `start` on Windows.

For this, `chain_request` answers `eth_call` and `eth_getBlockByNumber` too. Helios runs a call in its own EVM and fetches a proof for each account and slot that the call reads.

The relay ships inside the app package, next to the `onay` binary, so the user installs only app and extension. During development both binaries are in `target/debug/`. The Linux package makes the relay setgid to its own group, so the user cannot trace it or preload code into it.

## Contract profile and explorers

Once the checks of a request ended, the page looks up the context of each address the request names, in `src/context/`. Nothing it finds changes the result of the checks: the gates stay Helios and Sourcify. `run.ts` holds the run, with the network, the chain, the lists, the settings and the clock as parameters, so the tests drive a whole run with fakes. `store.ts` keeps one run for each request and starts it again when the settings change, or when the address lists change after the run read them. A store that no card watches starts the new run only when a card watches it again.

- Explorer status, for each contract with code: Etherscan and Blockscout say whether they have its source code (`explorers.ts`). The verification card shows these rows under the Sourcify row. Etherscan is asked only with the user's own key. Each chain has built-in explorer hosts, and the chain card in the settings can change them, so a custom chain or an own Blockscout instance works. Each explorer gets at most two requests at a time, Etherscan with a gap of 350 ms, and after a rate limit the rest of the run asks that explorer nothing.
- Profile, for each named contract with code (`profile.ts`): the deployment and the deployer from Sourcify, then Blockscout, then Etherscan (`blockscout.ts`, `etherscan.ts`); whether the address has fewer than 100 transactions, and its first transaction, from the first pages of its transactions on Blockscout, else on Etherscan (the counters of Blockscout are not used: they are partial for a busy address); the ETH (ether) balance, the token amounts, the code of the deployer, and the block time read from the chain at the head block of the checks (`chain.ts`). Blockscout names at most ten tokens, and the page reads the amount of each with `eth_call` and says when Blockscout claims another amount. A contract deployed under 30 days ago, or with under 100 transactions, gets an amber hint.
- Lists, for every named address, also an account without code or an address that the chain gate did not read (`lists.ts`): Safe deployments and Uniswap deployments as allow lists, the OFAC (Office of Foreign Assets Control) sanctions list and ScamSniffer as block lists. The page fetches each from its GitHub repository once a day, keeps only the parsed entries in local storage, and keeps the last good copy when a fetch fails. The ERC-7730 registry of Clear Signing and the user's token lists count as allow lists too, with no new fetch. A list that has no data for the chain is named as missing, so the card never says "not on any list" while a list is not loaded. A block-list hit shows a coral notice at the top of the card.
- GoPlus (`goplus.ts`): a closed service that flags risky addresses without a key. On by default; a switch in the settings turns it off, and then no request goes to it.

What is verified and what is a claim: each value of the profile is a `Claimed` value with `proof` and `source`. `proof` is true only for a read that Helios checked against a proof; that value gets the green local mark. Every other value, from Sourcify, an explorer, a list, GoPlus, or an endpoint in RPC (Remote Procedure Call) mode, is a claim: a tooltip on the value shows the yellow third-party mark and names its data source, and the row itself shows no icon. A legend at the bottom of the window explains the two marks on every page, and each read writes a log line with the mark and the source in words. The words of the card (ages, the summary state, the search links) are in `card.ts`.

Session cache: an explorer answer that says verified or not verified is kept for the session. Each part of the Blockscout claims that answered is kept for 10 minutes; an answer that says Blockscout does not know the address is not kept, because a new contract can be missing from the index. So a second request for the same contract asks the explorer nothing again.

Settings: the Explorers section holds the Etherscan key, saved in the local storage of the webview. The Contract profile section has a switch, the kind, the license, the fetch time or the last error, and a refresh action for each list, and the switch of GoPlus.

Links: the card links to the explorers, the list repositories on GitHub, and web searches for the address on Google, DuckDuckGo, GitHub and X. The `open_url` command opens only the sites in `ALLOWED` in `src-tauri/src/browser.rs`, and `linkable` in `src/context/explorers.ts` holds the same list, which a test compares. A search link opens only in the one shape that `searchLinks` makes: the quoted address and nothing else, because a free query can redirect to any site (DuckDuckGo `!ducky`, Google `btnI`). `SEARCHES` in Rust and `SEARCH_SHAPES` in TypeScript hold these shapes, and the same test compares them. A link to any other site, such as a custom explorer host or a token list, shows as text.

## Pasted requests

A request can also come from the user, not from a page: pasted as text. `src/paste.ts` turns each form into the method and params of a request from a page, and the `add_request` command puts it in the same list, with the source `paste` and no connection. From there it goes through the same checks.

- A raw transaction: the RLP (Recursive Length Prefix) encoding in hex, signed or not, as `cast mktx` gives it. A typed transaction has its type byte in front of the RLP payload. ethers decodes it, and the sender of a signed one comes from its signature. A signed one gets the flag `signed`: the review calls it a signed transaction and shows its sender with the green local icon, because the signature proves it. Blob transactions and EIP-7702 transactions are refused, because the simulation does not model them.
- JSON: a transaction, or a JSON-RPC request with a signing method or with `eth_sendRawTransaction`, whose one param is a raw transaction. Calldata alone goes in as a transaction: `{"chainId": 1, "to": "0x…", "data": "0x…"}`.
- EIP-712 typed data goes in as a JSON-RPC request, with the signing account in `params[0]`. Clear Signing needs that account, and typed data alone does not name it, so the card refuses typed data without an account and shows the form to use.

No wallet reports the chain of a pasted request, so a pasted transaction in any form must name its chain. The card also runs `requestProblem`, the check that the review runs first, so it refuses a field that the review would refuse, such as a decimal `value`, and shows the reason.

## The simulation

Next to the gates of the contracts that the request names, the page runs the calls of a transaction in a local EVM, the one of ethereumjs, for one purpose: the call tree. Every contract whose code runs on the way joins the list of contracts, and the Sourcify gate checks each one. The EVM reads accounts, code and storage slots as it needs them, through `chain_request` in Helios mode, where each read comes with a Merkle proof against the state root of the block, or straight from the endpoint in RPC mode. `src/gates/state.ts` is that state: it reads each value once, apart from a value first read inside a call that reverted, which the cache drops with the call, at the block that the request is checked at, and keeps the writes of the EVM with the checkpoints that a reverted call undoes. An endpoint in RPC mode must serve `eth_getProof`, which some public endpoints refuse or rate limit. `src/gates/simulation.ts` runs the calls and records each message as a frame of the tree: call, staticcall, delegatecall or create, the address whose code ran, the selector, the value, and the error if the message failed. A revert is a result, not a failure of the gate: the review shows the reason. The gate fails when the chain cannot be read.

A contract that the request names must pass both gates. A contract whose code runs as a named contract, the implementation of a proxy or a facet of a diamond, must pass too: the simulation records the context of each frame, and a delegatecall keeps the context of its caller. A contract that only the simulation found may have nothing on Sourcify: the request still passes, with the status `flagged`, and the review marks that contract. A contract on the way whose sources do not match the chain fails the request, like a named one. A transaction that reverts in the simulation ends the request with the status `reverts`: it does nothing on chain, so the review says not to sign it. A transaction whose call tree was not checked, because the simulation was skipped (a contract creation, a batch without a sender) or failed (a timeout, an endpoint that did not answer), leaves the request `flagged`, and the named contracts keep their own verdicts. A signature runs nothing on chain and is not flagged for it. `runVerdict` in `src/gates/contracts.ts` is where these rules live. An account with a delegate under EIP-7702 skips the Sourcify gate, since the code of the delegate is what runs, in the context of the account: the delegate of a named account counts as named, also when the simulation did not run, and the delegate of an account on the way is one more contract on the way.

What the simulation is not: a prediction of the gas, the fees or the effects. The EVM runs the calls alone, not in a block, with the rules of the newest Ethereum hardfork on every chain, the header of the block the request is checked at, and no block hashes. The calls of a batch (`wallet_sendCalls`) run one after the other from the sender of the batch, which is how a plain account would run them, not how a smart account does. An account under EIP-7702 runs the code of its delegate, and the delegate joins the list too.

## The Solidity compiler

The Sourcify gate compiles the sources in the page, with the official emscripten build of solc for the version Sourcify names. The build comes from `binaries.soliditylang.org`, and runs only if its SHA-256 is the one in the official list, which the page fetches fresh at each session. After the check the page keeps the build in the Cache API of the webview, so the next start does not download it again, and hashes it again each time it comes out of the cache. The cache is not trusted: a build that another process planted there fails the check and is thrown out.

web-solc runs the build in a worker made from a Blob, and the worker loads the build with `importScripts` from a Blob too. The Content Security Policy in `src-tauri/tauri.conf.json` therefore allows `blob:` in `script-src` and `worker-src`, and `'wasm-unsafe-eval'` because the build is WebAssembly. This widens the policy: any script in the page that can make a Blob can run it as code, and any script can instantiate WebAssembly. It is acceptable because the only scripts in the page are the bundle itself and the compiler builds, and a build reaches a Blob only after its hash matched the list. `connect-src` allows any HTTPS host and local ports, because the RPC endpoint of a chain is the user's choice. Tauri applies the policy to the packaged app only, not to `tauri dev`, so a change to it must be checked with the bundle.

In development the page runs on `localhost`. The packaged app serves the page from Tauri's own scheme, and WebKitGTK offers the Cache API there too: the Linux bundle keeps the builds in `~/.local/share/dev.sourcify.onay/CacheStorage/`, checked on 2026-10-13. The code handles a missing cache all the same, by downloading the build at each start.
