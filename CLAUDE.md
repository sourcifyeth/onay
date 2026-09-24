# Onay

A trustless smart-contract transaction builder and verifier. Read `PLAN.md` before doing anything: it is the plan of record and a living document (edit it in place; updates replace content, never append sections).

## What this repo is

The from-zero rebuild of the vibecoded prototype at `~/Projects/project-independence`. That repo is reference-only: take inspiration from it, never copy code blindly. Every line that enters this repo is written deliberately and reviewed; no vibecoded code outside `mock/`.

## Layout

- `PLAN.md` — the plan of record. An interactive HTML version (with a UX demo) is published as a Claude artifact; its source is `~/Projects/project-independence/PLAN.html`.
- `mock/` — Vite + React + TypeScript playground (client-only, no SSR). The one place where vibecoding is allowed: Version 0's whole UX gets mocked here with fake data and iterated until Marco is satisfied, before real development starts.

## Rules

- Package manager is pnpm (workspace root). Supply-chain guardrails are non-negotiable: `minimumReleaseAge` stays in `pnpm-workspace.yaml`, lifecycle scripts stay disabled, lockfile committed. Do not add dependencies casually; prefer zero-dep solutions, especially for anything that will ship in the extension.
- UI style must match the Sourcify projects (sourcify.dev, verify.sourcify.dev, repo.sourcify.dev). The design tokens in `mock/src/index.css` (IBM Plex Sans/Mono, VT323, cerulean-blue #2b50aa, light-coral #ff858d) are copied from `~/Projects/repo.sourcify.dev/src/app/globals.css`; check that repo when in doubt about look and feel.
- Marco tests interactive UIs himself: deliver, then ask for feedback; don't click through flows with browser tooling.
- Prose style in docs: no em dashes, no hard-wrapped paragraphs (one paragraph = one line), expand acronyms on first use.

## Commands

- `pnpm install` — install everything (workspace).
- `pnpm --filter mock dev` — run the mock app (also available as the `onay-mock` launch.json preview, port 5199).
- `pnpm --filter mock build` — typecheck + build the mock.
