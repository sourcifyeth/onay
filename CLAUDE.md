# Onay

A trustless smart-contract transaction builder and verifier. Read `PLAN.md` before doing anything: it is the plan of record and a living document (edit it in place; updates replace content, never append sections).

## What this repo is

A from-zero build. Every line that enters this repo is written deliberately and reviewed; no vibecoded code outside `mock/`.

## Layout

- `PLAN.md` — the plan of record.
- `mock/` — Vite + React + TypeScript playground (client-only, no SSR). The one place where vibecoding is allowed: Version 0's whole UX is mocked here with fake data, and the app takes its UI from the mock one feature at a time.
- `app/` — the Tauri app: Vite + React + TypeScript webview in `app/src/`, Rust in `app/src-tauri/`, and the native messaging relay crate in `app/relay/`. One Cargo workspace at `app/Cargo.toml`, lockfile committed.
- `extension/` — the Chrome extension (Manifest V3). Zero runtime dependencies: TypeScript compiled by `tsc` into plain ES modules in `extension/dist/`, no bundler.

## Rules

- Package manager is pnpm (workspace root). Supply-chain guardrails are non-negotiable: `minimumReleaseAge` stays in `pnpm-workspace.yaml`, lifecycle scripts stay disabled, lockfile committed. Do not add dependencies casually; prefer zero-dep solutions, especially for anything that will ship in the extension.
- UI style must match the Sourcify projects (sourcify.dev, verify.sourcify.dev, repo.sourcify.dev). The design tokens in `mock/src/index.css` (IBM Plex Sans/Mono, VT323, cerulean-blue #2b50aa, light-coral #ff858d) are copied from `~/Projects/repo.sourcify.dev/src/app/globals.css`; check that repo when in doubt about look and feel.
- The user tests interactive UIs by hand: deliver, then ask for feedback; don't click through flows with browser tooling.
- Prose style in docs: no em dashes, no hard-wrapped paragraphs (one paragraph = one line), expand acronyms on first use.

## Commands

- `pnpm install` — install everything (workspace).
- `pnpm --filter mock dev` — run the mock app (also available as the `onay-mock` launch.json preview, port 5199).
- `pnpm --filter mock build` — typecheck + build the mock.
- `pnpm --filter app tauri dev` — run the app (needs the Tauri Linux prerequisites: webkit2gtk 4.1 dev headers and friends).
- `pnpm --filter app build` — typecheck + build the app webview only.
- `pnpm --filter extension build` — build the extension into `extension/dist/`; load that folder unpacked in Chrome.
- `cargo build` in `app/` — build the Rust workspace (app and relay).
- `cargo deny check` in `app/` — advisories, licenses, sources, bans; same as CI (`cargo install --locked cargo-deny` once).
