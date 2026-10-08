// The request IDs that the service worker forwarded, per document. A page
// controls its own IDs, so a repeated ID is dropped here and never reaches
// the app. An outcome is forwarded only for a request that was forwarded.
// No browser calls, so the tests run it as it is.

export class Inbox {
  // In insertion order, so the oldest document goes first when full.
  #documents = new Map<string, Set<string>>()
  #count = 0
  #limit: number

  // `limit` is the number of IDs kept in total, over all documents.
  constructor(limit = 2000) {
    this.#limit = limit
  }

  // True once for each ID of a document.
  accept(document: string, id: string): boolean {
    let ids = this.#documents.get(document)
    if (!ids) {
      ids = new Set()
      this.#documents.set(document, ids)
    }
    if (ids.has(id)) return false
    ids.add(id)
    this.#count += 1
    // One document alone: its oldest ID goes first.
    if (ids.size > this.#limit) {
      const oldest = ids.values().next().value
      if (oldest !== undefined) ids.delete(oldest)
      this.#count -= 1
    }
    this.#shrink(document)
    return true
  }

  // True if the request with this ID was forwarded.
  known(document: string, id: string): boolean {
    return this.#documents.get(document)?.has(id) ?? false
  }

  documents(): string[] {
    return [...this.#documents.keys()]
  }

  // The document is gone, for example because its tab closed.
  forget(document: string): void {
    const ids = this.#documents.get(document)
    if (!ids) return
    this.#count -= ids.size
    this.#documents.delete(document)
  }

  // Drops other documents, oldest first, until the limit holds.
  #shrink(keep: string): void {
    for (const [document, ids] of this.#documents) {
      if (this.#count <= this.#limit) return
      if (document === keep) continue
      this.#count -= ids.size
      this.#documents.delete(document)
    }
  }
}
