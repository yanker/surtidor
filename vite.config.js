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

// Cada build lleva un identificador propio y publica /version.json con él.
// La app lo consulta al volver a primer plano: si no coincide, hay versión nueva y recarga.
const BUILD = new Date().toISOString();
const version = () => ({
  name: 'version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
  },
});

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [tailwindcss(), apiLocal(), version()],
  build: {
    // Dos páginas: la app y la política de privacidad (/privacidad)
    rollupOptions: { input: { main: 'index.html', privacidad: 'privacidad.html' } },
  },
});
