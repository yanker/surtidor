import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { handler } from './lib/estaciones.js';

// En desarrollo servimos /api/estaciones con el mismo código que usa Vercel
const apiLocal = () => ({
  name: 'api-local',
  configureServer(server) {
    server.middlewares.use('/api/estaciones', (req, res) => {
      req.url = '/api/estaciones' + (req.url || '');
      handler(req, res);
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/estaciones', (req, res) => {
      req.url = '/api/estaciones' + (req.url || '');
      handler(req, res);
    });
  },
});

export default defineConfig({
  plugins: [tailwindcss(), apiLocal()],
});
