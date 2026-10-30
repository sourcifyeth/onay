import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeHtml,
  fillPage,
  formatDate,
  formatSize,
  fromGitHub,
  packageOf,
  parseReleases,
  type Release,
} from '../src/releases.ts'

const DOWNLOAD = 'https://github.com/sourcifyeth/onay/releases/download/'
const TAG = 'https://github.com/sourcifyeth/onay/releases/tag/'

// The releases that fromGitHub gives for 0.1.0, plus an older release.
function fixture(): Release[] {
  return [
    {
      tag: '0.1.0',
      url: 'https://github.com/sourcifyeth/onay/releases/tag/0.1.0',
      publishedAt: '2026-10-27T14:44:12Z',
      assets: [
        { name: 'Onay-0.1.0-1.x86_64.rpm', url: `${DOWNLOAD}0.1.0/Onay-0.1.0-1.x86_64.rpm`, size: 13583508 },
        { name: 'Onay_0.1.0_aarch64.dmg', url: `${DOWNLOAD}0.1.0/Onay_0.1.0_aarch64.dmg`, size: 11256462 },
        { name: 'Onay_0.1.0_amd64.deb', url: `${DOWNLOAD}0.1.0/Onay_0.1.0_amd64.deb`, size: 13583226 },
        { name: 'SHA256SUMS', url: `${DOWNLOAD}0.1.0/SHA256SUMS`, size: 266 },
      ],
    },
    {
      tag: '0.0.9',
      url: 'https://github.com/sourcifyeth/onay/releases/tag/0.0.9',
      publishedAt: '2026-09-01T08:00:00Z',
      assets: [{ name: 'Onay_0.0.9_amd64.deb', url: `${DOWNLOAD}0.0.9/Onay_0.0.9_amd64.deb`, size: 13000000 }],
    },
  ]
}

// A page with every placeholder, in the order the test reads them back.
const PAGE = `<p><!-- @version --> · <!-- @date --></p>
<!-- @row dmg-arm64 --><b>Apple Silicon</b><!-- @end -->
<!-- @row deb-x64 --><b>Debian, Ubuntu</b><!-- @end -->
<!-- @row rpm-x64 --><b>Fedora, openSUSE</b><!-- @end -->
<p><!-- @links --></p>`

function links(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!)
}

// One release as the GitHub API gives it, with the fields that fromGitHub reads.
function gitHubRelease(tag: string, publishedAt: string, flags = { draft: false, prerelease: false }) {
  const name = `Onay_${tag}_amd64.deb`
  return {
    tag_name: tag,
    html_url: `${TAG}${tag}`,
    published_at: publishedAt,
    ...flags,
    body: 'notes',
    assets: [{ name, browser_download_url: `${DOWNLOAD}${tag}/${name}`, size: 100, download_count: 7 }],
  }
}

test('fromGitHub keeps the published releases, newest first', () => {
  const releases = fromGitHub([
    gitHubRelease('0.0.9', '2026-09-01T08:00:00Z'),
    gitHubRelease('0.2.0', '2026-11-02T08:00:00Z', { draft: true, prerelease: false }),
    gitHubRelease('0.1.0', '2026-10-27T14:44:12Z'),
    gitHubRelease('0.1.1-rc.1', '2026-10-30T08:00:00Z', { draft: false, prerelease: true }),
  ])
  assert.deepEqual(
    releases.map((release) => release.tag),
    ['0.1.0', '0.0.9'],
  )
  assert.deepEqual(releases[0], {
    tag: '0.1.0',
    url: `${TAG}0.1.0`,
    publishedAt: '2026-10-27T14:44:12Z',
    assets: [{ name: 'Onay_0.1.0_amd64.deb', url: `${DOWNLOAD}0.1.0/Onay_0.1.0_amd64.deb`, size: 100 }],
  })
})

test('fromGitHub refuses a wrong shape', () => {
  assert.throws(() => fromGitHub({ message: 'Not Found' }), /not an array/)
  assert.throws(() => fromGitHub([null]), /GitHub\[0\]: not an object/)
  const { draft: _, ...noFlag } = gitHubRelease('0.1.0', '2026-10-27T14:44:12Z')
  assert.throws(() => fromGitHub([noFlag]), /draft or prerelease/)
  assert.throws(() => fromGitHub([{ ...gitHubRelease('0.1.0', '2026-10-27T14:44:12Z'), html_url: 1 }]), /\.url/)
})

test('parseReleases accepts its own output', () => {
  assert.deepEqual(parseReleases(JSON.parse(JSON.stringify(fixture()))), fixture())
})

test('parseReleases refuses a link outside the repo', () => {
  const release = fixture()
  release[0]!.url = 'https://evil.example/releases/tag/0.1.0'
  assert.throws(() => parseReleases(release), /releases\[0\]\.url/)
  const asset = fixture()
  asset[0]!.assets[1]!.url = 'https://github.com/someone/else/releases/download/x.dmg'
  assert.throws(() => parseReleases(asset), /releases\[0\]\.assets\[1\]\.url/)
})

test('parseReleases refuses a link that leaves the repo through dot segments', () => {
  for (const url of [
    `${DOWNLOAD}../../../../evil/repo/releases/download/x/Onay_9_aarch64.dmg`,
    `${DOWNLOAD}%2e%2e/%2e%2e/x.dmg`,
  ]) {
    const release = fixture()
    release[0]!.assets[1]!.url = url
    assert.throws(() => parseReleases(release), /releases\[0\]\.assets\[1\]\.url/)
  }
  const release = fixture()
  release[0]!.url = `${TAG}../../../../evil/repo`
  assert.throws(() => parseReleases(release), /releases\[0\]\.url/)
})

test('parseReleases refuses a wrong shape', () => {
  assert.throws(() => parseReleases({}), /not an array/)
  assert.throws(() => parseReleases([null]), /releases\[0\]: not an object/)
  assert.throws(() => parseReleases([{ ...fixture()[0], publishedAt: 'yesterday' }]), /publishedAt/)
  assert.throws(
    () => parseReleases([{ ...fixture()[0], assets: [{ name: 'x', url: `${DOWNLOAD}x`, size: -1 }] }]),
    /size/,
  )
})

test('packageOf knows the packages of a release', () => {
  assert.equal(packageOf('Onay_0.1.0_aarch64.dmg'), 'dmg-arm64')
  assert.equal(packageOf('Onay_0.1.0_amd64.deb'), 'deb-x64')
  assert.equal(packageOf('Onay-0.1.0-1.x86_64.rpm'), 'rpm-x64')
  assert.equal(packageOf('Onay_0.2.0_x64.dmg'), null)
  assert.equal(packageOf('SHA256SUMS'), null)
})

test('formatDate gives the day in UTC', () => {
  assert.equal(formatDate('2026-10-27T14:44:12Z'), '27 October 2026')
  assert.equal(formatDate('2026-10-27T23:59:59-05:00'), '28 October 2026')
})

test('formatSize', () => {
  assert.equal(formatSize(266), '266 B')
  assert.equal(formatSize(11256462), '11.3 MB')
})

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})

test('fillPage shows the newest release with a link for each package', () => {
  const html = fillPage(PAGE, fixture())
  assert.doesNotMatch(html, /<!-- @/)
  assert.match(html, /Version 0\.1\.0 · 27 October 2026/)
  assert.doesNotMatch(html, /0\.0\.9/)
  assert.deepEqual(links(html), [
    `${DOWNLOAD}0.1.0/Onay_0.1.0_aarch64.dmg`,
    `${DOWNLOAD}0.1.0/Onay_0.1.0_amd64.deb`,
    `${DOWNLOAD}0.1.0/Onay-0.1.0-1.x86_64.rpm`,
    `${TAG}0.1.0`,
    `${DOWNLOAD}0.1.0/SHA256SUMS`,
  ])
  assert.match(html, /<b>Apple Silicon<\/b>.*\.dmg.*11\.3 MB/s)
})

test('fillPage marks a package that the release does not have', () => {
  const release = fixture()
  release[0]!.assets = release[0]!.assets.filter((asset) => !asset.name.endsWith('.rpm'))
  const html = fillPage(PAGE, release)
  assert.match(html, /<b>Fedora, openSUSE<\/b><span[^>]*>Not in this release/)
  assert.equal(links(html).length, 4)
})

test('fillPage links the release notes without checksums when the release has none', () => {
  const release = fixture()
  release[0]!.assets = release[0]!.assets.filter((asset) => asset.name !== 'SHA256SUMS')
  const html = fillPage(PAGE, release)
  assert.match(html, /Release notes/)
  assert.doesNotMatch(html, /SHA256SUMS/)
})

test('fillPage without a release', () => {
  const html = fillPage(PAGE, [])
  assert.match(html, /No release yet/)
  assert.equal(links(html).length, 0)
})

test('fillPage escapes the data and keeps a $ as it is', () => {
  const release = fixture()
  release[0]!.tag = "<b>$&$'</b>"
  const html = fillPage(PAGE, release)
  assert.match(html, /Version &lt;b&gt;\$&amp;\$&#39;&lt;\/b&gt;/)
})

test('fillPage fails on a missing or unknown placeholder', () => {
  assert.throws(() => fillPage(PAGE.replace('<!-- @date -->', ''), fixture()), /no <!-- @date -->/)
  assert.throws(
    () => fillPage(PAGE.replace(/<!-- @row rpm-x64 -->.*?<!-- @end -->/, ''), fixture()),
    /no row for rpm-x64/,
  )
  assert.throws(() => fillPage(`${PAGE}<!-- @row exe-x64 -->x<!-- @end -->`, fixture()), /unknown package exe-x64/)
})
