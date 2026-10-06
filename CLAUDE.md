# Onay

A local signing companion: a desktop app with a thin browser extension that gives every transaction a second, independent check before the wallet signs. It is view only and holds no keys. Read `PLAN.md` before doing anything: it is the plan of record and a living document (edit it in place; updates replace content, never append sections).

## What this repo is

A from-zero build. Every line that enters this repo is written deliberately and reviewed; no vibecoded code outside `mock/`.

## Layout

- `PLAN.md` — the plan of record.
- `README.md` — how to run and build everything, for development and production. Keep it current when commands change.
- `mock/` — Vite + React + TypeScript playground (client-only, no SSR). The one place where vibecoding is allowed: Version 0's whole UX is mocked here with fake data, and the app takes its UI from the mock one feature at a time.
- `app/` — the Tauri app: Vite + React + TypeScript webview in `app/src/`, Rust in `app/src-tauri/`, and the native messaging relay crate in `app/relay/`. One Cargo workspace at `app/Cargo.toml`, lockfile committed.
- `extension/` — the Chrome extension (Manifest V3). Zero runtime dependencies: TypeScript compiled by `tsc` into plain ES modules in `extension/dist/`, no bundler. `inpage.ts` and `content.ts` are plain scripts, not modules: no imports or exports, types through `import('./messages.ts')`.
- `testdata/` — test vectors that the Rust and the TypeScript implementation of the encrypted channel must both match.
- `extension/key.pem` (gitignored) is the private key behind the `key` field in `extension/manifest.json`. It fixes the extension ID to `jhopbgoicoiceialjejgojebmeijklbn`, which the app's host manifest allowlists. Back it up; never commit it.

## Rules

- Package manager is pnpm (workspace root). Supply-chain guardrails are non-negotiable: `minimumReleaseAge` stays in `pnpm-workspace.yaml`, lifecycle scripts stay disabled, lockfile committed. Do not add dependencies casually; prefer zero-dep solutions, especially for anything that will ship in the extension.
- UI style must match the Sourcify projects (sourcify.dev, verify.sourcify.dev, repo.sourcify.dev). The design tokens in `mock/src/index.css` (IBM Plex Sans/Mono, VT323, cerulean-blue #2b50aa, light-coral #ff858d) are copied from `~/Projects/repo.sourcify.dev/src/app/globals.css`; check that repo when in doubt about look and feel.
- Messages that cross a layer boundary (popup, service worker, page script, relay, app, webview) get explicit TypeScript types in one shared file per package, such as `extension/src/messages.ts`, imported with `import type` on both sides. Where the other side is Rust, the type names the Rust struct it mirrors. Types are not validation: check at runtime whatever comes from an untrusted sender.
- Write a comment only when it is necessary. Keep each comment short.
- Write each comment in ASD-STE100 Simplified Technical English: short sentences, active voice, simple tenses, and one topic for each sentence.
- The user tests interactive UIs by hand: deliver, then ask for feedback; don't click through flows with browser tooling.
- Prose style in docs: no em dashes, no hard-wrapped paragraphs (one paragraph = one line), expand acronyms on first use.

## Commands

- `pnpm install` — install everything (workspace).
- `pnpm --filter mock dev` — run the mock app (also available as the `onay-mock` launch.json preview, port 5199).
- `pnpm --filter mock build` — typecheck + build the mock.
- `pnpm --filter app tauri dev` — run the app (needs the Tauri Linux prerequisites: webkit2gtk 4.1 dev headers and friends).
- `pnpm --filter app build` — typecheck + build the app webview only.
- `pnpm --filter extension build` — build the extension into `extension/dist/`; load that folder unpacked in Chrome (its ID must match the one above).
- `pnpm --filter app bundle` — production package of the app with the relay inside (`app/target/release/bundle/`). Bundle settings live in `app/src-tauri/tauri.bundle.conf.json`, kept out of the main config so `tauri dev` needs no packaged relay.
- `pnpm --filter extension package` — store zip of the extension (`extension/onay-extension.zip`), without the `key` field.
- `pnpm --filter extension test` — build, type-check the tests, and run them with `node --test`.
- `cargo build` in `app/` — build the Rust workspace (app and relay).
- `cargo test` in `app/` — run the Rust tests.
- `cargo deny check` in `app/` — advisories, licenses, sources, bans; same as CI (`cargo install --locked cargo-deny` once).
