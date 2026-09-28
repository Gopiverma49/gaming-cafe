import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import { env as validatedEnv } from './src/config/env.js';

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
  const isCleanTest = process.argv.includes('--clean-test');
  const isForce = process.argv.includes('--force');
  const isVerbose = process.argv.includes('--verbose');
  const host = validatedEnv.HOST || '0.0.0.0';
  const port = String(validatedEnv.BACKEND_PORT || 8000);

  const uvicornArgs = [
    '-m', 'uvicorn', 'app.main:app',
    '--reload',
    '--host', host,
    '--port', port,
    ...(isVerbose ? [] : ['--no-access-log'])
  ];
  let args = uvicornArgs;
  if (isTest) {
    args = ['-m', 'pytest', 'tests/', '-v'];
  } else if (isCleanTest) {
    args = ['scripts/clean_test_data.py', ...(isForce ? ['--force'] : ['--dry-run'])];
  }

  // Parse .env files (root and backend) if environment variables are not pre-set
  function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const res = {};
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx !== -1) {
        const k = line.substring(0, idx).trim();
        let v = line.substring(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        res[k] = v;
      }
    }
    return res;
  }

  const rootEnv = parseEnvFile(path.join(__dirname, '.env'));
  const backendEnv = parseEnvFile(path.join(backendDir, '.env'));
  const env = {
    ...rootEnv,
    ...backendEnv,
    ...process.env,
    HOST: host,
    PORT: port,
    PYTHONPATH: backendDir,
  };

  // If running dev server without tests, verify database target
  if (!isTest) {
    const dbUrl = env.DATABASE_URL || '';
    const isRemotePostgres =
      dbUrl.includes('supabase.co') ||
      dbUrl.includes('supabase.com') ||
      dbUrl.includes('neon.tech') ||
      dbUrl.includes('pooler.supabase') ||
      (!dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1') && dbUrl.startsWith('postgres'));

    if (isRemotePostgres) {
      const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
      console.log(`\n[BACKEND] 🌐 Cloud PostgreSQL connection detected: ${maskedUrl}`);
      console.log('[BACKEND] ⚡ Auto-creating all tables and syncing canonical hierarchy on startup...\n');
    } else {
      const isLocalPostgres =
        dbUrl.includes('localhost:5432') ||
        dbUrl.includes('127.0.0.1:5432') ||
        !dbUrl;

      if (isLocalPostgres) {
        const isPostgresLive = await checkPortOpen('127.0.0.1', 5432, 400);
        if (!isPostgresLive) {
          console.log('\n[BACKEND] ℹ️  PostgreSQL not detected on localhost:5432.');
          console.log('[BACKEND] 🚀 Auto-fallback: Using local SQLite database (sqlite+aiosqlite:///./gaming_cafe_dev.db).');
          console.log('[BACKEND] 💡 (Tip: Put your Supabase or cloud Postgres DATABASE_URL in .env to use cloud database)\n');
          env.DATABASE_URL = 'sqlite+aiosqlite:///./gaming_cafe_dev.db';
        } else {
          console.log('[BACKEND] 🟢 Connected to local PostgreSQL on 5432.');
        }
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
