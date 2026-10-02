// Makes the store build: a copy of dist/ without the `key` field in the
// manifest. The Chrome Web Store rejects a manifest that has it.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

rmSync('dist-store', { recursive: true, force: true })
rmSync('onay-extension.zip', { force: true })
cpSync('dist', 'dist-store', { recursive: true })

const path = 'dist-store/manifest.json'
const manifest = JSON.parse(readFileSync(path, 'utf8'))
delete manifest.key
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
