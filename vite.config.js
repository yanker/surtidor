import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { handler } from './lib/estaciones.js';
import { handlerRuta } from './lib/ruta.js';

// En desarrollo servimos /api/* con el mismo código que usa Vercel
const RUTAS_API = { '/api/estaciones': handler, '/api/ruta': handlerRuta };
const montar = (server) => {
  for (const [ruta, fn] of Object.entries(RUTAS_API)) {
    server.middlewares.use(ruta, (req, res) => {
      req.url = ruta + (req.url || '');
      fn(req, res);
    });
  }
};
const apiLocal = () => ({ name: 'api-local', configureServer: montar, configurePreviewServer: montar });

export default defineConfig({
  plugins: [tailwindcss(), apiLocal()],
  build: {
    // Dos páginas: la app y la política de privacidad (/privacidad)
    rollupOptions: { input: { main: 'index.html', privacidad: 'privacidad.html' } },
  },
});
