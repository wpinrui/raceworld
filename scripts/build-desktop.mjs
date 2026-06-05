// Builds the portable Windows exe.
//  1. next build (standalone) -> .next/standalone/server.js (+ its traced node_modules)
//  2. copy static assets + public/ next to server.js (standalone doesn't include them)
//  3. give the standalone bundle a better-sqlite3 binary built for Electron's ABI (the one next traced
//     was built for system Node, which would crash under ELECTRON_RUN_AS_NODE)
//  4. electron-builder -> dist-desktop/RaceWorld-<version>-portable.exe
import { execSync } from 'node:child_process'
import { cpSync, existsSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const standalone = path.join(root, '.next', 'standalone')
const run = (cmd, opts = {}) => { console.log(`\n> ${cmd}`); execSync(cmd, { stdio: 'inherit', ...opts }) }

run('next build')

cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true })
if (existsSync(path.join(root, 'public'))) {
  cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true })
}

// File tracing can copy a dev raceworld.db into the bundle; never ship it (the app makes a fresh one in
// userData at runtime).
for (const f of ['raceworld.db', 'raceworld.db-wal', 'raceworld.db-shm']) {
  rmSync(path.join(standalone, f), { force: true })
}

// The traced better-sqlite3 binary was built for system Node and would crash under ELECTRON_RUN_AS_NODE.
// Pull better-sqlite3's published Electron prebuild straight into the standalone copy (no node-gyp / MSVC,
// and it never touches root's binary, which Windows tends to keep locked).
const electronVer = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
run(`npx --yes prebuild-install -r electron -t ${electronVer} --arch x64 --platform win32`, {
  cwd: path.join(standalone, 'node_modules', 'better-sqlite3'),
})

run('electron-builder --win portable')
console.log('\nDone. Portable exe is in dist-desktop/.')
