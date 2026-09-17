import os from 'os';
import qrcode from 'qrcode-terminal';
import concurrently from 'concurrently';

// 1. Get primary non-internal IPv4 address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();
const mobileUrl = `http://${localIp}:5173`;
const localUrl = 'http://localhost:5173';
const backendUrl = 'http://localhost:8000';
const docsUrl = 'http://localhost:8000/docs';

console.clear();
console.log('\n\x1b[38;2;16;185;129m' + '═'.repeat(64) + '\x1b[0m');
console.log('  \x1b[1m\x1b[38;2;6;182;212m🎮 APEX CYBER LOUNGE — OPERATIONS & FINANCIALS\x1b[0m');
console.log('  \x1b[90mEnterprise Gaming Cafe Platform • Full Mobile & Kiosk Suite\x1b[0m');
console.log('\x1b[38;2;16;185;129m' + '═'.repeat(64) + '\x1b[0m\n');

console.log('  \x1b[1m\x1b[38;2;245;158;11m📱 SCAN TO OPEN ON YOUR MOBILE PHONE (SAME WI-FI):\x1b[0m\n');

// 2. Generate compact QR code in terminal
qrcode.generate(mobileUrl, { small: true }, (qr) => {
  const indentedQr = qr
    .split('\n')
    .map((line) => '    ' + line)
    .join('\n');
  console.log(indentedQr);
});

console.log('');
console.log(`  \x1b[1m\x1b[38;2;16;185;129m➜  Mobile URL: \x1b[0m \x1b[4m${mobileUrl}\x1b[0m`);
console.log(`  \x1b[1m\x1b[38;2;6;182;212m➜  Local (PC): \x1b[0m \x1b[4m${localUrl}\x1b[0m`);
console.log(`  \x1b[1m\x1b[38;2;168;85;247m➜  Backend API:\x1b[0m \x1b[4m${backendUrl}\x1b[0m`);
console.log(`  \x1b[1m\x1b[38;2;245;158;11m➜  API Docs:   \x1b[0m \x1b[4m${docsUrl}\x1b[0m`);
console.log('\x1b[90m' + '─'.repeat(64) + '\x1b[0m\n');

// 3. Launch Backend & Frontend concurrently
const { result } = concurrently(
  [
    {
      command: 'node run-backend.js',
      name: 'BACKEND',
      prefixColor: 'magenta.bold',
    },
    {
      command: 'npm run dev --prefix frontend',
      name: 'FRONTEND',
      prefixColor: 'cyan.bold',
    },
  ],
  {
    prefix: '[{name}]',
    killOthersOn: ['failure'],
    restartTries: 0,
  }
);

result.catch(() => {
  // Exit cleanly on cancel
  process.exit(0);
});
