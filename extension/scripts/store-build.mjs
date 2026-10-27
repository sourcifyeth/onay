// Makes the store build: a copy of dist/ without the `key` field in the
// manifest. The Chrome Web Store rejects a manifest that has it.
// With SOURCE_DATE_EPOCH set, every file gets that modification time, so
// that the zip is the same byte for byte on each build of one commit.
import { cpSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'

rmSync('dist-store', { recursive: true, force: true })
rmSync('onay-extension.zip', { force: true })
cpSync('dist', 'dist-store', { recursive: true })

const path = 'dist-store/manifest.json'
const manifest = JSON.parse(readFileSync(path, 'utf8'))
delete manifest.key
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')

const epoch = process.env.SOURCE_DATE_EPOCH
if (epoch) {
  const time = new Date(Number(epoch) * 1000)
  for (const entry of readdirSync('dist-store', { recursive: true, withFileTypes: true })) {
    utimesSync(`${entry.parentPath}/${entry.name}`, time, time)
  }
  utimesSync('dist-store', time, time)
}
