// Interpreta horarios del Ministerio, p. ej.:
//   "L-D: 24H"
//   "L-V: 06:00-22:00; S: 07:30-15:30; D: 09:00-15:00"
//   "L-S: 08:00-14:00 y 16:00-19:00"
// Devuelve true (abierta), false (cerrada) o null (no se sabe).

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const aMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function diasDe(spec) {
  const [a, b] = spec.split('-').map((s) => s.trim());
  const i = DIAS.indexOf(a);
  const j = b ? DIAS.indexOf(b) : i;
  if (i < 0 || j < 0) return null;
  const out = [];
  for (let k = i; ; k = (k + 1) % 7) {
    out.push(k);
    if (k === j) break;
  }
  return out;
}

export function estaAbierta(horario, ahora = new Date()) {
  if (!horario) return null;
  const hoy = (ahora.getDay() + 6) % 7; // 0 = lunes
  const ayer = (hoy + 6) % 7;
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  let entendido = false;

  for (const bloque of horario.split(';')) {
    const m = bloque.trim().match(/^([LMXJVSD](?:\s*-\s*[LMXJVSD])?)\s*:\s*(.+)$/);
    if (!m) continue;
    const dias = diasDe(m[1]);
    if (!dias) continue;
    entendido = true;

    for (const tramo of m[2].split(/\s+y\s+|,/)) {
      const t = tramo.trim();
      if (/^24\s*H$/i.test(t)) {
        if (dias.includes(hoy)) return true;
        continue;
      }
      const r = t.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!r) continue;
      const ini = aMin(r[1]);
      let fin = aMin(r[2]);
      if (fin === 23 * 60 + 59) fin = 24 * 60;
      if (fin > ini) {
        if (dias.includes(hoy) && min >= ini && min < fin) return true;
      } else {
        // cruza la medianoche (p. ej. 22:00-06:00)
        if (dias.includes(hoy) && min >= ini) return true;
        if (dias.includes(ayer) && min < fin) return true;
      }
    }
  }
  return entendido ? false : null;
}
