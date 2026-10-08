// The signing requests that the wallet has not answered yet. They drive the
// badge on the extension icon and the window that tells the user to check
// the app. No browser calls, so the tests run it as it is.

export type PendingRequest = { origin: string; method: string; at: number }

// A request the wallet never answers must not stay forever.
const MAX_AGE_MS = 10 * 60 * 1000

export class Pending {
  #entries = new Map<string, PendingRequest & { shown: boolean }>()

  add(id: string, request: PendingRequest): void {
    this.#prune(request.at)
    this.#entries.set(id, { ...request, shown: false })
  }

  // The wallet answered. Returns the request, if it was pending.
  settle(id: string): PendingRequest | undefined {
    const entry = this.#entries.get(id)
    this.#entries.delete(id)
    return entry
  }

  count(now = Date.now()): number {
    this.#prune(now)
    return this.#entries.size
  }

  // The newest request, for the window.
  latest(now = Date.now()): PendingRequest | undefined {
    this.#prune(now)
    let newest: PendingRequest | undefined
    for (const entry of this.#entries.values()) {
      if (!newest || entry.at >= newest.at) newest = entry
    }
    return newest
  }

  // True if a request arrived that the window did not show yet.
  unshown(now = Date.now()): boolean {
    this.#prune(now)
    for (const entry of this.#entries.values()) if (!entry.shown) return true
    return false
  }

  markShown(): void {
    for (const entry of this.#entries.values()) entry.shown = true
  }

  #prune(now: number): void {
    for (const [id, entry] of this.#entries) {
      if (now - entry.at > MAX_AGE_MS) this.#entries.delete(id)
    }
  }
}
