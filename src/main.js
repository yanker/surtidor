import '@fontsource-variable/inter';
import './style.css';
import 'leaflet/dist/leaflet.css';
import { estaAbierta } from './horario.js';
import { UPSTREAM, compactar, filtrarCercanas, distanciaKm } from '../lib/estaciones.js';

// ---------- Configuración ----------
// Cada combustible tiene su color claro (`suave`); el seleccionado se marca en el azul del tema
const COMBUSTIBLES = [
  { k: 'g95', nombre: 'Gasolina 95', corto: '95', sub: 'Gasolina',
    suave: 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-emerald-400/25' },
  { k: 'diesel', nombre: 'Diésel', corto: 'Diésel', sub: 'Gasóleo A',
    suave: 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/25' },
  { k: 'g98', nombre: 'Gasolina 98', corto: '98', sub: 'Gasolina',
    suave: 'bg-teal-100 text-teal-800 ring-teal-200 dark:bg-teal-400/15 dark:text-teal-300 dark:ring-teal-400/25' },
  { k: 'dieselPlus', nombre: 'Diésel+', corto: 'Diésel+', sub: 'Premium',
    suave: 'bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-400/15 dark:text-orange-300 dark:ring-orange-400/25' },
  { k: 'g95e10', nombre: '95 E10', corto: 'E10', sub: 'Gasolina',
    suave: 'bg-lime-100 text-lime-800 ring-lime-200 dark:bg-lime-400/15 dark:text-lime-300 dark:ring-lime-400/25' },
  { k: 'glp', nombre: 'GLP', corto: 'GLP', sub: 'Autogás',
    suave: 'bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-400/15 dark:text-sky-300 dark:ring-sky-400/25' },
  { k: 'gnc', nombre: 'GNC', corto: 'GNC', sub: 'Gas natural',
    suave: 'bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-400/15 dark:text-violet-300 dark:ring-violet-400/25' },
  { k: 'adblue', nombre: 'AdBlue', corto: 'AdBlue', sub: 'Aditivo',
    suave: 'bg-indigo-100 text-indigo-800 ring-indigo-200 dark:bg-indigo-400/15 dark:text-indigo-300 dark:ring-indigo-400/25' },
];
const LITROS_DEPOSITO = 50;
const CLAVE_PREFS = 'surtidor:prefs';
const CLAVE_TEMA = 'surtidor:tema';

// ---------- Estado ----------
const guardado = leer(CLAVE_PREFS, {});
const estado = {
  pos: null, // { lat, lon, etiqueta }
  combustible: guardado.combustible || 'g95',
  radio: guardado.radio || 5,
  orden: guardado.orden || 'precio',
  soloAbiertas: guardado.soloAbiertas ?? true,
  vista: guardado.vista || 'lista',
  datos: null, // { fecha, estaciones, radio, lat, lon }
  cargando: false,
};

// Accesos directos del icono (manifest "shortcuts"): /?combustible=diesel
{
  const p = new URLSearchParams(location.search);
  const c = p.get('combustible');
  if (c && COMBUSTIBLES.some((x) => x.k === c)) estado.combustible = c;
  if (p.has('combustible') || p.has('origen')) history.replaceState(null, '', '/');
}

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const euro = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const euro2 = (n) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const km = (n) => (n < 1 ? `${Math.round(n * 1000)} m` : `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`);
const direccion = (e) => [e.d, e.l].map((x) => titulo(x).replace(/[\s,]+$/, '')).filter(Boolean).join(', ');
// "06/11/2026 7:41:23" → "06/11/2026 a las 7:41"
const fechaBonita = (f) => {
  const r = String(f).match(/^(\S+)\s+(\d{1,2}:\d{2})/);
  return r ? `${r[1]} a las ${r[2]}` : f;
};
const titulo = (s) => (s || '').toLowerCase().replace(/(^|[\s,.(/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function leer(clave, porDefecto) {
  try {
    return JSON.parse(localStorage.getItem(clave)) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}
function guardarPrefs() {
  const { combustible, radio, orden, soloAbiertas, vista } = estado;
  try {
    localStorage.setItem(CLAVE_PREFS, JSON.stringify({ combustible, radio, orden, soloAbiertas, vista }));
  } catch {}
}

// ---------- Tema claro / oscuro ----------
// Por defecto sigue al sistema. En cuanto el usuario elige uno con el botón,
// se recuerda (localStorage, sin cookies) y ya no cambia con el sistema.
const mqOscuro = matchMedia('(prefers-color-scheme: dark)');
const esOscuro = () => document.documentElement.classList.contains('dark');

function aplicarTema() {
  let t = null;
  try {
    t = localStorage.getItem(CLAVE_TEMA);
  } catch {}
  const oscuro = t ? t === 'dark' : mqOscuro.matches;
  document.documentElement.classList.toggle('dark', oscuro);
  $('meta[name=theme-color]').content = oscuro ? '#030a1a' : '#eef3fb';
  $('#btn-tema').title = `Tema ${oscuro ? 'oscuro' : 'claro'}${t ? '' : ' (sistema)'} · pulsa para cambiar`;
}

$('#btn-tema').addEventListener('click', () => {
  const nuevo = esOscuro() ? 'light' : 'dark';
  try {
    localStorage.setItem(CLAVE_TEMA, nuevo);
  } catch {}
  aplicarTema();
});
mqOscuro.addEventListener('change', aplicarTema);

// ---------- Datos ----------
async function pedirEstaciones(lat, lon, radio) {
  // 1) Nuestra API (Vercel / vite dev): ligera, filtrada y cacheada
  try {
    const r = await fetch(`/api/estaciones?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&radio=${radio + 1}`);
    if (r.ok && r.headers.get('content-type')?.includes('json')) return await r.json();
  } catch {}
  // 2) Plan B: directamente al Ministerio (CORS abierto, pero ~12 MB)
  const r = await fetch(UPSTREAM, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('El servicio del Ministerio no responde');
  const { fecha, estaciones } = compactar(await r.json());
  return { fecha, estaciones: filtrarCercanas(estaciones, lat, lon, radio + 1) };
}

async function cargar({ forzar = false } = {}) {
  if (!estado.pos) return;
  const { lat, lon } = estado.pos;
  const d = estado.datos;
  // Si ya tenemos datos que cubren el radio pedido y la posición no ha cambiado, no volvemos a pedir
  if (!forzar && d && d.radio >= estado.radio && distanciaKm(d.lat, d.lon, lat, lon) < 0.2) return render();

  estado.cargando = true;
  render();
  try {
    const res = await pedirEstaciones(lat, lon, estado.radio);
    estado.datos = { fecha: res.fecha, estaciones: res.estaciones, radio: estado.radio, lat, lon };
    estado.error = null;
  } catch (e) {
    estado.error = e.message || 'Error al cargar los precios';
  } finally {
    estado.cargando = false;
    render();
  }
}

function enRadio() {
  if (!estado.datos || !estado.pos) return [];
  const { lat, lon } = estado.pos;
  const ahora = new Date();
  const c = estado.combustible;
  return estado.datos.estaciones
    .filter((e) => e.pr[c])
    .map((e) => ({ ...e, km: distanciaKm(lat, lon, e.lat, e.lon), abierta: estaAbierta(e.h, ahora) }))
    .filter((e) => e.km <= estado.radio);
}

function visibles(todas) {
  const c = estado.combustible;
  let lista = estado.soloAbiertas ? todas.filter((e) => e.abierta !== false) : [...todas];
  lista.sort((a, b) =>
    estado.orden === 'precio' ? a.pr[c] - b.pr[c] || a.km - b.km : a.km - b.km || a.pr[c] - b.pr[c],
  );
  return lista;
}

// ---------- Geolocalización ----------
function pedirUbicacion() {
  $('#ubicacion-texto').textContent = 'Obteniendo ubicación…';
  if (!('geolocation' in navigator)) return sinUbicacion('Tu navegador no permite geolocalización.');
  estado.cargando = true;
  render();
  navigator.geolocation.getCurrentPosition(
    (p) => {
      estado.pos = { lat: p.coords.latitude, lon: p.coords.longitude, etiqueta: 'Tu ubicación' };
      $('#ubicacion-texto').textContent = 'Tu ubicación actual';
      nombrarUbicacion(estado.pos);
      cargar();
    },
    (err) => {
      estado.cargando = false;
      sinUbicacion(err.code === 1 ? 'Has denegado el permiso de ubicación.' : 'No hemos podido obtener tu ubicación.');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
  );
}

async function nombrarUbicacion(pos) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${pos.lat}&lon=${pos.lon}`,
    );
    const j = await r.json();
    const a = j.address || {};
    const nombre = a.suburb || a.city || a.town || a.village || a.municipality;
    if (nombre && estado.pos === pos) {
      pos.etiqueta = nombre;
      $('#ubicacion-texto').textContent = `${nombre}${a.city && a.suburb ? ', ' + a.city : ''}`;
    }
  } catch {}
}

async function buscarLugar(texto) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=es&accept-language=es&q=${encodeURIComponent(texto)}`,
  );
  const [lugar] = await r.json();
  if (!lugar) throw new Error('No encontramos ese lugar');
  return { lat: +lugar.lat, lon: +lugar.lon, etiqueta: lugar.display_name.split(',').slice(0, 2).join(',') };
}

function sinUbicacion(motivo) {
  estado.pos = null;
  estado.motivoSinUbicacion = motivo;
  $('#ubicacion-texto').textContent = 'Ubicación no disponible';
  render();
}

// ---------- Render ----------
const SEG_ON = 'bg-blue-600 text-white shadow';
const SEG_OFF = 'text-muted hover:text-fg';

// Los 4 primeros son los habituales; el resto se despliega con «Más combustibles».
// Si el seleccionado es uno de los menos comunes, se muestran todos para que se vea marcado.
const HABITUALES = 4;
let verTodosCombustibles = false;

function renderControles() {
  const extraSeleccionado = COMBUSTIBLES.findIndex((c) => c.k === estado.combustible) >= HABITUALES;
  const todos = verTodosCombustibles || extraSeleccionado;
  const btnMas = $('#btn-mas-combustibles');
  btnMas.classList.toggle('hidden', extraSeleccionado);
  btnMas.setAttribute('aria-expanded', String(todos));
  $('#texto-mas-combustibles').textContent = todos
    ? 'Menos combustibles'
    : 'Más combustibles';
  $('#flecha-mas-combustibles').classList.toggle('rotate-180', todos);

  $('#combustibles').innerHTML = (todos ? COMBUSTIBLES : COMBUSTIBLES.slice(0, HABITUALES)).map(
    (c) => {
      const on = c.k === estado.combustible;
      return `<button data-c="${c.k}" aria-pressed="${on}" class="flex min-h-14 flex-col items-center justify-center rounded-2xl px-1 py-2 ring-1 transition active:scale-95 ${
        on ? 'bg-blue-600 text-white ring-2 ring-blue-400 shadow-lg shadow-blue-600/40 scale-[1.03] dark:ring-blue-300' : c.suave + ' hover:brightness-95'
      }">
        <span class="text-base font-extrabold leading-tight">${c.corto}</span>
        <span class="text-[11px] font-medium leading-tight opacity-80">${c.sub}</span>
      </button>`;
    },
  ).join('');
  $('#radio').value = String(estado.radio);
  $('#solo-abiertas').checked = estado.soloAbiertas;
  document.querySelectorAll('.orden').forEach((b) => {
    b.className = `orden flex-1 rounded-xl px-3 text-sm font-semibold transition ${b.dataset.orden === estado.orden ? SEG_ON : SEG_OFF}`;
  });
  document.querySelectorAll('.vista').forEach((b) => {
    b.className = `vista rounded-xl px-5 py-2 text-base font-semibold transition ${b.dataset.vista === estado.vista ? SEG_ON : SEG_OFF}`;
  });
  $('#icono-refrescar').classList.toggle('girando', estado.cargando);
}

// Verde / ámbar / rojo para el precio relativo (semántico, se mantiene en ambos temas)
function colorPrecio(p, min, max) {
  const t = max > min ? (p - min) / (max - min) : 0;
  if (t < 0.34) return { txt: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', pill: 'bg-emerald-500 text-white' };
  if (t < 0.67) return { txt: 'text-amber-600 dark:text-amber-300', bg: 'bg-amber-400', pill: 'bg-amber-400 text-slate-950' };
  return { txt: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500', pill: 'bg-rose-500 text-white' };
}

function badgeAbierta(a) {
  if (a === true) return '<span class="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400"><span class="h-1.5 w-1.5 rounded-full bg-current"></span>Abierta</span>';
  if (a === false) return '<span class="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400"><span class="h-1.5 w-1.5 rounded-full bg-current"></span>Cerrada</span>';
  return '';
}

const urlRuta = (e) => `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}`;

function render() {
  renderControles();
  const todas = enRadio();
  const lista = visibles(todas);
  const c = estado.combustible;
  const hayDatos = !!estado.datos && !!estado.pos;

  // Estado (cargando / error / sin ubicación / vacío)
  let htmlEstado = '';
  if (!estado.pos && !estado.cargando) {
    htmlEstado = panelSinUbicacion();
  } else if (estado.cargando && !hayDatos) {
    htmlEstado = esqueleto();
  } else if (estado.error && !hayDatos) {
    htmlEstado = panel('⚠️', 'No se pudieron cargar los precios', esc(estado.error), boton('reintentar', 'Reintentar'));
  } else if (hayDatos && !lista.length) {
    const cerradas = todas.length && estado.soloAbiertas;
    htmlEstado = panel(
      '🔎',
      cerradas ? 'Todas cerradas ahora mismo' : 'Sin gasolineras en este radio',
      cerradas
        ? `Hay ${todas.length} en ${estado.radio} km, pero ninguna abierta según su horario.`
        : 'Prueba a ampliar el radio o cambiar de combustible.',
      cerradas ? boton('ver-cerradas', 'Ver también cerradas') : '',
    );
  }
  $('#estado').innerHTML = htmlEstado;

  const mostrar = hayDatos && lista.length > 0;
  $('#pestanas').classList.toggle('hidden', !mostrar);
  $('#pestanas').classList.toggle('flex', mostrar);
  $('#resumen').classList.toggle('hidden', !mostrar);
  $('#resumen').classList.toggle('grid', mostrar);
  $('#lista').classList.toggle('hidden', !mostrar || estado.vista !== 'lista');
  $('#mapa-wrap').classList.toggle('hidden', !mostrar || estado.vista !== 'mapa');

  if (estado.datos?.fecha) {
    $('#fecha-datos').textContent = `Precios actualizados: ${estado.datos.fecha}`;
    $('#info-fecha').textContent = ` · Actualizado el ${fechaBonita(estado.datos.fecha)}`;
    $('#info-datos').classList.replace('hidden', 'flex');
  }
  if (!mostrar) {
    $('#lista').innerHTML = '';
    return;
  }

  const precios = lista.map((e) => e.pr[c]);
  const min = Math.min(...precios);
  const max = Math.max(...precios);
  const media = precios.reduce((a, b) => a + b, 0) / precios.length;
  const masBarata = lista.find((e) => e.pr[c] === min);
  const ahorro = (media - min) * LITROS_DEPOSITO;

  $('#contador').innerHTML = `
    <span class="text-3xl font-extrabold tabular-nums tracking-tight text-fg">${lista.length}</span>
    <span class="font-semibold">${lista.length === 1 ? 'gasolinera' : 'gasolineras'}${estado.soloAbiertas ? ' abiertas' : ''}</span>
    <span class="mx-1 text-subtle">·</span>
    <span class="text-3xl font-extrabold tabular-nums tracking-tight text-blue-600 dark:text-blue-400">${estado.radio}</span>
    <span class="font-semibold">km</span>`;

  $('#resumen').innerHTML = `
    <div class="col-span-3 flex items-center gap-3 rounded-3xl bg-gradient-to-br from-blue-600 to-sky-500 p-4 text-white shadow-xl shadow-blue-600/25 sm:col-span-1 sm:block">
      <div class="min-w-0 flex-1">
        <p class="text-xs font-bold uppercase tracking-wider text-blue-100">Más barata</p>
        <p class="truncate text-base font-semibold">${esc(titulo(masBarata.n) || 'Gasolinera')} · ${km(masBarata.km)}</p>
      </div>
      <p class="text-4xl font-extrabold tabular-nums tracking-tight">${euro(min)}<span class="text-base font-bold">€</span></p>
    </div>
    <div class="col-span-3 grid grid-cols-2 gap-2 sm:col-span-2">
      <div class="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-line">
        <p class="text-xs font-bold uppercase tracking-wider text-muted">Precio medio</p>
        <p class="mt-1 text-3xl font-extrabold tabular-nums">${euro(media)}<span class="text-sm text-muted">€/L</span></p>
      </div>
      <div class="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-line">
        <p class="text-xs font-bold uppercase tracking-wider text-muted">Ahorro en ${LITROS_DEPOSITO} L</p>
        <p class="mt-1 text-3xl font-extrabold tabular-nums text-blue-600 dark:text-blue-400">${euro2(ahorro)}</p>
        <p class="text-xs text-subtle">vs. la media de la zona</p>
      </div>
    </div>`;

  $('#lista').innerHTML = lista
    .map((e, i) => {
      const p = e.pr[c];
      const col = colorPrecio(p, min, max);
      const dif = p - min;
      const otros = COMBUSTIBLES.filter((x) => x.k !== c && e.pr[x.k])
        .slice(0, 3)
        .map((x) => `<span class="rounded-md px-1.5 py-0.5 ring-1 ${x.suave}">${x.nombre} <b class="font-extrabold">${euro(e.pr[x.k])}</b></span>`)
        .join('');
      return `
      <li class="aparecer" style="animation-delay:${Math.min(i, 12) * 25}ms">
        <article class="relative overflow-hidden rounded-3xl bg-card p-4 shadow-sm ring-1 ring-line transition hover:ring-blue-400/60">
          <span class="absolute inset-y-0 left-0 w-1 ${col.bg}"></span>
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                ${i === 0 && estado.orden === 'precio' ? '<span class="rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-blue-600 dark:bg-blue-400/15 dark:text-blue-300">Top</span>' : ''}
                <h2 class="truncate text-lg font-bold">${esc(titulo(e.n) || 'Gasolinera')}</h2>
              </div>
              <p class="mt-0.5 truncate text-base text-muted">${esc(direccion(e))}</p>
              <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span class="inline-flex items-center gap-1 text-xl font-extrabold tabular-nums text-blue-600 dark:text-blue-400">
                  <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg>${km(e.km)}
                </span>
                ${badgeAbierta(e.abierta)}
                <span class="truncate" title="${esc(e.h)}">${esc(e.h)}</span>
              </div>
            </div>
            <div class="text-right">
              <p class="text-3xl font-extrabold tabular-nums tracking-tight ${col.txt}">${euro(p)}<span class="text-sm">€</span></p>
              <p class="text-sm tabular-nums text-subtle">${dif > 0.0005 ? '+' + euro(dif) + ' €' : 'el mejor precio'}</p>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-between gap-2">
            <div class="flex min-w-0 flex-wrap gap-1.5 text-xs">${otros}</div>
            <a href="${urlRuta(e)}" target="_blank" rel="noopener" class="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-base font-bold text-white shadow transition hover:bg-blue-500">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 19-9-9 19-2-8-8-2z"/></svg>Ir
            </a>
          </div>
        </article>
      </li>`;
    })
    .join('');

  if (estado.vista === 'mapa') renderMapa(lista, min, max).catch((e) => console.error('[mapa]', e));
}

const boton = (accion, texto) =>
  `<button data-accion="${accion}" class="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-500">${texto}</button>`;

function panel(icono, tituloTxt, texto, extra = '') {
  return `<div class="aparecer rounded-3xl bg-card p-8 text-center shadow-sm ring-1 ring-line">
    <div class="text-4xl">${icono}</div>
    <h2 class="mt-3 text-xl font-bold">${tituloTxt}</h2>
    <p class="mt-1 text-base text-muted">${texto}</p>${extra}</div>`;
}

function panelSinUbicacion() {
  return panel(
    '📍',
    'Necesitamos tu ubicación',
    `${esc(estado.motivoSinUbicacion || '')} Activa la ubicación o busca una localidad o código postal.`,
    `${boton('ubicar', 'Usar mi ubicación')}
     <form id="form-buscar" class="mx-auto mt-4 flex max-w-sm gap-2">
       <input name="q" required placeholder="Ej.: Valencia o 28013" class="min-w-0 flex-1 rounded-xl bg-field px-3 py-2 text-sm ring-1 ring-line placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-blue-500" />
       <button class="rounded-xl bg-field px-4 py-2 text-sm font-semibold ring-1 ring-line hover:text-blue-600">Buscar</button>
     </form>
     <p id="error-buscar" class="mt-2 text-xs text-rose-500"></p>`,
  );
}

function esqueleto() {
  const fila = `<div class="h-28 animate-pulse rounded-3xl bg-card ring-1 ring-line"></div>`;
  return `<div class="space-y-2.5"><p class="px-1 text-base text-muted">Buscando las gasolineras más baratas cerca de ti…</p>${fila.repeat(4)}</div>`;
}

// ---------- Mapa (Leaflet, carga perezosa) ----------
// Teselas de OpenStreetMap (sin clave). En tema oscuro se invierten por CSS (.dark .leaflet-tile-pane)
const TESELAS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
let L = null;
let mapa = null;
let capaMarcadores = null;
let iniciando = null;

// Crea el mapa una sola vez (aunque render() se llame varias veces mientras carga Leaflet)
function iniciarMapa() {
  iniciando ??= (async () => {
    L = (await import('leaflet')).default;
    const { lat, lon } = estado.pos;
    mapa = L.map('mapa', { zoomControl: false }).setView([lat, lon], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(mapa);
    L.tileLayer(TESELAS, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    capaMarcadores = L.layerGroup().addTo(mapa);
  })();
  return iniciando;
}

async function renderMapa(lista, min, max) {
  await iniciarMapa();
  // El contenedor puede haber cambiado de tamaño o estado mientras estaba oculto
  mapa.invalidateSize();
  capaMarcadores.clearLayers();

  const { lat, lon } = estado.pos;
  const centro = L.latLng(lat, lon);
  L.circle(centro, { radius: estado.radio * 1000, color: '#3b82f6', weight: 1.5, fillOpacity: 0.06 }).addTo(capaMarcadores);
  L.marker(centro, {
    icon: L.divIcon({
      className: '',
      iconSize: [20, 20],
      html: '<div class="h-5 w-5 rounded-full bg-blue-600 shadow-lg ring-4 ring-blue-500/30 border-2 border-white"></div>',
    }),
    zIndexOffset: 1000,
  }).addTo(capaMarcadores);

  const c = estado.combustible;
  // Pintamos primero las caras para que las baratas queden encima
  [...lista].sort((a, b) => b.pr[c] - a.pr[c]).forEach((e) => {
    const col = colorPrecio(e.pr[c], min, max);
    const icono = L.divIcon({
      className: 'pin-precio',
      html: `<div class="rounded-lg px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums shadow-lg ring-1 ring-black/20 ${col.pill}">${euro(e.pr[c])}</div>`,
    });
    L.marker([e.lat, e.lon], { icon: icono })
      .bindPopup(
        `<p class="font-bold">${esc(titulo(e.n))}</p>
         <p class="text-sm text-muted">${esc(direccion(e))}</p>
         <p class="mt-1 text-lg font-extrabold ${col.txt}">${euro(e.pr[c])} €/L <span class="text-xs font-normal text-muted">· ${km(e.km)}</span></p>
         <a class="mt-1 inline-block text-xs font-bold text-blue-600 dark:text-blue-400" href="${urlRuta(e)}" target="_blank" rel="noopener">Cómo llegar →</a>`,
      )
      .addTo(capaMarcadores);
  });
  // Encuadre del círculo del radio (sin depender de que el círculo esté ya proyectado)
  mapa.fitBounds(centro.toBounds(estado.radio * 2000), { padding: [10, 10] });
}

// ---------- Eventos ----------
$('#combustibles').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-c]');
  if (!b) return;
  estado.combustible = b.dataset.c;
  guardarPrefs();
  render();
});
$('#btn-mas-combustibles').addEventListener('click', () => {
  verTodosCombustibles = !verTodosCombustibles;
  renderControles();
});
$('#radio').addEventListener('change', (ev) => {
  estado.radio = Number(ev.target.value);
  guardarPrefs();
  cargar();
});
$('#solo-abiertas').addEventListener('change', (ev) => {
  estado.soloAbiertas = ev.target.checked;
  guardarPrefs();
  render();
});
document.querySelectorAll('.orden').forEach((b) =>
  b.addEventListener('click', () => {
    estado.orden = b.dataset.orden;
    guardarPrefs();
    render();
  }),
);
document.querySelectorAll('.vista').forEach((b) =>
  b.addEventListener('click', () => {
    estado.vista = b.dataset.vista;
    guardarPrefs();
    render();
  }),
);
$('#btn-refrescar').addEventListener('click', () => (estado.pos ? cargar({ forzar: true }) : pedirUbicacion()));
$('#ubicacion').addEventListener('click', pedirUbicacion);

$('#estado').addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-accion]')?.dataset.accion;
  if (a === 'ubicar') pedirUbicacion();
  if (a === 'reintentar') cargar({ forzar: true });
  if (a === 'ver-cerradas') {
    estado.soloAbiertas = false;
    guardarPrefs();
    render();
  }
});
$('#estado').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = new FormData(ev.target).get('q');
  const err = $('#error-buscar');
  err.textContent = 'Buscando…';
  try {
    estado.pos = await buscarLugar(q);
    $('#ubicacion-texto').textContent = estado.pos.etiqueta;
    cargar({ forzar: true });
  } catch (e) {
    err.textContent = e.message;
  }
});

// Volver arriba
const btnArriba = $('#btn-arriba');
const mostrarArriba = () => {
  const ver = scrollY > 500;
  btnArriba.classList.toggle('opacity-0', !ver);
  btnArriba.classList.toggle('pointer-events-none', !ver);
  btnArriba.classList.toggle('translate-y-4', !ver);
};
addEventListener('scroll', mostrarArriba, { passive: true });
btnArriba.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
mostrarArriba();

// Instalación PWA
let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalar = e;
  $('#btn-instalar').classList.remove('hidden');
});
$('#btn-instalar').addEventListener('click', async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  $('#btn-instalar').classList.add('hidden');
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

// Arranque
aplicarTema();
render();
pedirUbicacion();
