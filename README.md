# Surtidor

PWA que usa tu ubicación y muestra las gasolineras más cercanas (radio de 5 a 50 km) con sus precios en tiempo real.
Datos oficiales del Ministerio para la Transición Ecológica. No usa base de datos.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173 (incluye /api/estaciones)
npm run build && npm run preview   # prueba de producción con service worker
```

La geolocalización solo funciona en `localhost` o con HTTPS.

## Despliegue en Vercel

Importa el repo en Vercel y despliega. `vercel.json` ya configura:
- el build de Vite (`dist/`)
- la función `api/estaciones.js` en la región `cdg1` (París, cerca de España)
- cabeceras del service worker y del manifest

## Cómo funciona

- `api/estaciones.js` → `lib/estaciones.js`: descarga el listado completo del Ministerio (~12 MB),
  lo compacta, lo guarda **en memoria** 15 min y devuelve solo las estaciones del radio pedido (~20 KB).
  La respuesta se cachea además en la CDN de Vercel (`s-maxage=600`).
- Si `/api` no está disponible (por ejemplo, sirviendo `dist/` como estático), el navegador
  descarga directamente el listado del Ministerio (tiene CORS abierto) y filtra en el cliente.
- `public/sw.js`: la app abre sin conexión y muestra los últimos precios consultados.
- Iconos: edita `public/icon.svg` y ejecuta `npm run icons`.

## PWA

- Instalable en Android, iOS y escritorio (manifest con iconos, icono adaptable, capturas y accesos directos).
- Pantalla de inicio: en Android la genera el sistema con el icono y `background_color`; en iOS se usan
  las imágenes de `public/splash/` (claro y oscuro, por tamaño de pantalla). Se regeneran con `npm run icons`,
  que también actualiza las etiquetas `apple-touch-startup-image` de `index.html`.
- Sin cookies ni analítica: preferencias y tema se guardan solo en `localStorage`. Tipografía incluida en la app.
