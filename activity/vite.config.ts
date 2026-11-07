import { defineConfig } from 'vite';

const botPort = Number(process.env.PORT ?? 3001);

export default defineConfig({
  // .env liegt im Projekt-Root (gemeinsam mit dem Bot)
  envDir: '..',
  server: {
    port: 5173,
    // erlaubt Tunnel-Domains (cloudflared, ngrok …) für das Testen in Discord
    allowedHosts: true,
    proxy: {
      '/api': `http://localhost:${botPort}`,
      '/.proxy/api': { target: `http://localhost:${botPort}`, rewrite: (p) => p.replace(/^\/\.proxy/, '') },
      '/ws': { target: `ws://localhost:${botPort}`, ws: true },
      '/.proxy/ws': { target: `ws://localhost:${botPort}`, ws: true, rewrite: (p) => p.replace(/^\/\.proxy/, '') },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
