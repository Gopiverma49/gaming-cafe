import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // Bind to all interfaces so local Wi-Fi AND Cloudflare/ngrok tunnels can reach Vite
    host: '0.0.0.0',

    // Vite 6+ blocks requests whose Host header doesn't match an allowed pattern.
    // We permit all *.trycloudflare.com / *.ngrok-free.app subdomains plus localhost.
    allowedHosts: [
      'localhost',
      '.trycloudflare.com',   // Cloudflare Quick Tunnels
      '.ngrok-free.app',      // ngrok free tier
      '.ngrok.io',            // ngrok paid
    ],

    // When tunnelled through Cloudflare (TLS-terminated at edge) VITE_GLOBAL_MODE
    // is set to 'true'. HMR must then connect via wss:// on port 443.
    hmr: process.env.VITE_GLOBAL_MODE === 'true'
      ? { protocol: 'wss', clientPort: 443 }
      : true,

    proxy: {
      // In local dev (no VITE_API_BASE_URL set) relative /api and /ws paths are
      // forwarded here by Vite so the browser never makes a cross-origin request.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-icons': ['lucide-react'],
          'vendor-state': ['zustand'],
        },
      },
    },
  },
});

