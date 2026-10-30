// Writes releases.json: the answer of the GitHub API, as it is. fromGitHub in src/releases.ts reads it.
// The build fails when GitHub does not answer: an empty page must not go live.
// GITHUB_TOKEN is optional. It lifts the API limit for shared build machines.
import { writeFileSync } from 'node:fs'

const API = 'https://api.github.com/repos/sourcifyeth/onay/releases?per_page=100'
const OUT = new URL('./releases.json', import.meta.url)

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'onay-site',
}
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const response = await fetch(API, { headers })
if (!response.ok) {
  console.error(`GitHub API: ${response.status} ${response.statusText}`)
  console.error(`rate limit remaining: ${response.headers.get('x-ratelimit-remaining')}`)
  console.error(`rate limit reset: ${response.headers.get('x-ratelimit-reset')}`)
  console.error(await response.text())
  process.exit(1)
}

const releases = await response.json()
writeFileSync(OUT, JSON.stringify(releases, null, 2) + '\n')
console.log(`releases.json: ${Array.isArray(releases) ? releases.length : 0} releases`)
