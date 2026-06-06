// Electron shell for RaceWorld. It boots the Next.js standalone server as a child process (Electron run
// as plain Node), waits for it to listen on a free local port, then loads it in a desktop window. The
// SQLite database lives in the per-user userData directory, passed to the server via RACEWORLD_DB_DIR.
const { app, BrowserWindow, shell } = require('electron')
const { fork } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')

let serverProcess = null
let mainWindow = null
let logFile = null

// File logging: a packaged GUI app has no attached console, so on a silent failure there is nothing to
// see. Everything goes to <userData>/launch.log so we can read why it died.
function log(...args) {
  const line = `[${new Date().toISOString()}] ` + args
    .map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ') + '\n'
  try { if (logFile) fs.appendFileSync(logFile, line) } catch { /* ignore */ }
  try { process.stdout.write(line) } catch { /* ignore */ }
}

process.on('uncaughtException', (e) => log('uncaughtException', e))
process.on('unhandledRejection', (e) => log('unhandledRejection', e))

function standaloneDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'standalone')
    : path.join(__dirname, '..', '.next', 'standalone')
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(url, (res) => { res.resume(); resolve() })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('Next server did not start in time'))
        else setTimeout(ping, 200)
      })
    }
    ping()
  })
}

async function start() {
  const dir = standaloneDir()
  const serverJs = path.join(dir, 'server.js')
  log('start: isPackaged', app.isPackaged, 'execPath', process.execPath)
  log('resourcesPath', process.resourcesPath)
  log('standaloneDir', dir, 'server.js exists', fs.existsSync(serverJs))

  const port = await findFreePort()
  log('free port', port)

  serverProcess = fork(serverJs, [], {
    cwd: dir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      RACEWORLD_DB_DIR: app.getPath('userData'),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  serverProcess.stdout?.on('data', (d) => log('[next]', d.toString().trim()))
  serverProcess.stderr?.on('data', (d) => log('[next:err]', d.toString().trim()))
  serverProcess.on('error', (e) => log('server spawn error', e))
  serverProcess.on('exit', (code, sig) => log('server exited code', code, 'signal', sig))

  const url = `http://127.0.0.1:${port}`
  await waitForServer(url)
  log('server ready at', url)

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'racing-car.png')
    : path.join(__dirname, '..', 'racing-car.png')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    fullscreen: true, // immersive fullscreen; F11 toggles out (handler below)
    backgroundColor: '#0F1419',
    autoHideMenuBar: true,
    title: 'RaceWorld',
    icon: iconPath,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  // F11 toggles fullscreen so the player is never trapped without window controls.
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load', code, desc))
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' } })
  log('window created, loading', url)
  await mainWindow.loadURL(url)
  log('loadURL resolved')
}

app.whenReady()
  .then(() => {
    logFile = path.join(app.getPath('userData'), 'launch.log')
    try { fs.writeFileSync(logFile, '') } catch { /* ignore */ }
    log('app ready; logging to', logFile)
    return start()
  })
  .catch((err) => log('FATAL during start', err))

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { if (serverProcess) serverProcess.kill() })
