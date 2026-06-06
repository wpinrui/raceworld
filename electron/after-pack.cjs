// electron-builder strips node_modules (and dot-folders) from `extraResources`, which would leave the
// Next standalone server without its `next`/`react`/`better-sqlite3` deps. Copy the whole standalone
// bundle ourselves, verbatim, after the app dir is packed and before the portable artifact is zipped.
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, '.next', 'standalone')
  const dest = path.join(context.appOutDir, 'resources', 'standalone')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[afterPack] copied standalone server -> ${dest}`)
}
