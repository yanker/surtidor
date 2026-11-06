// Lógica compartida entre la función serverless de Vercel (api/estaciones.js)
// y el servidor de desarrollo de Vite. Sin base de datos: se descarga el
// listado oficial del Ministerio, se compacta y se guarda en memoria unos minutos.

export const UPSTREAM =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

// Clave corta -> campo del Ministerio
export const COMBUSTIBLES = {
  g95: 'Precio Gasolina 95 E5',
  g95e10: 'Precio Gasolina 95 E10',
  g98: 'Precio Gasolina 98 E5',
  diesel: 'Precio Gasoleo A',
  dieselPlus: 'Precio Gasoleo Premium',
  glp: 'Precio Gases licuados del petróleo',
  gnc: 'Precio Gas Natural Comprimido',
  adblue: 'Precio Adblue',
};

const TTL_MS = 15 * 60 * 1000; // el Ministerio actualiza cada ~30 min
let cache = { at: 0, fecha: null, estaciones: null };
let enCurso = null;

const num = (s) => {
  if (!s) return null;
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function compactar(json) {
  const estaciones = [];
  for (const e of json.ListaEESSPrecio || []) {
    const lat = num(e.Latitud);
    const lon = num(e['Longitud (WGS84)']);
    if (lat == null || lon == null) continue;
    const pr = {};
    for (const [k, campo] of Object.entries(COMBUSTIBLES)) {
      const v = num(e[campo]);
      if (v) pr[k] = v;
    }
    if (!Object.keys(pr).length) continue;
    estaciones.push({
      id: e.IDEESS,
      n: (e['Rótulo'] || '').trim(),
      d: (e['Dirección'] || '').trim(),
      l: (e.Municipio || e.Localidad || '').trim(),
      p: (e.Provincia || '').trim(),
      cp: e['C.P.'],
      h: (e.Horario || '').trim(),
      lat,
      lon,
      pr,
    });
  }
  return { fecha: json.Fecha, estaciones };
}

export async function obtenerTodas() {
  if (cache.estaciones && Date.now() - cache.at < TTL_MS) return cache;
  if (!enCurso) {
    enCurso = (async () => {
      const r = await fetch(UPSTREAM, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Ministerio respondió ${r.status}`);
      const { fecha, estaciones } = compactar(await r.json());
      cache = { at: Date.now(), fecha, estaciones };
      return cache;
    })().finally(() => {
      enCurso = null;
    });
  }
  try {
    return await enCurso;
  } catch (err) {
    if (cache.estaciones) return cache; // mejor datos algo viejos que nada
    throw err;
  }
}

export function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function filtrarCercanas(estaciones, lat, lon, radioKm) {
  // Prefiltro rápido por caja antes de la fórmula de haversine
  const dLat = radioKm / 111;
  const dLon = radioKm / (111 * Math.cos((lat * Math.PI) / 180));
  const out = [];
  for (const e of estaciones) {
    if (Math.abs(e.lat - lat) > dLat || Math.abs(e.lon - lon) > dLon) continue;
    const km = distanciaKm(lat, lon, e.lat, e.lon);
    if (km <= radioKm) out.push({ ...e, km: Math.round(km * 100) / 100 });
  }
  return out.sort((a, b) => a.km - b.km);
}

// Handler estilo Node (req, res): sirve igual en Vercel y en el middleware de Vite
export async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const radio = Math.min(Math.max(parseFloat(url.searchParams.get('radio')) || 5, 1), 100);

  const enviar = (status, body, cacheCtl = 'no-store') => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cacheCtl);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify(body));
  };

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return enviar(400, { error: 'Parámetros lat y lon obligatorios' });
  }

  try {
    const { fecha, estaciones } = await obtenerTodas();
    const cercanas = filtrarCercanas(estaciones, lat, lon, radio);
    enviar(200, { fecha, total: cercanas.length, estaciones: cercanas },
      'public, max-age=120, s-maxage=600, stale-while-revalidate=1800');
  } catch (err) {
    enviar(502, { error: 'No se pudo obtener el listado del Ministerio', detalle: String(err.message || err) });
  }
}
