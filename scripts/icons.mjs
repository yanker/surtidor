// Genera los PNG de la PWA a partir de public/icon.svg  →  npm run icons
//  - Iconos (192, 512, maskable, apple-touch-icon)
//  - Pantallas de inicio (splash) de iOS, en claro y oscuro, para cada tamaño de iPhone/iPad,
//    e inserta las etiquetas <link rel="apple-touch-startup-image"> en index.html
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const svg = await readFile('public/icon.svg');
await mkdir('public/icons', { recursive: true });
await mkdir('public/splash', { recursive: true });

for (const [nombre, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(`public/icons/${nombre}.png`);
}

// Maskable: icono con margen de seguridad sobre fondo sólido
const interior = await sharp(svg, { density: 300 }).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b1730' } })
  .composite([{ input: interior, gravity: 'center' }])
  .png()
  .toFile('public/icons/maskable-512.png');

// ---------- Splash de iOS ----------
// [ancho CSS, alto CSS, densidad] en vertical
const PANTALLAS = [
  [440, 956, 3], // iPhone 16 Pro Max
  [402, 874, 3], // iPhone 16 Pro
  [430, 932, 3], // iPhone 14/15 Pro Max, 15/16 Plus
  [393, 852, 3], // iPhone 14/15 Pro, 15, 16
  [428, 926, 3], // iPhone 12/13 Pro Max, 14 Plus
  [390, 844, 3], // iPhone 12/13/14
  [375, 812, 3], // iPhone X/XS/11 Pro, 12/13 mini
  [414, 896, 3], // iPhone XS Max, 11 Pro Max
  [414, 896, 2], // iPhone XR, 11
  [414, 736, 3], // iPhone 8 Plus
  [375, 667, 2], // iPhone SE, 8
  [820, 1180, 2], // iPad Air
  [834, 1194, 2], // iPad Pro 11"
  [1024, 1366, 2], // iPad Pro 12.9"
  [768, 1024, 2], // iPad mini / clásico
];

const TEMAS = {
  claro: { fondo: '#eef3fb', texto: '#0b1730', sub: '#5b6b85', media: '(prefers-color-scheme: light)' },
  oscuro: { fondo: '#030a1a', texto: '#e8efff', sub: '#94a6c6', media: '(prefers-color-scheme: dark)' },
};

// En el splash, el icono sin el marco oscuro exterior
const svgSplash = Buffer.from(svg.toString().replace(/<rect width="512"[^>]*\/>/, ''));
const links = [];
for (const [w, h, dpr] of PANTALLAS) {
  const W = w * dpr;
  const H = h * dpr;
  const lado = Math.round(Math.min(W, H) * 0.3);
  const icono = await sharp(svgSplash, { density: 600 }).resize(lado, lado).png().toBuffer();
  for (const [nombre, t] of Object.entries(TEMAS)) {
    const fichero = `splash/${nombre}-${W}x${H}.png`;
    const yIcono = Math.round(H / 2 - lado * 0.75);
    const tamTitulo = Math.round(lado * 0.26);
    const textos = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <text x="50%" y="${yIcono + lado + tamTitulo * 1.5}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif"
        font-weight="800" font-size="${tamTitulo}" fill="${t.texto}">Surtidor</text>
      <text x="50%" y="${yIcono + lado + tamTitulo * 2.4}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif"
        font-weight="500" font-size="${Math.round(tamTitulo * 0.42)}" fill="${t.sub}">Gasolineras baratas cerca de ti</text>
    </svg>`);
    await sharp({ create: { width: W, height: H, channels: 4, background: t.fondo } })
      .composite([
        { input: icono, left: Math.round((W - lado) / 2), top: yIcono },
        { input: textos, left: 0, top: 0 },
      ])
      .png({ compressionLevel: 9 })
      .toFile(`public/${fichero}`);
    links.push(
      `    <link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and ${t.media}" href="/${fichero}" />`,
    );
  }
}

// Inserta las etiquetas en index.html entre los marcadores
const html = await readFile('index.html', 'utf8');
const ini = '<!-- splash:inicio -->';
const fin = '<!-- splash:fin -->';
const bloque = `${ini}\n${links.join('\n')}\n    ${fin}`;
const nuevo = html.includes(ini)
  ? html.replace(new RegExp(`${ini}[\\s\\S]*?${fin}`), bloque)
  : html.replace('</head>', `    ${bloque}\n  </head>`);
await writeFile('index.html', nuevo);

console.log(`Iconos y ${links.length} pantallas de inicio generadas`);
