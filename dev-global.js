/**
 * dev-global.js  —  Vanya Gaming Cafe: Global Cloudflare Quick Tunnel launcher
 *
 * Usage:
 *   node dev-global.js
 *   npm run dev:global
 *
 * What it does:
 *  1. Starts the FastAPI backend (port 8000)
 *  2. Starts a cloudflared Quick Tunnel for port 8000  → captures *.trycloudflare.com URL
 *  3. Writes VITE_API_BASE_URL & VITE_WS_URL to frontend/.env.local so Vite picks it up
 *  4. Starts the Vite frontend (port 5173)
 *  5. Starts a cloudflared Quick Tunnel for port 5173  → captures *.trycloudflare.com URL
 *  6. Prints the frontend public URL + renders ASCII QR code in the terminal
 */

import { spawn }   from 'child_process';
import fs          from 'fs';
import path        from 'path';
import net         from 'net';
import { fileURLToPath } from 'url';
import qrcode      from 'qrcode-terminal';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const backendDir = path.join(__dirname, 'backend');
const frontendEnvLocal = path.join(__dirname, 'frontend', '.env.local');

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function checkPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => { socket.destroy(); resolve(true);  });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error',   () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Find the cloudflared binary — checks common install paths on Windows/macOS/Linux */
function findCloudflared() {
  const candidates = [
    // Windows MSI (winget) install location — most common on Windows x64
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    // Scoop
    path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'cloudflared.exe'),
    // WinGet packages dir
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages',
              'Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe', 'cloudflared.exe'),
    // macOS / Linux homebrew
    '/usr/local/bin/cloudflared',
    '/opt/homebrew/bin/cloudflared',
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return 'cloudflared'; // fall back to PATH
}

/** Start a cloudflared quick tunnel and resolve with the *.trycloudflare.com URL */
function startTunnel(localPort, label) {
  return new Promise((resolve, reject) => {
    const cf = findCloudflared();
    console.log(`  \x1b[90m[TUNNEL:${label}] Starting cloudflared quick-tunnel → localhost:${localPort}\x1b[0m`);

    const proc = spawn(cf, ['tunnel', '--url', `http://localhost:${localPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const urlRegex = /https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error(`Tunnel for port ${localPort} timed out — is cloudflared installed?`));
    }, 60_000);

    function tryExtract(data) {
      const text = data.toString();
      const match = urlRegex.exec(text);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ url: match[0], proc });
      }
    }

    proc.stdout.on('data', tryExtract);
    proc.stderr.on('data', tryExtract);

    proc.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(
          `Could not launch cloudflared: ${err.message}\n` +
          `  Install it with:  winget install --id Cloudflare.cloudflared`
        ));
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log('\n\x1b[38;2;16;185;129m' + '═'.repeat(60) + '\x1b[0m');
  console.log('  \x1b[1m\x1b[38;2;6;182;212m🌐 VANYA GAMING CAFE  —  GLOBAL TUNNEL MODE\x1b[0m');
  console.log('\x1b[38;2;16;185;129m' + '═'.repeat(60) + '\x1b[0m\n');

  // ── 1. Detect Python / venv ──────────────────────────────────────────────
  let pythonCmd = 'python';
  const winVenv  = path.join(backendDir, '.venv', 'Scripts', 'python.exe');
  const unixVenv = path.join(backendDir, '.venv', 'bin', 'python');
  if (fs.existsSync(winVenv))       pythonCmd = winVenv;
  else if (fs.existsSync(unixVenv)) pythonCmd = unixVenv;

  // ── 2. Decide DATABASE_URL (SQLite fallback if no Postgres) ──────────────
  const env = { ...process.env, PYTHONPATH: backendDir };
  const dbUrl = env.DATABASE_URL || '';
  const isLocalPg = dbUrl.includes('localhost:5432') || dbUrl.includes('127.0.0.1:5432') || !dbUrl;
  if (isLocalPg) {
    const pgUp = await checkPortOpen('127.0.0.1', 5432, 400);
    if (!pgUp) {
      console.log('  \x1b[90m[DB] PostgreSQL offline → using SQLite\x1b[0m\n');
      env.DATABASE_URL = 'sqlite+aiosqlite:///./gaming_cafe_dev.db';
    } else {
      console.log('  \x1b[32m[DB] PostgreSQL ✓\x1b[0m\n');
    }
  }

  // ── 3. Start FastAPI backend ──────────────────────────────────────────────
  console.log('  \x1b[38;2;168;85;247m[1/4] Starting FastAPI backend on :8000 …\x1b[0m');
  const backendProc = spawn(pythonCmd, [
    '-m', 'uvicorn', 'app.main:app',
    '--reload', '--host', '0.0.0.0', '--port', '8000', '--no-access-log',
  ], { cwd: backendDir, stdio: 'inherit', shell: false, env });

  backendProc.on('error', (e) => console.error('[BACKEND ERROR]', e.message));

  // Wait for backend to be responsive
  console.log('  \x1b[90m  → waiting for backend to start …\x1b[0m');
  for (let i = 0; i < 20; i++) {
    await sleep(800);
    if (await checkPortOpen('127.0.0.1', 8000, 400)) break;
  }

  // ── 4. Backend tunnel ─────────────────────────────────────────────────────
  console.log('\n  \x1b[38;2;168;85;247m[2/4] Opening Cloudflare Quick Tunnel for backend …\x1b[0m');
  let backendTunnel;
  try {
    backendTunnel = await startTunnel(8000, 'API');
  } catch (err) {
    console.error('\n  \x1b[31m✗ Backend tunnel failed:\x1b[0m', err.message);
    backendProc.kill();
    process.exit(1);
  }

  const backendPublicUrl = backendTunnel.url;
  const wsPublicUrl      = backendPublicUrl.replace(/^http/, 'wss');
  console.log(`  \x1b[32m  ✓ Backend public URL: \x1b[4m${backendPublicUrl}\x1b[0m`);

  // ── 5. Write frontend/.env.local so Vite uses the public backend URL ──────
  const envLocalContent = [
    '# Auto-generated by dev-global.js  —  DO NOT COMMIT',
    `VITE_API_BASE_URL=${backendPublicUrl}`,
    `VITE_WS_URL=${wsPublicUrl}`,
    '',
  ].join('\n');
  fs.writeFileSync(frontendEnvLocal, envLocalContent, 'utf8');
  console.log(`  \x1b[90m  → wrote frontend/.env.local\x1b[0m`);

  // ── 6. Start Vite frontend ────────────────────────────────────────────────
  console.log('\n  \x1b[38;2;6;182;212m[3/4] Starting Vite frontend on :5173 …\x1b[0m');
  const frontendProc = spawn('npm', ['run', 'dev', '--prefix', 'frontend'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_GLOBAL_MODE: 'true' },
  });
  frontendProc.on('error', (e) => console.error('[FRONTEND ERROR]', e.message));

  // Wait for frontend to be responsive
  console.log('  \x1b[90m  → waiting for Vite to start …\x1b[0m');
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    if (await checkPortOpen('127.0.0.1', 5173, 400)) break;
  }

  // ── 7. Frontend tunnel ────────────────────────────────────────────────────
  console.log('\n  \x1b[38;2;6;182;212m[4/4] Opening Cloudflare Quick Tunnel for frontend …\x1b[0m');
  let frontendTunnel;
  try {
    frontendTunnel = await startTunnel(5173, 'UI');
  } catch (err) {
    console.error('\n  \x1b[31m✗ Frontend tunnel failed:\x1b[0m', err.message);
    backendTunnel.proc.kill();
    backendProc.kill();
    frontendProc.kill();
    process.exit(1);
  }

  const frontendPublicUrl = frontendTunnel.url;

  // ── 8. Print dashboard + QR ───────────────────────────────────────────────
  console.log('\n\x1b[38;2;16;185;129m' + '═'.repeat(60) + '\x1b[0m');
  console.log('  \x1b[1m\x1b[38;2;245;158;11m🚀 LIVE GLOBALLY — SHARE THIS LINK:\x1b[0m\n');
  console.log(`  \x1b[1m\x1b[38;2;16;185;129m➜ Frontend (Public): \x1b[4m${frontendPublicUrl}\x1b[0m`);
  console.log(`  \x1b[38;2;168;85;247m➜ Backend  (Public): \x1b[4m${backendPublicUrl}\x1b[0m`);
  console.log(`  \x1b[38;2;168;85;247m➜ API Docs (Public): \x1b[4m${backendPublicUrl}/docs\x1b[0m`);
  console.log('\x1b[38;2;16;185;129m' + '─'.repeat(60) + '\x1b[0m');
  console.log('\n  \x1b[1m\x1b[38;2;245;158;11m📱 SCAN QR CODE TO OPEN ON ANY PHONE (ANYWHERE):\x1b[0m\n');

  await new Promise((resolve) => {
    qrcode.generate(frontendPublicUrl, { small: true }, (qr) => {
      const indented = qr.split('\n').map((l) => '    ' + l).join('\n');
      console.log(indented);
      resolve();
    });
  });

  console.log('\n  \x1b[1m\x1b[38;5;51m🔗 ' + frontendPublicUrl + '\x1b[0m');
  console.log('\n  \x1b[90mShare the URL above with anyone. It works over any network.\x1b[0m');
  console.log('  \x1b[90mPress Ctrl+C to stop all tunnels and servers.\x1b[0m\n');
  console.log('\x1b[38;2;16;185;129m' + '═'.repeat(60) + '\x1b[0m\n');

  // ── 9. Keep alive — kill everything on Ctrl+C ─────────────────────────────
  function cleanup() {
    console.log('\n\x1b[90m[GLOBAL] Shutting down tunnels and servers …\x1b[0m');
    // Clean up .env.local so local dev isn't confused next time
    try { fs.unlinkSync(frontendEnvLocal); } catch {}
    try { backendTunnel.proc.kill('SIGTERM');  } catch {}
    try { frontendTunnel.proc.kill('SIGTERM'); } catch {}
    try { frontendProc.kill('SIGTERM');        } catch {}
    try { backendProc.kill('SIGTERM');         } catch {}
    process.exit(0);
  }

  process.on('SIGINT',  cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit',    cleanup);

  // Block forever
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('\x1b[31m[GLOBAL ERROR]\x1b[0m', err.message);
  process.exit(1);
});
