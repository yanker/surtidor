import '@fontsource-variable/inter';
import './style.css';
import 'leaflet/dist/leaflet.css';
import { estaAbierta } from './horario.js';
import { UPSTREAM, compactar, filtrarCercanas, distanciaKm } from '../lib/estaciones.js';
import { DESVIOS, calcularViaje, prepararRuta, proyectar } from '../lib/ruta.js';
import { COMBUSTIBLES, combustible, iconoCombustible } from './combustibles.js';

// ---------- Configuración ----------
const LITROS_DEPOSITO = 50;
const CLAVE_PREFS = 'surtidor:prefs';
const CLAVE_TEMA = 'surtidor:tema';
const CLAVE_VIAJE = 'surtidor:viaje';

// ---------- Estado ----------
const guardado = leer(CLAVE_PREFS, {});
const estado = {
  pos: null, // { lat, lon, etiqueta }
  combustible: guardado.combustible || 'g95',
  radio: guardado.radio || 5,
  orden: guardado.orden || 'precio',
  soloAbiertas: guardado.soloAbiertas ?? true,
  vista: guardado.vista || 'lista',
  modo: guardado.modo === 'viaje' ? 'viaje' : 'cerca', // «Cerca de mí» o «Viaje»
  desvio: DESVIOS.includes(guardado.desvio) ? guardado.desvio : 2, // km máx. desde la carretera
  tramo: guardado.tramo ?? 0, // km por delante que se muestran en el viaje (0 = toda la ruta)
  datos: null, // { fecha, estaciones, radio, lat, lon }
  cargando: false,
  // Viaje: { origen, destino, desvio, fecha, rutas: [{ resumen, km, min, coords, estaciones }], elegida }
  viaje: leer(CLAVE_VIAJE, null),
  viajeCargando: false,
  viajeError: null,
  // Seguimiento en marcha: { lat, lon, precision, km (punto kilométrico), desvio, kmPintado }
  gps: null,
  siguiendo: false,
  centrar: true, // el mapa sigue al usuario mientras no lo mueva a mano
};
let ultimo = null; // { lista, min, max, media } de lo último pintado (para la ficha)
let enfocar = null; // id de gasolinera a centrar en el mapa
const marcadores = new Map(); // id → marcador de Leaflet

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
// En la cabecera de resultados: "de hoy, a las 13:21" o "del 06/11, a las 7:41"
const fechaCorta = (f) => {
  const r = String(f).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}:\d{2})/);
  if (!r) return `del ${fechaBonita(f)}`;
  const hoy = new Date();
  const esHoy = +r[1] === hoy.getDate() && +r[2] === hoy.getMonth() + 1 && +r[3] === hoy.getFullYear();
  return esHoy ? `de hoy, a las ${r[4]}` : `del ${r[1]}/${r[2]}, a las ${r[4]}`;
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
  const { combustible, radio, orden, soloAbiertas, vista, modo, desvio, tramo } = estado;
  try {
    localStorage.setItem(CLAVE_PREFS, JSON.stringify({ combustible, radio, orden, soloAbiertas, vista, modo, desvio, tramo }));
  } catch {}
}

// ---------- Tema claro / oscuro ----------
// Al abrir la app manda siempre el tema del sistema. El botón lo cambia solo
// mientras la pestaña siga abierta (sessionStorage), y si el sistema cambia
// de tema, la app vuelve a seguirlo.
const mqOscuro = matchMedia('(prefers-color-scheme: dark)');
const esOscuro = () => document.documentElement.dataset.theme === 'dark';

function aplicarTema() {
  let t = null;
  try {
    t = sessionStorage.getItem(CLAVE_TEMA);
  } catch {}
  const oscuro = t ? t === 'dark' : mqOscuro.matches;
  document.documentElement.dataset.theme = oscuro ? 'dark' : 'light';
  $('meta[name=theme-color]').content = token('--color-bg');
  $('#btn-tema').title = `Tema ${oscuro ? 'oscuro' : 'claro'}${t ? '' : ' (sistema)'}. Pulsa para cambiar`;
}

$('#btn-tema').addEventListener('click', () => {
  const nuevo = esOscuro() ? 'light' : 'dark';
  try {
    sessionStorage.setItem(CLAVE_TEMA, nuevo);
  } catch {}
  aplicarTema();
});
mqOscuro.addEventListener('change', () => {
  try {
    sessionStorage.removeItem(CLAVE_TEMA);
  } catch {}
  aplicarTema();
});

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
    // Con las gasolineras ya en pantalla es buen momento para invitar a instalar
    if (estado.datos && typeof programarAviso === 'function') programarAviso(2500);
  }
}

function enRadio() {
  if (estado.modo === 'viaje') return enRuta();
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

async function direccionDe(pos) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${pos.lat}&lon=${pos.lon}`,
  );
  return (await r.json()).address || {};
}

async function nombrarUbicacion(pos) {
  try {
    const a = await direccionDe(pos);
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
// Segmentos (modo, orden, vista): el elegido se levanta como una tarjeta; el azul queda para
// el combustible seleccionado y las acciones principales
const SEG_ON = 'bg-card text-fg shadow-sm ring-1 ring-line';
const SEG_OFF = 'text-muted hover:text-fg';

let tiraColocada = false;
function renderControles() {
  const tira = $('#combustibles');
  tira.innerHTML = COMBUSTIBLES.map((c) => {
    const on = c.k === estado.combustible;
    return `<button data-c="${c.k}" aria-pressed="${on}" title="${c.nombre}: ${c.sub}" class="flex min-h-16 min-w-[4.75rem] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 ring-1 transition-colors motion-safe:active:scale-95 ${
      on ? 'bg-accent text-accent-ink ring-accent' : 'bg-card text-fg ring-line hover:ring-accent/50'
    }">
        ${iconoCombustible(c, 'h-7 w-7')}
        <span class="text-sm font-bold leading-tight">${c.corto}</span>
      </button>`;
  }).join('');
  // En el móvil la tira se desliza: al abrir, el combustible guardado tiene que verse
  if (!tiraColocada) {
    tiraColocada = true;
    const b = tira.querySelector('[aria-pressed="true"]');
    if (b && b.offsetLeft + b.offsetWidth > tira.clientWidth) tira.scrollLeft = b.offsetLeft - 16;
  }
  $('#radio').value = String(estado.radio);
  $('#solo-abiertas').checked = estado.soloAbiertas;
  document.querySelectorAll('.orden').forEach((b) => {
    b.className = `orden flex-1 rounded-lg px-2.5 text-sm font-semibold transition-colors ${b.dataset.orden === estado.orden ? SEG_ON : SEG_OFF}`;
  });
  document.querySelectorAll('.vista').forEach((b) => {
    b.className = `vista rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${b.dataset.vista === estado.vista ? SEG_ON : SEG_OFF}`;
  });
  const viaje = estado.modo === 'viaje';
  document.querySelectorAll('.modo').forEach((b) => {
    const on = b.dataset.modo === estado.modo;
    b.setAttribute('aria-selected', String(on));
    b.className = `modo flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-2 py-2.5 text-base font-semibold transition-colors ${on ? SEG_ON : SEG_OFF}`;
  });
  $('#label-radio').classList.toggle('hidden', viaje);
  $('#label-tramo').classList.toggle('hidden', !viaje);
  $('#tramo').value = String(estado.tramo);
  $('#ubicacion').classList.toggle('hidden', viaje);
  $('#subtitulo-viaje').classList.toggle('hidden', !viaje);
  $('#icono-refrescar').classList.toggle('girando', estado.cargando || estado.viajeCargando);
}

// Verde / ámbar / rojo para el precio relativo (semántico, se mantiene en ambos temas)
function colorPrecio(p, min, max) {
  const t = max > min ? (p - min) / (max - min) : 0;
  if (t < 0.34) return { txt: 'text-barato', bg: 'bg-barato-fill', pill: 'bg-barato-fill text-on-barato' };
  if (t < 0.67) return { txt: 'text-medio', bg: 'bg-medio-fill', pill: 'bg-medio-fill text-on-medio' };
  return { txt: 'text-caro', bg: 'bg-caro-fill', pill: 'bg-caro-fill text-on-caro' };
}

function badgeAbierta(a) {
  if (a === true) return '<span class="inline-flex items-center gap-1 font-semibold text-barato"><span class="h-1.5 w-1.5 rounded-full bg-current"></span>Abierta</span>';
  if (a === false) return '<span class="inline-flex items-center gap-1 font-semibold text-caro"><span class="h-1.5 w-1.5 rounded-full bg-current"></span>Cerrada</span>';
  return '';
}

const urlRuta = (e) => `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}`;

function render() {
  renderControles();
  const todas = enRadio();
  const lista = visibles(todas);
  const c = estado.combustible;
  const viaje = estado.modo === 'viaje';
  const hayDatos = viaje ? !!rutaElegida() : !!estado.datos && !!estado.pos;
  renderViaje();

  // Estado (cargando / error / sin ubicación / vacío)
  let htmlEstado = '';
  if (viaje) {
    if (estado.viajeCargando) htmlEstado = esqueleto('Calculando rutas y buscando gasolineras por el camino…');
    else if (hayDatos && !lista.length) {
      const cerradas = todas.length && estado.soloAbiertas;
      htmlEstado = panel(
        'buscar',
        cerradas ? 'Todas cerradas ahora mismo' : 'Sin gasolineras en este tramo',
        cerradas
          ? `Hay ${todas.length} en este tramo, pero ninguna abierta según su horario.`
          : 'Prueba a ampliar el desvío o el tramo, o a cambiar de combustible.',
        cerradas ? boton('ver-cerradas', 'Ver también cerradas') : '',
      );
    }
  } else if (!estado.pos && !estado.cargando) {
    htmlEstado = panelSinUbicacion();
  } else if (estado.cargando && !hayDatos) {
    htmlEstado = esqueleto();
  } else if (estado.error && !hayDatos) {
    htmlEstado = panel('aviso', 'No se pudieron cargar los precios', esc(estado.error), boton('reintentar', 'Reintentar'));
  } else if (hayDatos && !lista.length) {
    const cerradas = todas.length && estado.soloAbiertas;
    htmlEstado = panel(
      'buscar',
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
  $('#lista').classList.toggle('hidden', !mostrar || estado.vista !== 'lista');
  $('#mapa-wrap').classList.toggle('hidden', !mostrar || estado.vista !== 'mapa');

  const fecha = viaje ? estado.viaje?.fecha : estado.datos?.fecha;
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
  ultimo = { lista, min, max, media };

  const n = lista.length;
  const donde = viaje
    ? `en ${Math.round(kmTramo())} km de ruta`
    : `a menos de ${estado.radio} km`;
  $('#contador').innerHTML = `
    <h2 class="text-2xl font-bold tracking-tight"><span class="tabular-nums">${n}</span> ${n === 1 ? 'gasolinera' : 'gasolineras'}</h2>
    <p class="text-sm text-muted">${estado.soloAbiertas ? (n === 1 ? 'Abierta, ' : 'Abiertas, ') : ''}${donde}${fecha ? `. Precios ${esc(fechaCorta(fecha))}` : ''}</p>`;

  // Por precio, la primera tarjeta ya es la más barata; por distancia se recuerda arriba cuál es
  const recordarBarata = estado.orden === 'distancia' && masBarata !== lista[0];
  $('#resumen').innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-card ring-1 ring-line">
      ${recordarBarata ? `
      <button type="button" data-ficha="${esc(masBarata.id)}" class="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-field">
        <span class="min-w-0 flex-1">
          <span class="block text-sm text-muted">La más barata</span>
          <span class="block truncate font-semibold">${esc(titulo(masBarata.n) || 'Gasolinera')}, ${viaje ? 'en ' : 'a '}${km(masBarata.km)}</span>
        </span>
        <span class="text-2xl font-extrabold tabular-nums text-barato">${euro(min)}<span class="text-sm font-bold">€</span></span>
      </button>` : ''}
      <dl class="grid grid-cols-2 divide-x divide-line">
        <div class="px-4 py-3">
          <dt class="text-sm text-muted">Precio medio</dt>
          <dd class="text-2xl font-extrabold tabular-nums">${euro(media)}<span class="text-sm font-bold text-muted">€/L</span></dd>
        </div>
        <div class="px-4 py-3">
          <dt class="text-sm text-muted">Ahorro en ${LITROS_DEPOSITO} L</dt>
          <dd class="text-2xl font-extrabold tabular-nums text-barato">${euro2(ahorro)}</dd>
          <dd class="text-xs text-muted">frente a la media de la ${viaje ? 'ruta' : 'zona'}</dd>
        </div>
      </dl>
    </div>`;

  $('#lista').innerHTML = lista
    .map((e, i) => {
      const p = e.pr[c];
      const col = colorPrecio(p, min, max);
      const dif = p - min;
      const nombre = esc(titulo(e.n) || 'Gasolinera');
      const otros = COMBUSTIBLES.filter((x) => x.k !== c && e.pr[x.k])
        .slice(0, 3)
        .map((x) => `<span class="inline-flex items-center gap-1 rounded-lg bg-field py-0.5 pl-1 pr-1.5 text-muted ring-1 ring-line" title="${x.nombre}">${iconoCombustible(x, 'h-4 w-4')}${x.corto} <b class="font-bold tabular-nums text-fg">${euro(e.pr[x.k])}</b></span>`)
        .join('');
      // Toda la tarjeta abre la ficha: el botón del nombre se estira sobre ella (::after).
      // «Ir» queda por encima y es un enlace aparte, sin anidar controles.
      return `
      <li class="aparecer" style="animation-delay:${Math.min(i, 12) * 25}ms">
        <article class="relative rounded-2xl bg-card p-4 ring-1 ring-line transition-shadow hover:ring-accent/50 has-[[data-ficha]:focus-visible]:ring-2 has-[[data-ficha]:focus-visible]:ring-accent-fg">
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-bold leading-snug">
                <button type="button" data-ficha="${esc(e.id)}" class="text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">${nombre}</button>
              </h3>
              <p class="mt-0.5 line-clamp-2 text-base leading-snug text-muted">${esc(direccion(e))}</p>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-3xl font-extrabold tabular-nums tracking-tight ${col.txt}">${euro(p)}<span class="text-sm font-bold">€</span></p>
              <p class="text-sm tabular-nums text-muted">${dif > 0.0005 ? '+' + euro(dif) + ' €' : 'la más barata'}</p>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span class="inline-flex items-center gap-1 font-semibold">
              <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 text-muted" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg>${viaje ? 'en ' : ''}${km(e.km)}
            </span>
            ${viaje ? `<span class="text-muted" title="Distancia desde la carretera">desvío ${km(e.dv)}</span>` : ''}
            ${badgeAbierta(e.abierta)}
            <span class="min-w-0 truncate text-muted" title="${esc(e.h)}">${esc(e.h)}</span>
          </div>
          <div class="mt-3 flex items-end justify-between gap-3">
            <div class="flex min-w-0 flex-wrap gap-1.5 text-xs">${otros}</div>
            <a href="${urlRuta(e)}" target="_blank" rel="noopener" aria-label="Cómo llegar a ${nombre}"
              class="relative z-10 ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent-soft px-4 py-2.5 text-sm font-bold text-accent-fg transition-colors hover:bg-accent hover:text-accent-ink">
              <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 19-9-9 19-2-8-8-2z"/></svg>Ir
            </a>
          </div>
        </article>
      </li>`;
    })
    .join('');

  if (estado.vista === 'mapa') renderMapa(lista, min, max).catch((e) => console.error('[mapa]', e));
}

const boton = (accion, texto) =>
  `<button data-accion="${accion}" class="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-blanco shadow-lg hover:bg-accent-hover">${texto}</button>`;

function panel(icono, tituloTxt, texto, extra = '') {
  return `<div class="aparecer rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-line">
    <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-field text-muted ring-1 ring-line">${svg(icono, 'h-7 w-7')}</div>
    <h2 class="mt-3 text-xl font-bold">${tituloTxt}</h2>
    <p class="mt-1 text-base text-muted">${texto}</p>${extra}</div>`;
}

function panelSinUbicacion() {
  return panel(
    'pin',
    'Necesitamos tu ubicación',
    `${esc(estado.motivoSinUbicacion || '')} Activa la ubicación o busca una localidad o código postal.`,
    `${boton('ubicar', 'Usar mi ubicación')}
     <form id="form-buscar" class="mx-auto mt-4 flex max-w-sm gap-2">
       <input name="q" required placeholder="Ej.: Valencia o 28013" class="min-w-0 flex-1 rounded-xl bg-field px-3 py-2 text-sm ring-1 ring-line-strong placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
       <button class="rounded-xl bg-field px-4 py-2 text-sm font-semibold ring-1 ring-line hover:text-accent-fg">Buscar</button>
     </form>
     <p id="error-buscar" class="mt-2 text-xs text-caro"></p>`,
  );
}

function esqueleto(texto = 'Buscando las gasolineras más baratas cerca de ti…') {
  const fila = `<div class="h-32 animate-pulse rounded-2xl bg-card ring-1 ring-line"></div>`;
  return `<div class="space-y-2"><p class="px-1 text-base text-muted">${texto}</p>${fila.repeat(4)}</div>`;
}

// ---------- Mapa (Leaflet, carga perezosa) ----------
// Teselas de OpenStreetMap (sin clave). En tema oscuro se invierten por CSS ([data-theme='dark'] .leaflet-tile-pane)
const token = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const TESELAS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
let L = null;
let mapa = null;
let capaMarcadores = null;
let iniciando = null;

// Crea el mapa una sola vez (aunque render() se llame varias veces mientras carga Leaflet)
function iniciarMapa() {
  iniciando ??= (async () => {
    L = (await import('leaflet')).default;
    const [lat, lon] = estado.pos ? [estado.pos.lat, estado.pos.lon] : rutaElegida()?.coords[0] || [40.4, -3.7];
    mapa = L.map('mapa', { zoomControl: false }).setView([lat, lon], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(mapa);
    L.tileLayer(TESELAS, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    capaMarcadores = L.layerGroup().addTo(mapa);
    // Muy alejado (ruta entera) las etiquetas de precio se amontonan: se pintan como puntos
    const ajustarZoom = () => mapa.getContainer().classList.toggle('mapa-lejos', mapa.getZoom() < 11);
    mapa.on('zoomend', ajustarZoom);
    ajustarZoom();
    // Si el usuario mueve el mapa durante el viaje, dejamos de seguirle hasta que pulse «Centrar»
    mapa.on('dragstart', () => {
      if (estado.siguiendo && estado.centrar) {
        estado.centrar = false;
        $('#btn-centrar').classList.replace('hidden', 'flex');
      }
    });
  })();
  return iniciando;
}

const puntoAzul = (clase = '') =>
  L.divIcon({
    className: '',
    iconSize: [20, 20],
    html: `<div class="h-5 w-5 rounded-full border-2 border-blanco bg-accent shadow-lg ring-4 ring-accent/30 ${clase}"></div>`,
  });
const banderita = (texto, clase) =>
  L.divIcon({
    className: 'pin-precio pin-top',
    html: `<div class="rounded-lg px-2 py-1 text-xs font-extrabold text-blanco shadow-lg ring-2 ring-blanco ${clase}">${texto}</div>`,
  });
let marcadorYo = null;

async function renderMapa(lista, min, max) {
  await iniciarMapa();
  // El contenedor puede haber cambiado de tamaño o estado mientras estaba oculto
  mapa.invalidateSize();
  capaMarcadores.clearLayers();
  marcadores.clear();
  marcadorYo = null;

  const viaje = estado.modo === 'viaje';
  const ruta = viaje && rutaElegida();
  let encuadre;
  if (ruta) {
    const v = estado.viaje;
    L.polyline(ruta.coords, { color: token('--color-accent'), weight: 9, opacity: 0.25 }).addTo(capaMarcadores);
    const linea = L.polyline(ruta.coords, { color: token('--color-accent'), weight: 5, opacity: 0.9 }).addTo(capaMarcadores);
    L.marker(ruta.coords[0], { icon: banderita(esc(nombreCorto(v.origen)), 'bg-origen'), zIndexOffset: 900 }).addTo(capaMarcadores);
    L.marker(ruta.coords.at(-1), { icon: banderita(esc(nombreCorto(v.destino)), 'bg-destino'), zIndexOffset: 900 }).addTo(capaMarcadores);
    if (estado.gps) {
      marcadorYo = L.marker([estado.gps.lat, estado.gps.lon], { icon: puntoAzul('animate-pulse'), zIndexOffset: 1000 }).addTo(capaMarcadores);
    }
    encuadre = linea.getBounds();
  } else {
    const { lat, lon } = estado.pos;
    const centro = L.latLng(lat, lon);
    L.circle(centro, { radius: estado.radio * 1000, color: token('--color-accent'), weight: 1.5, fillOpacity: 0.06 }).addTo(capaMarcadores);
    L.marker(centro, { icon: puntoAzul(), zIndexOffset: 1000 }).addTo(capaMarcadores);
    encuadre = centro.toBounds(estado.radio * 2000);
  }

  const c = estado.combustible;
  // Las 5 más baratas conservan la etiqueta aunque el mapa esté alejado
  const top = new Set([...lista].sort((a, b) => a.pr[c] - b.pr[c]).slice(0, 5).map((e) => e.id));
  // Pintamos primero las caras para que las baratas queden encima
  [...lista].sort((a, b) => b.pr[c] - a.pr[c]).forEach((e) => {
    const col = colorPrecio(e.pr[c], min, max);
    const icono = L.divIcon({
      className: top.has(e.id) ? 'pin-precio pin-top' : 'pin-precio',
      html: `<div class="rounded-lg px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums shadow-lg ring-1 ring-velo ${col.pill}">${euro(e.pr[c])}</div>`,
    });
    const m = L.marker([e.lat, e.lon], { icon: icono, zIndexOffset: top.has(e.id) ? 500 : 0 })
      .bindPopup(
        `<p class="font-bold">${esc(titulo(e.n))}</p>
         <p class="text-sm text-muted">${esc(direccion(e))}</p>
         <p class="mt-1 text-lg font-extrabold tabular-nums ${col.txt}">${euro(e.pr[c])} €/L</p>
         <p class="text-xs text-muted">${viaje ? `en ${km(e.km)}, desvío ${km(e.dv)}` : `a ${km(e.km)}`}</p>
         <div class="mt-1 flex gap-3 text-xs font-bold text-accent-fg">
           <button type="button" data-ficha="${esc(e.id)}" class="hover:underline">Ver detalles</button>
           <a href="${urlRuta(e)}" target="_blank" rel="noopener" class="hover:underline">Cómo llegar</a>
         </div>`,
      )
      .addTo(capaMarcadores);
    marcadores.set(e.id, m);
  });

  // Venimos de «Ver en el mapa» de la ficha: centramos en esa gasolinera
  const foco = enfocar && marcadores.get(enfocar);
  enfocar = null;
  if (foco) {
    mapa.setView(foco.getLatLng(), 16);
    foco.openPopup();
    return;
  }
  // En marcha: el mapa sigue al usuario. Si no, encuadre de la ruta o del círculo del radio
  if (ruta && estado.siguiendo && estado.gps && estado.centrar) {
    mapa.setView([estado.gps.lat, estado.gps.lon], Math.max(mapa.getZoom(), 12));
  } else {
    mapa.fitBounds(encuadre, { padding: [16, 16] });
  }
}

// Actualización ligera con cada posición del GPS (sin repintar todos los marcadores)
function moverYo() {
  if (!mapa || !estado.gps || estado.vista !== 'mapa') return;
  const ll = [estado.gps.lat, estado.gps.lon];
  if (marcadorYo) marcadorYo.setLatLng(ll);
  else marcadorYo = L.marker(ll, { icon: puntoAzul('animate-pulse'), zIndexOffset: 1000 }).addTo(capaMarcadores);
  if (estado.centrar) mapa.panTo(ll, { animate: true });
}

// ---------- Ficha ampliada de una gasolinera ----------
const dialogo = $('#ficha');
const ICONO = {
  cerrar: '<path d="M18 6 6 18M6 6l12 12"/>',
  ir: '<path d="m3 11 19-9-9 19-2-8-8-2z"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mapa: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  compartir: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  aviso: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.01"/>',
  copiar: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
};
const svg = (nombre, clase = 'h-5 w-5') =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" class="${clase} shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONO[nombre]}</svg>`;

const urlWaze = (e) => `https://waze.com/ul?ll=${e.lat},${e.lon}&navigate=yes`;
const urlApple = (e) => `https://maps.apple.com/?daddr=${e.lat},${e.lon}`;
const urlVer = (e) => `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lon}`;

// "L-V: 06:00-22:00; S: 08:00-14:00" → [["L-V", "06:00-22:00"], ["S", "08:00-14:00"]]
function tramosHorario(h) {
  return String(h || '')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const r = t.match(/^([^:]+?):\s*(.+)$/);
      return r ? [r[1], r[2].replace(/24H/i, 'Abierta 24 horas')] : ['', t];
    });
}

function htmlFicha(e) {
  const c = estado.combustible;
  const { lista, min, max } = ultimo;
  const enViaje = estado.modo === 'viaje';
  const p = e.pr[c];
  const col = colorPrecio(p, min, max);
  const puesto = lista.filter((x) => x.pr[c] < p - 0.0005).length + 1;
  const dif = p - min;
  const nombre = titulo(e.n) || 'Gasolinera';
  const linea2 = [e.cp, titulo(e.l), e.p && titulo(e.p) !== titulo(e.l) ? `(${titulo(e.p)})` : '']
    .filter(Boolean)
    .join(' ');

  const precios = COMBUSTIBLES.filter((x) => e.pr[x.k])
    .map((x) => {
      const sel = x.k === c;
      return `<li class="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 ring-1 ${sel ? 'bg-accent text-blanco ring-accent' : 'bg-field ring-line'}">
        ${iconoCombustible(x, 'h-7 w-7')}
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-bold">${x.nombre}</span>
          <span class="block truncate text-xs ${sel ? 'text-accent-ink/80' : 'text-muted'}">${sel ? 'Seleccionado' : x.sub}</span>
        </span>
        <span class="text-lg font-extrabold tabular-nums">${euro(e.pr[x.k])}<span class="text-xs">€</span></span>
      </li>`;
    })
    .join('');

  const horario = tramosHorario(e.h)
    .map(
      ([dias, horas]) => `<li class="flex justify-between gap-3 py-1.5">
        <span class="font-semibold">${esc(dias)}</span><span class="text-right tabular-nums text-muted">${esc(horas)}</span></li>`,
    )
    .join('');

  const accion = (href, icono, texto) =>
    `<a href="${href}" target="_blank" rel="noopener" class="flex flex-col items-center gap-1 rounded-2xl bg-field px-2 py-3 text-sm font-semibold ring-1 ring-line transition hover:text-accent-fg">${svg(icono)}${texto}</a>`;
  const accionBtn = (id, icono, texto) =>
    `<button type="button" data-accion-ficha="${id}" class="flex flex-col items-center gap-1 rounded-2xl bg-field px-2 py-3 text-sm font-semibold ring-1 ring-line transition hover:text-accent-fg">${svg(icono)}<span>${texto}</span></button>`;

  return `
    <div class="sticky top-0 z-10 bg-card/95 px-5 pt-3 pb-3 backdrop-blur">
      <div class="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line sm:hidden"></div>
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <h2 id="ficha-nombre" class="text-2xl font-extrabold leading-tight">${esc(nombre)}</h2>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span class="inline-flex items-center gap-1 font-semibold">${svg('pin', 'h-4 w-4 text-muted')}${enViaje ? `en ${km(e.km)} por la ruta` : `a ${km(e.km)}`}</span>
            ${enViaje ? `<span class="font-semibold text-muted">desvío ${km(e.dv)}</span>` : ''}
            ${badgeAbierta(e.abierta)}
          </div>
        </div>
        <button type="button" data-accion-ficha="cerrar" aria-label="Cerrar" class="-mr-1 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-field text-muted ring-1 ring-line hover:text-fg">${svg('cerrar')}</button>
      </div>
    </div>

    <div class="space-y-5 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <section class="rounded-3xl bg-field p-4 ring-1 ring-line">
        <p class="flex items-center gap-1.5 text-sm font-semibold text-muted">${iconoCombustible(combustible(c), 'h-5 w-5')}${combustible(c).nombre}</p>
        <div class="mt-1 flex items-end justify-between gap-3">
          <p class="text-5xl font-extrabold tabular-nums tracking-tight ${col.txt}">${euro(p)}<span class="text-lg">€/L</span></p>
          <p class="pb-1 text-right text-sm text-muted">
            <b class="text-fg">${puesto}.ª</b> más barata<br />de ${lista.length} ${enViaje ? 'en la ruta' : `en ${estado.radio} km`}
          </p>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div class="rounded-2xl bg-card px-3 py-2 ring-1 ring-line">
            <p class="text-xs text-muted">Llenar ${LITROS_DEPOSITO} L</p>
            <p class="text-lg font-extrabold tabular-nums">${euro2(p * LITROS_DEPOSITO)}</p>
          </div>
          <div class="rounded-2xl bg-card px-3 py-2 ring-1 ring-line">
            <p class="text-xs text-muted">Frente a la más barata</p>
            <p class="text-lg font-extrabold tabular-nums ${dif > 0.0005 ? 'text-caro' : 'text-barato'}">${dif > 0.0005 ? '+' + euro2(dif * LITROS_DEPOSITO) : 'Es la mejor'}</p>
          </div>
        </div>
      </section>

      <a href="${urlRuta(e)}" target="_blank" rel="noopener"
        class="flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-4 text-lg font-bold text-blanco shadow-lg transition hover:bg-accent-hover motion-safe:active:scale-[0.99]">
        ${svg('ir')}Cómo llegar
      </a>
      <div class="grid grid-cols-4 gap-2">
        ${accion(urlWaze(e), 'ir', 'Waze')}
        ${accion(urlApple(e), 'mapa', 'Apple')}
        ${accionBtn('mapa', 'pin', 'Ver mapa')}
        ${accionBtn('compartir', 'compartir', 'Compartir')}
      </div>

      <section>
        <h3 class="mb-2 text-sm font-semibold text-muted">Dirección</h3>
        <a href="${urlVer(e)}" target="_blank" rel="noopener" class="block rounded-2xl bg-field px-4 py-3 ring-1 ring-line transition hover:ring-accent/50">
          <p class="text-base font-semibold">${esc(titulo(e.d).replace(/[\s,]+$/, '') || 'Sin dirección')}</p>
          ${linea2 ? `<p class="text-sm text-muted">${esc(linea2)}</p>` : ''}
        </a>
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold text-muted">Precios</h3>
        <ul class="grid gap-2 sm:grid-cols-2">${precios}</ul>
      </section>

      ${horario ? `<section>
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted">${svg('reloj', 'h-4 w-4')}Horario</h3>
        <ul class="divide-y divide-line rounded-2xl bg-field px-4 py-1 text-base ring-1 ring-line">${horario}</ul>
      </section>` : ''}

      <p class="text-center text-xs text-subtle">
        Datos del Ministerio para la Transición Ecológica${estado.datos?.fecha ? `, actualizados el ${esc(fechaBonita(estado.datos.fecha))}` : ''}.<br />
        Precios orientativos; confírmalos en el surtidor.
      </p>
    </div>`;
}

let fichaActual = null;
function abrirFicha(id) {
  const e = ultimo?.lista.find((x) => String(x.id) === String(id));
  if (!e) return;
  fichaActual = e;
  $('#ficha-contenido').innerHTML = htmlFicha(e);
  $('#ficha-contenido').scrollTop = 0;
  if (!dialogo.open) {
    dialogo.showModal();
    // El botón «atrás» del móvil cierra la ficha en vez de salir de la app
    history.pushState({ ficha: true }, '');
  }
  mapa?.closePopup();
}

function cerrarFicha() {
  if (!dialogo.open) return;
  dialogo.close();
}
dialogo.addEventListener('close', () => {
  if (history.state?.ficha) history.back();
});
addEventListener('popstate', () => {
  if (dialogo.open) dialogo.close();
});
// Pulsar fuera (en el fondo) cierra
dialogo.addEventListener('click', (ev) => {
  if (ev.target === dialogo) cerrarFicha();
});

async function compartirFicha(boton) {
  const e = fichaActual;
  const c = combustible(estado.combustible);
  const texto = `${titulo(e.n)} · ${c.nombre} a ${euro(e.pr[c.k])} €/L\n${direccion(e)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: titulo(e.n), text: texto, url: urlVer(e) });
      return;
    }
    await navigator.clipboard.writeText(`${texto}\n${urlVer(e)}`);
    const span = boton.querySelector('span');
    span.textContent = '¡Copiado!';
    setTimeout(() => (span.textContent = 'Compartir'), 2000);
  } catch {
    /* compartir cancelado */
  }
}

dialogo.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-accion-ficha]');
  if (!b) return;
  const a = b.dataset.accionFicha;
  if (a === 'cerrar') cerrarFicha();
  if (a === 'compartir') compartirFicha(b);
  if (a === 'mapa') {
    enfocar = fichaActual.id;
    cerrarFicha();
    estado.vista = 'mapa';
    guardarPrefs();
    render();
    $('#mapa-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

// Abrir la ficha: tarjeta de la lista (salvo el botón «Ir») o «Ver detalles» del mapa
$('#resumen').addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-ficha]');
  if (t) abrirFicha(t.dataset.ficha);
});
$('#lista').addEventListener('click', (ev) => {
  if (ev.target.closest('a')) return;
  const t = ev.target.closest('[data-ficha]');
  if (t) abrirFicha(t.dataset.ficha);
});
document.addEventListener(
  'click',
  (ev) => {
    const t = ev.target.closest('.leaflet-popup [data-ficha]');
    if (t) abrirFicha(t.dataset.ficha);
  },
  true,
);

// ---------- Viaje: planificar ruta y gasolineras por el camino ----------
// Origen y destino → rutas alternativas (OSRM) → se elige una → lista y mapa con las gasolineras
// a menos de «desvío» km de la carretera. Con «Iniciar viaje» se sigue la posición (GPS) y se
// muestran solo las que quedan por delante.
let preparada = null; // { ruta, prep } para no recalcular la rejilla en cada posición
let watchId = null;
let wakeLock = null;

function rutaElegida() {
  const v = estado.viaje;
  return v && v.elegida != null ? v.rutas[v.elegida] || null : null;
}
function rutaPreparada() {
  const r = rutaElegida();
  if (!r) return null;
  if (preparada?.ruta !== r) preparada = { ruta: r, prep: prepararRuta(r.coords) };
  return preparada.prep;
}
const kmActual = () => (estado.siguiendo && estado.gps?.km != null ? estado.gps.km : 0);
function kmTramo() {
  const r = rutaElegida();
  if (!r) return 0;
  const resto = Math.max(0, (rutaPreparada()?.total ?? r.km) - kmActual());
  return estado.tramo ? Math.min(estado.tramo, resto) : resto;
}
// Gasolineras de la ruta elegida que quedan por delante (km = distancia por carretera)
function enRuta() {
  const r = rutaElegida();
  if (!r) return [];
  const base = kmActual();
  const hasta = estado.tramo ? base + estado.tramo : Infinity;
  const ahora = new Date();
  const c = estado.combustible;
  return r.estaciones
    .filter((e) => e.pr[c] && e.a >= base - 0.3 && e.a <= hasta)
    .map((e) => ({ ...e, km: Math.max(0, e.a - base), abierta: estaAbierta(e.h, ahora) }));
}

const nombreCorto = (lugar) => String(lugar?.etiqueta || '').split(',')[0].trim() || '—';
const duracion = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);
function guardarViaje() {
  try {
    if (estado.viaje) localStorage.setItem(CLAVE_VIAJE, JSON.stringify(estado.viaje));
    else localStorage.removeItem(CLAVE_VIAJE);
  } catch {}
}

// Resumen de una ruta con el combustible y filtros actuales
function datosRuta(r) {
  const c = estado.combustible;
  const ahora = new Date();
  const est = r.estaciones.filter((e) => e.pr[c] && (!estado.soloAbiertas || estaAbierta(e.h, ahora) !== false));
  if (!est.length) return { n: 0 };
  const precios = est.map((e) => e.pr[c]);
  return { n: est.length, min: Math.min(...precios), media: precios.reduce((a, b) => a + b, 0) / precios.length };
}

function renderViaje() {
  const enViaje = estado.modo === 'viaje';
  $('#panel-viaje').classList.toggle('hidden', !enViaje);
  if (!enViaje) return;
  const v = estado.viaje;
  const elegida = rutaElegida();
  const planificando = !elegida || estado.planificando;

  $('#form-viaje').classList.toggle('hidden', !planificando);
  $('#desvio').value = String(estado.desvio);
  $('#btn-buscar-rutas').disabled = estado.viajeCargando;
  const err = $('#error-viaje');
  err.textContent = estado.viajeError || '';
  err.classList.toggle('hidden', !estado.viajeError);

  // Opciones de ruta
  if (planificando && v?.rutas?.length && !estado.viajeCargando) {
    const datos = v.rutas.map(datosRuta);
    const mejorPrecio = Math.min(...datos.map((d) => d.min ?? Infinity));
    $('#rutas').innerHTML = `
      <p class="px-1 text-sm font-semibold text-muted">
        ${v.rutas.length === 1 ? 'Ruta encontrada' : `${v.rutas.length} rutas`} de <b class="text-fg">${esc(nombreCorto(v.origen))}</b> a <b class="text-fg">${esc(nombreCorto(v.destino))}</b>. Elige una
      </p>
      ${v.rutas
        .map((r, i) => {
          const d = datos[i];
          const sel = i === v.elegida;
          const etiquetas = [
            i === 0 ? '<span class="rounded-full bg-accent-soft px-2 py-0.5 text-accent-fg">Más rápida</span>' : '',
            v.rutas.length > 1 && d.min === mejorPrecio ? '<span class="rounded-full bg-barato/15 px-2 py-0.5 text-barato">Más barata</span>' : '',
          ].join('');
          return `<button type="button" data-ruta="${i}" class="aparecer block w-full rounded-2xl bg-card p-4 text-left shadow-sm ring-1 transition hover:ring-accent/50 motion-safe:active:scale-[0.99] ${sel ? 'ring-2 ring-accent' : 'ring-line'}" style="animation-delay:${i * 40}ms">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap gap-1.5 text-xs font-semibold">${etiquetas}</div>
                <p class="mt-1 text-lg font-bold leading-snug">${esc(r.resumen)}</p>
                <p class="flex gap-3 text-base text-muted"><b class="text-fg">${r.km.toLocaleString('es-ES', { maximumFractionDigits: 0 })} km</b><span>${duracion(r.min)}</span></p>
              </div>
              <div class="shrink-0 text-right">
                ${d.n ? `<p class="text-xs text-muted">desde</p><p class="text-2xl font-extrabold tabular-nums text-barato">${euro(d.min)}<span class="text-sm">€</span></p>` : ''}
              </div>
            </div>
            <div class="mt-2 flex items-center justify-between gap-2 text-sm">
              <span class="font-semibold text-muted">${d.n} ${d.n === 1 ? 'gasolinera' : 'gasolineras'}${estado.soloAbiertas ? ' abiertas' : ''} a menos de ${v.desvio} km</span>
              <span class="inline-flex items-center gap-0.5 font-bold text-accent-fg">${sel ? 'Elegida' : 'Elegir'}<svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>
            </div>
          </button>`;
        })
        .join('')}`;
  } else {
    $('#rutas').innerHTML = '';
  }

  // Barra del viaje elegido (y seguimiento en marcha)
  if (planificando) {
    $('#barra-viaje').innerHTML = '';
    return;
  }
  const total = rutaPreparada()?.total ?? elegida.km;
  const llevas = Math.min(kmActual(), total);
  const g = estado.gps;
  let lineaGps = '';
  if (estado.siguiendo) {
    if (!g) lineaGps = 'Esperando la señal GPS…';
    else if (g.desvio != null && g.desvio > Math.max(1, estado.viaje.desvio))
      lineaGps = `Estás a ${km(g.desvio)} de la ruta. Si has cambiado de camino, planifica de nuevo.`;
  }
  $('#barra-viaje').innerHTML = `
    <div class="rounded-2xl bg-accent p-4 text-accent-ink">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-accent-ink/80">${estado.siguiendo ? 'En marcha' : 'Tu viaje'}</p>
          <p class="text-xl font-extrabold leading-tight">${esc(nombreCorto(v.origen))} → ${esc(nombreCorto(v.destino))}</p>
          <p class="text-sm text-accent-ink/80">${esc(elegida.resumen)}</p>
          <p class="flex gap-3 text-sm font-semibold"><span>${Math.round(elegida.km)} km</span><span>${duracion(elegida.min)}</span></p>
        </div>
        <button type="button" data-accion-viaje="cambiar" class="shrink-0 rounded-xl bg-blanco/15 px-3 py-2 text-sm font-bold ring-1 ring-blanco/30 hover:bg-blanco/25">Cambiar</button>
      </div>
      ${estado.siguiendo ? `
        <div class="mt-3">
          <div class="h-2 overflow-hidden rounded-full bg-blanco/25"><div class="h-full origin-left rounded-full bg-blanco transition-transform" style="transform:scaleX(${total ? llevas / total : 0})"></div></div>
          <p class="mt-1.5 flex justify-between text-sm font-semibold"><span>Llevas ${km(llevas)}</span><span>Quedan ${km(Math.max(0, total - llevas))}</span></p>
          ${lineaGps ? `<p class="mt-1 rounded-xl bg-blanco/15 px-3 py-2 text-sm">${lineaGps}</p>` : ''}
        </div>` : ''}
      <button type="button" data-accion-viaje="${estado.siguiendo ? 'detener' : 'iniciar'}"
        class="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-lg font-bold shadow transition motion-safe:active:scale-[0.99] ${estado.siguiendo ? 'bg-blanco/15 ring-1 ring-blanco/40 hover:bg-blanco/25' : 'bg-blanco text-accent hover:bg-blanco/90'}">
        ${estado.siguiendo
          ? '<svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Detener seguimiento'
          : '<svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 19-9-9 19-2-8-8-2z"/></svg>Iniciar viaje'}
      </button>
      <p class="mt-2 text-center text-xs text-accent-ink/80">${estado.siguiendo
        ? 'Se muestran las gasolineras que tienes por delante. La pantalla se mantiene encendida.'
        : 'Al iniciar, el mapa te sigue y te enseña las gasolineras que vas a encontrar.'}</p>
    </div>`;
}

function ubicacionActual() {
  return new Promise((ok, mal) => {
    if (!('geolocation' in navigator)) return mal(new Error('Tu navegador no permite geolocalización; escribe el origen.'));
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lugar = { lat: p.coords.latitude, lon: p.coords.longitude, etiqueta: 'Tu ubicación', gps: true };
        try {
          const a = await direccionDe(lugar);
          const nombre = a.city || a.town || a.village || a.municipality;
          if (nombre) lugar.etiqueta = nombre;
        } catch {}
        ok(lugar);
      },
      () => mal(new Error('No hemos podido obtener tu ubicación; escribe el origen.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
    );
  });
}

async function pedirViaje(o, d, desvio) {
  const q = `o=${o.lat.toFixed(4)},${o.lon.toFixed(4)}&d=${d.lat.toFixed(4)},${d.lon.toFixed(4)}&desvio=${desvio}`;
  // 1) Nuestra API: calcula rutas y gasolineras en el servidor (~150 KB)
  let r;
  try {
    r = await fetch(`/api/ruta?${q}`);
  } catch {}
  if (r?.headers.get('content-type')?.includes('json')) {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'No se pudo calcular la ruta');
    return j;
  }
  // 2) Plan B sin servidor: rutas desde OSRM y precios directamente del Ministerio (~12 MB)
  const rm = await fetch(UPSTREAM, { headers: { Accept: 'application/json' } });
  if (!rm.ok) throw new Error('El servicio del Ministerio no responde');
  const { fecha, estaciones } = compactar(await rm.json());
  return { fecha, desvio, rutas: await calcularViaje(o, d, desvio, estaciones) };
}

async function planificar() {
  const textoO = $('#viaje-origen').value.trim();
  const textoD = $('#viaje-destino').value.trim();
  if (!textoD) return $('#viaje-destino').focus();
  detenerSeguimiento();
  estado.viajeCargando = true;
  estado.viajeError = null;
  render();
  try {
    // Nominatim pide no más de una consulta por segundo: van una detrás de otra
    const origen = textoO ? await buscarLugar(textoO).catch(() => Promise.reject(new Error(`No encontramos «${textoO}»`))) : await ubicacionActual();
    const destino = await buscarLugar(textoD).catch(() => Promise.reject(new Error(`No encontramos «${textoD}»`)));
    const res = await pedirViaje(origen, destino, estado.desvio);
    if (!res.rutas?.length) throw new Error('No hay ninguna ruta por carretera entre esos dos puntos');
    estado.viaje = { origen, destino, desvio: res.desvio, fecha: res.fecha, rutas: res.rutas, elegida: res.rutas.length === 1 ? 0 : null };
    estado.planificando = res.rutas.length > 1;
    guardarViaje();
  } catch (e) {
    estado.viajeError = e.message || 'No se pudo planificar el viaje';
  } finally {
    estado.viajeCargando = false;
    render();
  }
}

// Mismo origen y destino con otro desvío o precios nuevos (se mantiene la ruta elegida)
async function recalcularViaje() {
  const v = estado.viaje;
  if (!v) return;
  estado.viajeCargando = true;
  estado.viajeError = null;
  render();
  try {
    const res = await pedirViaje(v.origen, v.destino, estado.desvio);
    const elegida = v.elegida != null && v.elegida < res.rutas.length ? v.elegida : null;
    estado.viaje = { ...v, desvio: res.desvio, fecha: res.fecha, rutas: res.rutas, elegida };
    guardarViaje();
  } catch (e) {
    estado.viajeError = e.message || 'No se pudo actualizar el viaje';
  } finally {
    estado.viajeCargando = false;
    render();
  }
}

function elegirRuta(i) {
  estado.viaje.elegida = i;
  estado.planificando = false;
  guardarViaje();
  render();
  $('#barra-viaje').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ----- Seguimiento con GPS -----
async function mantenerPantalla() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (estado.siguiendo && document.visibilityState === 'visible') mantenerPantalla();
});

function iniciarSeguimiento() {
  if (!('geolocation' in navigator)) {
    estado.viajeError = 'Tu navegador no permite geolocalización.';
    return render();
  }
  estado.siguiendo = true;
  estado.centrar = true;
  estado.gps = null;
  estado.vista = 'mapa';
  guardarPrefs();
  watchId = navigator.geolocation.watchPosition(nuevaPosicion, errorPosicion, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 30000,
  });
  mantenerPantalla();
  render();
  requestAnimationFrame(() => $('#mapa-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

function detenerSeguimiento() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (!estado.siguiendo) return;
  estado.siguiendo = false;
  estado.gps = null;
  $('#btn-centrar').classList.add('hidden');
  $('#btn-centrar').classList.remove('flex');
}

function nuevaPosicion(p) {
  const prep = rutaPreparada();
  if (!prep) return;
  const { latitude: lat, longitude: lon, accuracy } = p.coords;
  const previo = estado.gps;
  // Partiendo del último punto kilométrico conocido evitamos «saltar» a tramos anteriores de la ruta
  const pr = proyectar(prep, lat, lon, { desdeKm: previo?.km != null ? previo.km - 5 : -Infinity });
  estado.gps = {
    lat,
    lon,
    precision: accuracy,
    km: pr && pr.desvio < 5 ? pr.km : previo?.km ?? 0,
    desvio: pr?.desvio ?? null,
    kmPintado: previo?.kmPintado,
  };
  // Repintamos lista y marcadores cada 0,5 km de avance; entre medias solo se mueve el punto azul
  if (!previo || Math.abs(estado.gps.km - (previo.kmPintado ?? -99)) >= 0.5) {
    estado.gps.kmPintado = estado.gps.km;
    render();
  } else {
    renderViaje();
    moverYo();
  }
}

function errorPosicion(err) {
  if (err.code === 1) {
    detenerSeguimiento();
    estado.viajeError = 'Has denegado el permiso de ubicación; sin él no podemos seguir tu viaje.';
    render();
  }
  // Sin señal o tiempo agotado: watchPosition sigue intentándolo
}

// ----- Eventos del viaje -----
$('#form-viaje').addEventListener('submit', (ev) => {
  ev.preventDefault();
  planificar();
});
$('#btn-intercambiar').addEventListener('click', () => {
  const o = $('#viaje-origen');
  const d = $('#viaje-destino');
  [o.value, d.value] = [d.value, o.value];
});
$('#desvio').addEventListener('change', (ev) => {
  estado.desvio = Number(ev.target.value);
  guardarPrefs();
  // Si ya hay rutas calculadas, se recalculan las gasolineras con el nuevo desvío
  if (estado.viaje && !estado.viajeCargando) recalcularViaje();
});
$('#tramo').addEventListener('change', (ev) => {
  estado.tramo = Number(ev.target.value);
  guardarPrefs();
  render();
});
$('#rutas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ruta]');
  if (b) elegirRuta(Number(b.dataset.ruta));
});
$('#barra-viaje').addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-accion-viaje]')?.dataset.accionViaje;
  if (a === 'cambiar') {
    estado.planificando = true;
    render();
    $('#panel-viaje').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (a === 'iniciar') iniciarSeguimiento();
  if (a === 'detener') {
    detenerSeguimiento();
    render();
  }
});
$('#btn-centrar').addEventListener('click', () => {
  estado.centrar = true;
  $('#btn-centrar').classList.add('hidden');
  $('#btn-centrar').classList.remove('flex');
  if (estado.gps && mapa) mapa.setView([estado.gps.lat, estado.gps.lon], Math.max(mapa.getZoom(), 13));
});
document.querySelectorAll('.modo').forEach((b) =>
  b.addEventListener('click', () => {
    if (estado.modo === b.dataset.modo) return;
    estado.modo = b.dataset.modo;
    guardarPrefs();
    if (estado.modo === 'cerca') {
      detenerSeguimiento();
      if (estado.pos) cargar();
      else pedirUbicacion();
    } else {
      render();
      if (!estado.viaje) $('#viaje-destino').focus();
    }
  }),
);
// Al volver a abrir la app con un viaje guardado, rellenamos el formulario
if (estado.viaje) {
  if (!estado.viaje.origen.gps) $('#viaje-origen').value = estado.viaje.origen.etiqueta;
  $('#viaje-destino').value = estado.viaje.destino.etiqueta;
}

// ---------- Eventos ----------
$('#combustibles').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-c]');
  if (!b) return;
  estado.combustible = b.dataset.c;
  guardarPrefs();
  render();
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
$('#btn-refrescar').addEventListener('click', () => {
  if (estado.modo === 'viaje') return estado.viaje ? recalcularViaje() : $('#viaje-destino').focus();
  estado.pos ? cargar({ forzar: true }) : pedirUbicacion();
});
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

// ---------- Invitación a instalar la PWA ----------
// - Chrome/Edge/Android: capturamos `beforeinstallprompt` y mostramos nuestra tarjeta con «Instalar».
// - iPhone/iPad: no hay evento, así que la tarjeta explica Compartir → «Añadir a pantalla de inicio».
// - No se muestra si ya está instalada; «Ahora no» la silencia una semana.
const CLAVE_AVISO = 'surtidor:aviso-instalar';
const SILENCIO_MS = 7 * 24 * 60 * 60 * 1000;
const esIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const yaInstalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let eventoInstalar = null;
let avisoPendiente = null; // { cuando, id }
let avisoMostrado = false;

const silenciada = () => {
  try {
    return Date.now() - Number(localStorage.getItem(CLAVE_AVISO) || 0) < SILENCIO_MS;
  } catch {
    return false;
  }
};
const puedeInstalarse = () => !yaInstalada() && (eventoInstalar || esIOS);

function mostrarAviso() {
  if (!puedeInstalarse()) return;
  $('#aviso-ios').classList.toggle('hidden', !esIOS || !!eventoInstalar);
  $('#aviso-instalar-btn').textContent = eventoInstalar ? 'Instalar' : 'Entendido';
  $('#aviso-instalar').classList.remove('hidden');
  btnArriba.style.bottom = `${$('#aviso-instalar').offsetHeight + 8}px`;
}
function ocultarAviso({ silenciar = false } = {}) {
  $('#aviso-instalar').classList.add('hidden');
  btnArriba.style.bottom = '';
  if (silenciar) {
    try {
      localStorage.setItem(CLAVE_AVISO, String(Date.now()));
    } catch {}
  }
}
function actualizarBotonCabecera() {
  $('#btn-instalar').classList.toggle('hidden', !puedeInstalarse());
}

// Se invita unos segundos después de mostrar las primeras gasolineras (o a los 8 s como tarde)
function programarAviso(ms) {
  if (avisoMostrado || silenciada() || !puedeInstalarse()) return;
  const cuando = Date.now() + ms;
  if (avisoPendiente && avisoPendiente.cuando <= cuando) return; // ya hay uno antes
  if (avisoPendiente) clearTimeout(avisoPendiente.id);
  avisoPendiente = {
    cuando,
    id: setTimeout(() => {
      avisoMostrado = true;
      mostrarAviso();
    }, ms),
  };
}

async function instalar() {
  if (eventoInstalar) {
    eventoInstalar.prompt();
    const { outcome } = await eventoInstalar.userChoice;
    eventoInstalar = null;
    ocultarAviso({ silenciar: outcome !== 'accepted' });
    actualizarBotonCabecera();
  } else {
    ocultarAviso({ silenciar: true }); // iOS: «Entendido»
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // sustituimos la mini-barra del navegador por nuestra tarjeta
  eventoInstalar = e;
  actualizarBotonCabecera();
  programarAviso(estado.datos ? 2500 : 8000);
});
window.addEventListener('appinstalled', () => {
  eventoInstalar = null;
  ocultarAviso({ silenciar: true });
  actualizarBotonCabecera();
});
$('#btn-instalar').addEventListener('click', () => (eventoInstalar ? instalar() : mostrarAviso()));
$('#aviso-instalar-btn').addEventListener('click', instalar);
$('#aviso-luego').addEventListener('click', () => ocultarAviso({ silenciar: true }));
$('#aviso-cerrar').addEventListener('click', () => ocultarAviso({ silenciar: true }));

actualizarBotonCabecera();
if (esIOS) programarAviso(8000);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

// Arranque
aplicarTema();
render();
// En modo viaje la ubicación se pide solo al planificar o al iniciar el seguimiento
if (estado.modo === 'cerca') pedirUbicacion();
