// Pure functions that check the release data from GitHub and fill the page with it.
// The build runs them once. The page has no script at view time.

export type Asset = { name: string; url: string; size: number }
export type Release = { tag: string; url: string; publishedAt: string; assets: Asset[] }

const RELEASE_URL = 'https://github.com/sourcifyeth/onay/releases/tag/'
const DOWNLOAD_URL = 'https://github.com/sourcifyeth/onay/releases/download/'

// The data comes from outside the repo. Accept only the expected shape and links to our repo.
export function parseReleases(data: unknown): Release[] {
  if (!Array.isArray(data)) throw new Error('releases: not an array')
  return data.map((item: unknown, index): Release => {
    const where = `releases[${index}]`
    if (!isObject(item)) throw new Error(`${where}: not an object`)
    const { tag, url, publishedAt, assets } = item
    if (typeof tag !== 'string' || tag === '') throw new Error(`${where}.tag: not a string`)
    if (typeof url !== 'string' || !url.startsWith(RELEASE_URL)) throw new Error(`${where}.url: not ${RELEASE_URL}...`)
    if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) {
      throw new Error(`${where}.publishedAt: not a date`)
    }
    if (!Array.isArray(assets)) throw new Error(`${where}.assets: not an array`)
    return {
      tag,
      url,
      publishedAt,
      assets: assets.map((asset: unknown, i): Asset => {
        const at = `${where}.assets[${i}]`
        if (!isObject(asset)) throw new Error(`${at}: not an object`)
        const { name, url, size } = asset
        if (typeof name !== 'string' || name === '') throw new Error(`${at}.name: not a string`)
        if (typeof url !== 'string' || !url.startsWith(DOWNLOAD_URL))
          throw new Error(`${at}.url: not ${DOWNLOAD_URL}...`)
        if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) throw new Error(`${at}.size: not a size`)
        return { name, url, size }
      }),
    }
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// The package kinds that the page offers, such as 'dmg-arm64'.
export const PACKAGES = ['dmg-arm64', 'deb-x64', 'rpm-x64'] as const
export type Package = (typeof PACKAGES)[number]

// The package kind of a release file from its name, or null for any other file.
export function packageOf(name: string): Package | null {
  const extension = /\.(dmg|deb|rpm)$/.exec(name)?.[1]
  const arch = /aarch64|arm64/.test(name) ? 'arm64' : /amd64|x86_64|x64/.test(name) ? 'x64' : null
  const kind = `${extension}-${arch}`
  return (PACKAGES as readonly string[]).includes(kind) ? (kind as Package) : null
}

export function formatDate(iso: string): string {
  const format = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return format.format(new Date(iso))
}

export function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const ROW = 'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3'
const DOWNLOAD_ICON =
  '<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v9M4 7.5 8 11.5 12 7.5M3 14h10"/></svg>'

// A download row: the label from the page, and a button for the file of the newest release.
export function renderRow(pkg: Package, label: string, asset: Asset | undefined): string {
  if (!asset) {
    return `<div class="${ROW} border-line-soft opacity-60">${label}<span class="shrink-0 text-xs text-muted">Not in this release</span></div>`
  }
  const extension = pkg.split('-')[0]
  return `<a class="group ${ROW} border-line transition hover:border-azure-300 hover:bg-azure-50/60" href="${escapeHtml(asset.url)}" title="${escapeHtml(asset.name)}">${label}<span class="inline-flex shrink-0 items-center gap-2 rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white transition group-hover:bg-navy-600">${DOWNLOAD_ICON}.${extension}<span class="text-xs font-normal text-white/60">${formatSize(asset.size)}</span></span></a>`
}

const ROW_BLOCK = /<!-- @row ([\w-]+) -->([\s\S]*?)<!-- @end -->/g

// Fills the placeholders of index.html. A missing or unknown placeholder fails the build.
export function fillPage(html: string, releases: Release[]): string {
  const latest = releases[0]
  const assets = latest?.assets ?? []
  const values: Record<string, string> = {
    '<!-- @version -->': latest ? `Version ${escapeHtml(latest.tag)}` : 'No release yet',
    '<!-- @date -->': latest ? formatDate(latest.publishedAt) : '',
  }
  for (const placeholder of Object.keys(values)) {
    if (!html.includes(placeholder)) throw new Error(`index.html: no ${placeholder}`)
  }
  const seen = new Set<string>()
  let page = html.replace(ROW_BLOCK, (_, pkg: string, label: string) => {
    if (!(PACKAGES as readonly string[]).includes(pkg)) throw new Error(`index.html: unknown package ${pkg}`)
    seen.add(pkg)
    const asset = assets.find((asset) => packageOf(asset.name) === pkg)
    return renderRow(pkg as Package, label.trim(), asset)
  })
  for (const pkg of PACKAGES) {
    if (!seen.has(pkg)) throw new Error(`index.html: no row for ${pkg}`)
  }
  for (const [placeholder, value] of Object.entries(values)) {
    page = page.replace(placeholder, () => value)
  }
  return page
}
