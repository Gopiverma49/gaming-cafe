import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.join(__dirname, 'backend');

// Helper to check if a TCP port is open (e.g. Postgres on 5432)
function checkPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function main() {
  // Detect Python executable (prefer local .venv)
  let pythonCmd = 'python';
  const winVenv = path.join(backendDir, '.venv', 'Scripts', 'python.exe');
  const unixVenv = path.join(backendDir, '.venv', 'bin', 'python');

  if (fs.existsSync(winVenv)) {
    pythonCmd = winVenv;
  } else if (fs.existsSync(unixVenv)) {
    pythonCmd = unixVenv;
  }

  const isTest = process.argv.includes('--test');
  const args = isTest
    ? ['-m', 'pytest', 'tests/', '-v']
    : ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'];

  const env = { ...process.env, PYTHONPATH: backendDir };

  // If running dev server without tests, check if Postgres is running on localhost:5432
  if (!isTest) {
    const dbUrl = env.DATABASE_URL || '';
    const isLocalPostgres =
      dbUrl.includes('localhost:5432') ||
      dbUrl.includes('127.0.0.1:5432') ||
      !dbUrl;

    if (isLocalPostgres) {
      const isPostgresLive = await checkPortOpen('127.0.0.1', 5432, 400);
      if (!isPostgresLive) {
        console.log('\n[BACKEND] ℹ️  PostgreSQL not detected on localhost:5432.');
        console.log('[BACKEND] 🚀 Auto-fallback: Using local SQLite database (sqlite+aiosqlite:///./gaming_cafe_dev.db).');
        console.log('[BACKEND] 💡 (Tip: Start PostgreSQL or run "npm run docker:up" anytime to use PostgreSQL)\n');
        env.DATABASE_URL = 'sqlite+aiosqlite:///./gaming_cafe_dev.db';
      } else {
        console.log('[BACKEND] 🟢 Connected to local PostgreSQL on 5432.');
      }
    }
  }

  const label = isTest ? 'TESTS' : 'UVICORN';
  console.log(`[BACKEND] Launching ${label} with ${pythonCmd}...`);

  const proc = spawn(pythonCmd, args, {
    cwd: backendDir,
    stdio: 'inherit',
    shell: false,
    env,
  });

  proc.on('error', (err) => {
    console.error(`[BACKEND ERROR] Failed to start backend process:`, err);
  });

  proc.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main();
