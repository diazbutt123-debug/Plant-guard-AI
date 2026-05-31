
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess = null;

function getAppDir() {
  return app.isPackaged
    ? path.dirname(app.getPath('exe'))  
    : __dirname;                          
}

function startPythonServer() {
  const appDir = getAppDir();

  const isPackaged = app.isPackaged;
  const pythonExe = isPackaged
    ? path.join(process.resourcesPath, 'server', 'predict_server.exe')
    : path.join(appDir, 'server', 'predict_server.py');

  const serverCwd = isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(appDir, 'server');

  if (!fs.existsSync(pythonExe)) {
    console.log('[PlantGuard] Server not found at:', pythonExe);
    console.log('[PlantGuard] Tip: In dev mode, run predict_server.py manually,');
    console.log('[PlantGuard]      or place it in ./server/predict_server.py');
    return;
  }

  const args = isPackaged ? [] : [pythonExe];
  const cmd  = isPackaged
    ? pythonExe
    : path.join(__dirname, 'venv', 'Scripts', 'python.exe');

  pythonProcess = spawn(cmd, args, {
    cwd:         serverCwd,
    windowsHide: true,
    stdio:       ['ignore', 'pipe', 'pipe']
  });

  pythonProcess.stdout.on('data', d => console.log('[AI Server]', d.toString().trim()));
  pythonProcess.stderr.on('data', d => console.log('[AI Server]', d.toString().trim()));
  pythonProcess.on('close', code => {
    console.log('[AI Server] Closed with code:', code);
    pythonProcess = null;
  });
  pythonProcess.on('error', err => {
    console.log('[AI Server] Error:', err.message);
    pythonProcess = null;
  });

  console.log('[AI Server] Started. PID:', pythonProcess.pid);
}

function stopPythonServer() {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    setTimeout(() => {
      if (pythonProcess) {
        pythonProcess.kill('SIGKILL');
        pythonProcess = null;
      }
    }, 3000);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1200,
    height:          800,
    minWidth:        900,
    minHeight:       600,
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => { mainWindow = null; });
}

const http = require('http');

function waitForServer(retries = 30) {
  http.get('http://127.0.0.1:5000/health', (res) => {
    createWindow();
  }).on('error', () => {
    if (retries <= 0) { createWindow(); return; }
    setTimeout(() => waitForServer(retries - 1), 1000);
  });
}

app.whenReady().then(() => {
  startPythonServer();
  waitForServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit',      stopPythonServer);
app.on('window-all-closed', () => {
  stopPythonServer();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('open-image-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:   'Select Plant Image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const fp   = result.filePaths[0];
    const data = fs.readFileSync(fp);
    const ext  = path.extname(fp).slice(1).toLowerCase();
    return {
      filePath: fp,
      base64:   data.toString('base64'),
      mime:     ext === 'png' ? 'image/png' : 'image/jpeg',
      name:     path.basename(fp)
    };
  }
  return null;
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Select Folder with Plant Images',
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    return fs.readdirSync(folderPath)
      .filter(f => ['.jpg', '.jpeg', '.png', '.webp']
        .includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fp   = path.join(folderPath, f);
        const data = fs.readFileSync(fp);
        const ext  = path.extname(f).slice(1).toLowerCase();
        return {
          filePath: fp,
          base64:   data.toString('base64'),
          mime:     ext === 'png' ? 'image/png' : 'image/jpeg',
          name:     f
        };
      });
  }
  return [];
});

ipcMain.handle('save-history', async (event, history) => {
  const dest = path.join(app.getPath('userData'), 'scan_history.json');
  fs.writeFileSync(dest, JSON.stringify(history, null, 2));
  return true;
});

ipcMain.handle('load-history', async () => {
  const p = path.join(app.getPath('userData'), 'scan_history.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { return []; }
  }
  return [];
});

ipcMain.handle('get-server-status', () => ({
  running: pythonProcess !== null && !pythonProcess.killed
}));

ipcMain.handle('restart-server', () => {
  stopPythonServer();
  setTimeout(startPythonServer, 1500);
  return true;
});