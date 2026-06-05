// Electron shell for RaceWorld. It boots the Next.js standalone server as a child process (Electron run
// as plain Node), waits for it to listen on a free local port, then loads it in a desktop window. The
// SQLite database lives in the per-user userData directory, passed to the server via RACEWORLD_DB_DIR.
const { app, BrowserWindow, shell } = require('electron')
const { fork } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')

let serverProcess = null
let mainWindow = null

// Where the Next standalone bundle lives: shipped as an extraResource in the packaged app, or under
// .next/standalone when running unpackaged against a local build.
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
  const port = await findFreePort()
  serverProcess = fork(path.join(dir, 'server.js'), [], {
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
  serverProcess.stdout?.on('data', (d) => process.stdout.write(`[next] ${d}`))
  serverProcess.stderr?.on('data', (d) => process.stderr.write(`[next] ${d}`))

  const url = `http://127.0.0.1:${port}`
  await waitForServer(url)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0F1419',
    autoHideMenuBar: true,
    title: 'RaceWorld',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  // Open any target=_blank / external links in the system browser, not a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' } })
  await mainWindow.loadURL(url)
}

app.whenReady().then(start).catch((err) => {
  console.error('Failed to start RaceWorld:', err)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { if (serverProcess) serverProcess.kill() })
