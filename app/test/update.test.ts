import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  fetchLatestVersion,
  latestAppVersion,
  MAX_BYTES,
  parseVersion,
  releaseStatus,
  RELEASES_API,
} from '../src/update.ts'

const release = (tag_name: string, flags: { draft?: boolean; prerelease?: boolean } = {}) => ({
  tag_name,
  draft: false,
  prerelease: false,
  ...flags,
})

test('parseVersion reads major.minor.patch only', () => {
  assert.deepEqual(parseVersion('0.10.2'), { major: 0, minor: 10, patch: 2 })
  assert.equal(parseVersion('v0.1.0'), null)
  assert.equal(parseVersion('extension-0.1.1'), null)
  assert.equal(parseVersion('0.1.0-rc.1'), null)
  assert.equal(parseVersion('0.1'), null)
})

test('latestAppVersion takes the highest published app tag', () => {
  const releases = [
    release('extension-0.9.0'),
    release('0.2.0'),
    release('0.10.0'),
    release('0.11.0', { draft: true }),
    release('0.12.0', { prerelease: true }),
    release('0.9.0'),
    { tag_name: '0.13.0' },
    null,
  ]
  assert.equal(latestAppVersion(releases), '0.10.0')
  assert.equal(latestAppVersion([release('extension-0.1.1')]), null)
  assert.equal(latestAppVersion([]), null)
  assert.throws(() => latestAppVersion({ message: 'API rate limit exceeded' }), /not a list/)
})

test('releaseStatus compares the numbers, not the text', () => {
  assert.equal(releaseStatus('0.9.0', '0.10.0'), 'newer')
  assert.equal(releaseStatus('0.1.0', '1.0.0'), 'newer')
  assert.equal(releaseStatus('0.10.0', '0.10.0'), 'latest')
  // A development build above every release.
  assert.equal(releaseStatus('0.10.0', '0.9.0'), 'ahead')
  assert.equal(releaseStatus('0.1.0', null), 'none')
})

test('fetchLatestVersion asks GitHub for 100 releases and returns the highest app version', async () => {
  let asked = ''
  const fetch = async (url: string) => {
    asked = url
    return Response.json([release('extension-0.3.0'), release('0.2.0'), release('0.1.0')])
  }
  assert.equal(await fetchLatestVersion(fetch), '0.2.0')
  assert.equal(asked, RELEASES_API)
  assert.match(asked, /per_page=100$/)
  assert.equal(await fetchLatestVersion(async () => Response.json([])), null)
})

test('fetchLatestVersion refuses an error, a non-JSON body, or an oversized one', async () => {
  await assert.rejects(
    fetchLatestVersion(async () => new Response('', { status: 403 })),
    /HTTP 403/,
  )
  await assert.rejects(
    fetchLatestVersion(async () => new Response('<html>')),
    /not JSON/,
  )
  const big = async () => new Response('[' + ' '.repeat(MAX_BYTES) + ']')
  await assert.rejects(fetchLatestVersion(big), /over 2 MB/)
})
