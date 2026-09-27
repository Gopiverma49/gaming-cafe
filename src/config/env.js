/**
 * Centralized Environment Configuration & Fail-Fast Schema Validation
 * Validates runtime environment variables for production readiness.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root directory is two levels up from src/config
const rootDir = path.resolve(__dirname, '..', '..');

/**
 * Lightweight .env file parser if dotenv is not bundled
 */
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

// Load root and backend .env files if present (without overwriting existing process.env)
const rootEnv = parseEnvFile(path.join(rootDir, '.env'));
const backendEnv = parseEnvFile(path.join(rootDir, 'backend', '.env'));
const merged = { ...rootEnv, ...backendEnv, ...process.env };

/**
 * Validate and sanitize configuration
 */
function validateConfig(raw) {
  const errors = [];

  // 1. NODE_ENV validation
  const validEnvs = ['production', 'development', 'test'];
  const rawNodeEnv = (raw.NODE_ENV || 'development').toLowerCase().trim();
  if (!validEnvs.includes(rawNodeEnv)) {
    errors.push(`Invalid NODE_ENV "${rawNodeEnv}". Allowed values: ${validEnvs.join(', ')}`);
  }
  const isProduction = rawNodeEnv === 'production';

  // 2. PORT validation (Coerced number with fallback: 5000 or hosting assigned)
  let port = 5000;
  if (raw.PORT) {
    const parsedPort = parseInt(raw.PORT, 10);
    if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      errors.push(`Invalid PORT "${raw.PORT}". Must be an integer between 1 and 65535.`);
    } else {
      port = parsedPort;
    }
  }

  // 3. BACKEND_PORT validation
  let backendPort = 8000;
  if (raw.BACKEND_PORT) {
    const parsedBackendPort = parseInt(raw.BACKEND_PORT, 10);
    if (isNaN(parsedBackendPort) || parsedBackendPort < 1 || parsedBackendPort > 65535) {
      errors.push(`Invalid BACKEND_PORT "${raw.BACKEND_PORT}". Must be an integer between 1 and 65535.`);
    } else {
      backendPort = parsedBackendPort;
    }
  }

  // 4. HOST validation (Default to '0.0.0.0' for container compatibility)
  const host = (raw.HOST || '0.0.0.0').trim();

  // 5. ALLOWED_ORIGINS validation
  const rawOrigins = raw.ALLOWED_ORIGINS || raw.CORS_ORIGINS || (isProduction ? '' : '*');
  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (isProduction) {
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
      errors.push(
        'ALLOWED_ORIGINS / CORS_ORIGINS: Wildcard "*" is strictly FORBIDDEN in production. You must define explicit authorized URLs (e.g. "https://app.example.com").'
      );
    }
  }

  // 6. DATABASE_URL validation
  const databaseUrl = (raw.DATABASE_URL || '').trim();
  if (isProduction) {
    if (!databaseUrl) {
      errors.push('DATABASE_URL is required in production.');
    } else if (databaseUrl.startsWith('sqlite')) {
      errors.push('DATABASE_URL: SQLite is not allowed in production. Configure a production PostgreSQL connection.');
    }
  }

  // 7. Security secrets validation (JWT_SECRET & ADMIN_PASSWORD)
  const jwtSecret = (raw.JWT_SECRET || 'enterprise_gaming_cafe_super_secret_jwt_key_2026').trim();
  const adminPassword = (raw.ADMIN_PASSWORD || 'admin123').trim();

  if (isProduction) {
    if (jwtSecret === 'enterprise_gaming_cafe_super_secret_jwt_key_2026' || jwtSecret.length < 32) {
      errors.push(
        'JWT_SECRET: Production requires a secure secret key with at least 32 characters. Do not use default credentials.'
      );
    }
    if (adminPassword === 'admin123' || adminPassword.length < 8) {
      errors.push('ADMIN_PASSWORD: Insecure default password detected. Set a strong password with at least 8 characters.');
    }
  }

  // Fail-fast if validation errors occurred
  if (errors.length > 0) {
    console.error('\n' + '='.repeat(70));
    console.error('❌ [FATAL CONFIGURATION ERROR] Environment validation failed:');
    errors.forEach((err, i) => console.error(`   ${i + 1}. ${err}`));
    console.error('='.repeat(70) + '\n');
    process.exit(1);
  }

  return {
    NODE_ENV: rawNodeEnv,
    IS_PRODUCTION: isProduction,
    PORT: port,
    BACKEND_PORT: backendPort,
    HOST: host,
    ALLOWED_ORIGINS: allowedOrigins,
    DATABASE_URL: databaseUrl || 'sqlite+aiosqlite:///./gaming_cafe_dev.db',
    JWT_SECRET: jwtSecret,
    JWT_ALGORITHM: raw.JWT_ALGORITHM || 'HS256',
    ADMIN_USERNAME: raw.ADMIN_USERNAME || 'admin',
    ADMIN_PASSWORD: adminPassword,
    UPI_MERCHANT_VPA: raw.UPI_MERCHANT_VPA || 'gamingcafe@upi',
    UPI_MERCHANT_NAME: raw.UPI_MERCHANT_NAME || 'ApexCyberLounge',
    VITE_GLOBAL_MODE: raw.VITE_GLOBAL_MODE === 'true',
  };
}

export const env = validateConfig(merged);
export default env;
