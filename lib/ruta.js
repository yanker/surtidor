// Planificador de viajes: rutas alternativas (OSRM) y gasolineras a lo largo de cada una.
// Compartido entre la función de Vercel (api/ruta.js), el servidor de Vite y el plan B del navegador.
import { obtenerTodas } from './estaciones.js';

// Servidor de rutas OSRM. El público de demostración no necesita clave; en producción con
// mucho tráfico conviene uno propio (variable de entorno OSRM_URL).
const OSRM = (typeof process !== 'undefined' && process.env?.OSRM_URL) || 'https://router.project-osrm.org';

export const DESVIOS = [1, 2, 5]; // km máximos desde la carretera

// ---------- Geometría ----------
const KM_LAT = 110.574;
const kmLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

// Simplificación Douglas-Peucker (tolerancia en km) sobre [[lat, lon], ...]
export function simplificar(puntos, tolKm = 0.02) {
  if (puntos.length < 3) return puntos;
  const kx = kmLon(puntos[0][0]);
  const xy = puntos.map(([la, lo]) => [lo * kx, la * KM_LAT]);
  const conservar = new Uint8Array(puntos.length);
  conservar[0] = conservar[puntos.length - 1] = 1;
  const pila = [[0, puntos.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    let max = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distSegmento(xy[k], xy[i], xy[j]).d;
      if (d > max) {
        max = d;
        idx = k;
      }
    }
    if (max > tolKm) {
      conservar[idx] = 1;
      pila.push([i, idx], [idx, j]);
    }
  }
  return puntos.filter((_, k) => conservar[k]);
}

// Distancia de un punto p a un segmento ab en el plano, y fracción t del segmento
function distSegmento(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return { d: Math.sqrt(x * x + y * y), t };
}

// Prepara una ruta para consultas rápidas: km acumulados y rejilla de segmentos (celdas de 0,1°)
const CELDA = 0.1;
const clave = (la, lo) => `${Math.floor(la / CELDA)}:${Math.floor(lo / CELDA)}`;

export function prepararRuta(coords) {
  const acum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [la1, lo1] = coords[i - 1];
    const [la2, lo2] = coords[i];
    const dx = (lo2 - lo1) * kmLon((la1 + la2) / 2);
    const dy = (la2 - la1) * KM_LAT;
    acum.push(acum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const rejilla = new Map();
  for (let i = 0; i < coords.length - 1; i++) {
    const [la1, lo1] = coords[i];
    const [la2, lo2] = coords[i + 1];
    for (let a = Math.floor(Math.min(la1, la2) / CELDA); a <= Math.floor(Math.max(la1, la2) / CELDA); a++) {
      for (let o = Math.floor(Math.min(lo1, lo2) / CELDA); o <= Math.floor(Math.max(lo1, lo2) / CELDA); o++) {
        const k = `${a}:${o}`;
        if (!rejilla.has(k)) rejilla.set(k, []);
        rejilla.get(k).push(i);
      }
    }
  }
  return { coords, acum, rejilla, total: acum[acum.length - 1] };
}

// Proyecta un punto sobre la ruta → { km: punto kilométrico, desvio: km hasta la carretera }
// `cerca` limita la búsqueda a las celdas vecinas (rápido); si no hay nada cerca, recorre toda la ruta.
export function proyectar(ruta, lat, lon, { soloCerca = false, desdeKm = -Infinity } = {}) {
  const { coords, acum, rejilla } = ruta;
  const kx = kmLon(lat);
  const p = [lon * kx, lat * KM_LAT];
  let segs = new Set();
  const ca = Math.floor(lat / CELDA);
  const co = Math.floor(lon / CELDA);
  for (let a = ca - 1; a <= ca + 1; a++) for (let o = co - 1; o <= co + 1; o++) for (const s of rejilla.get(`${a}:${o}`) || []) segs.add(s);
  if (!segs.size) {
    if (soloCerca) return null;
    segs = coords.slice(0, -1).keys();
  }
  let mejor = null;
  for (const i of segs) {
    if (acum[i + 1] < desdeKm) continue;
    const [la1, lo1] = coords[i];
    const [la2, lo2] = coords[i + 1];
    const { d, t } = distSegmento(p, [lo1 * kx, la1 * KM_LAT], [lo2 * kx, la2 * KM_LAT]);
    if (!mejor || d < mejor.desvio) mejor = { desvio: d, km: acum[i] + t * (acum[i + 1] - acum[i]) };
  }
  return mejor;
}

// Gasolineras a menos de `desvioKm` de la ruta, ordenadas por punto kilométrico
export function estacionesEnRuta(estaciones, ruta, desvioKm) {
  const lats = ruta.coords.map((c) => c[0]);
  const lons = ruta.coords.map((c) => c[1]);
  const m = desvioKm / 100; // margen en grados (holgado)
  const [laMin, laMax, loMin, loMax] = [Math.min(...lats) - m, Math.max(...lats) + m, Math.min(...lons) - m * 1.4, Math.max(...lons) + m * 1.4];
  const out = [];
  for (const e of estaciones) {
    if (e.lat < laMin || e.lat > laMax || e.lon < loMin || e.lon > loMax) continue;
    const pr = proyectar(ruta, e.lat, e.lon, { soloCerca: true });
    if (pr && pr.desvio <= desvioKm) out.push({ ...e, a: Math.round(pr.km * 100) / 100, dv: Math.round(pr.desvio * 100) / 100 });
  }
  return out.sort((x, y) => x.a - y.a);
}

// ---------- Rutas ----------
export async function pedirRutas(o, d) {
  const url = `${OSRM}/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?alternatives=3&overview=full&geometries=geojson&steps=true`;
  // En el servidor nos identificamos; en el navegador no (forzaría una petición previa CORS)
  const enNavegador = typeof window !== 'undefined';
  const r = await fetch(url, enNavegador ? {} : { headers: { 'User-Agent': 'Surtidor (https://surtidor.vercel.app)' } });
  if (!r.ok) throw new Error(`El servicio de rutas respondió ${r.status}`);
  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error('No se encontró ninguna ruta por carretera');
  return j.routes.map((rt) => ({
    resumen: rt.legs.map((l) => l.summary).filter(Boolean).join(' · ') || 'Ruta',
    km: Math.round(rt.distance / 100) / 10,
    min: Math.round(rt.duration / 60),
    // GeoJSON es [lon, lat]; lo pasamos a [lat, lon] con 5 decimales (~1 m)
    coords: simplificar(rt.geometry.coordinates.map(([lo, la]) => [+la.toFixed(5), +lo.toFixed(5)])),
  }));
}

export async function calcularViaje(o, d, desvioKm, estaciones) {
  const rutas = await pedirRutas(o, d);
  return rutas.map((r) => ({ ...r, estaciones: estacionesEnRuta(estaciones, prepararRuta(r.coords), desvioKm) }));
}

// GET /api/ruta?o=lat,lon&d=lat,lon&desvio=2
export async function handlerRuta(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const punto = (s) => {
    const [lat, lon] = String(s || '').split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  };
  const o = punto(url.searchParams.get('o'));
  const d = punto(url.searchParams.get('d'));
  const desvio = DESVIOS.includes(Number(url.searchParams.get('desvio'))) ? Number(url.searchParams.get('desvio')) : 2;

  const enviar = (status, body, cacheCtl = 'no-store') => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cacheCtl);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify(body));
  };
  if (!o || !d) return enviar(400, { error: 'Parámetros o y d obligatorios (lat,lon)' });

  try {
    const [{ fecha, estaciones }, rutas] = await Promise.all([obtenerTodas(), pedirRutas(o, d)]);
    const out = rutas.map((r) => ({ ...r, estaciones: estacionesEnRuta(estaciones, prepararRuta(r.coords), desvio) }));
    enviar(200, { fecha, desvio, rutas: out }, 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800');
  } catch (err) {
    enviar(502, { error: String(err.message || err) });
  }
}
