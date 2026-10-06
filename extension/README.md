# The Onay extension

A Manifest V3 Chrome extension with no runtime dependencies. It watches the wallet providers on each page and sends a copy of every signing request to the Onay app. The wallet gets the request unchanged and at the same time. The extension never holds keys and never changes a request.

## The parts

```mermaid
flowchart LR
  subgraph page [Web page]
    dapp[dapp code]
    wallet[wallet provider]
    inpage[inpage.ts]
  end
  content[content.ts]
  subgraph sw [Service worker]
    background[background.ts]
    link[link.ts]
    channel[channel.ts]
    store[(store.ts)]
  end
  popup[popup.ts]
  app[Onay app]

  dapp -- request --> wallet
  inpage -. watches .- wallet
  inpage -- postMessage --> content
  content -- sendMessage --> background
  background --> link
  link --> channel
  link --> store
  popup <-- port --> background
  link -- native messaging --> app
```

| File                         | Runs in                          | Does                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/inpage.ts`              | the page, before its own scripts | Replaces `request`, `sendAsync`, and `send` on each wallet provider it finds on `window.ethereum` or through EIP-6963. Reports signing requests and how the wallet answered. Passes everything else through untouched. |
| `src/content.ts`             | isolated world of the page       | Passes the reports of `inpage.ts` to the service worker. A page script cannot call the extension, so this is the bridge.                                                                                               |
| `src/background.ts`          | service worker                   | Checks each report, adds the origin from the browser, and sends it to the app. Keeps requests that wait for the app. Opens the status window when the user must act.                                                   |
| `src/link.ts`                | service worker                   | The connection to the app: hello exchange, pairing, sealed messages, and the status of the link. No browser calls of its own, so the tests run it with fakes.                                                          |
| `src/channel.ts`             | service worker                   | The encrypted channel: X25519 key agreement, HKDF-SHA-256, AES-256-GCM with counter nonces. Same specification as `app/src-tauri/src/channel.rs`.                                                                      |
| `src/store.ts`               | service worker                   | IndexedDB: the extension's own key pair, which no script can export, and the public key of the paired app.                                                                                                             |
| `src/popup.ts`, `popup.html` | toolbar popup and status window  | Shows the state of the link and the pairing code. Retries while the app is not there.                                                                                                                                  |
| `src/messages.ts`            | compile time only                | Every message type between the parts above and between extension and app.                                                                                                                                              |
| `manifest.json`              |                                  | Permissions, content scripts, the `key` that fixes the extension ID.                                                                                                                                                   |

`inpage.ts` and `content.ts` are plain scripts, not modules. The others are ES modules. The page can see and change everything in `inpage.ts`, so nothing there is a security boundary.

## One request, step by step

1. The dapp calls `provider.request({ method: "eth_sendTransaction", ... })`.
2. `inpage.ts` posts a copy to the window, then calls the wallet's original method with the same arguments. The wallet opens.
3. `content.ts` forwards the copy to the service worker.
4. `background.ts` checks the method and the size, sets the origin, and hands the request to `link.ts`.
5. `link.ts` seals it with the session key and sends it to the app through the relay. If the app is not there, the request waits and the status window asks the user to start the app.
6. When the wallet answers the dapp, `inpage.ts` reports the outcome the same way.

## The link to the app

1. On start, `link.ts` connects to the native messaging host `dev.sourcify.onay`. Chrome starts the relay, and the relay connects to the app.
2. Both sides send a hello in the clear: public key and a random salt. Both derive the session keys.
3. If the app does not know this extension, both sides show a six-digit pairing code. The user compares them and approves in the app.
4. From then on every message is sealed. A lost, repeated, or reordered message ends the connection.

## Build and test

```
pnpm build      # dist/: load it unpacked in Chrome
pnpm test       # build, type-check, and run the tests with node --test
pnpm package    # onay-extension.zip for the Chrome Web Store
```

The tests in `test/` run the channel against the shared vectors in `../testdata/`, the link against a fake app, and the built `dist/inpage.js` inside a fake page.
