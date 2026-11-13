// Genera los PNG de la PWA a partir de public/icon.svg  →  npm run icons
//  - Iconos (192, 512, maskable, apple-touch-icon)
//  - Pantallas de inicio (splash) de iOS, en claro y oscuro, para cada tamaño de iPhone/iPad,
//    e inserta las etiquetas <link rel="apple-touch-startup-image"> en index.html
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const svg = await readFile('public/icon.svg');
await mkdir('public/icons', { recursive: true });
await mkdir('public/splash', { recursive: true });

for (const [nombre, size] of [['icon-192', 192], ['icon-512', 512]]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(`public/icons/${nombre}.png`);
}

// iOS y Android (maskable) recortan las esquinas por su cuenta: el icono va cuadrado,
// azul hasta el borde y sin transparencias (iOS pinta de negro lo transparente).
// El surtidor queda dentro de la zona segura del maskable (círculo del 80 %).
const cuadrado = Buffer.from(svg.toString().replace(/ rx="112"/, ''));
await sharp(cuadrado, { density: 300 }).resize(180, 180).flatten({ background: '#1c59e4' }).png().toFile('public/icons/apple-touch-icon.png');
await sharp(cuadrado, { density: 300 }).resize(512, 512).flatten({ background: '#1c59e4' }).png().toFile('public/icons/maskable-512.png');

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
  claro: { fondo: '#edf2fc', texto: '#0b152a', sub: '#57647b', media: '(prefers-color-scheme: light)' },
  oscuro: { fondo: '#02081b', texto: '#e7effc', sub: '#a7b5ce', media: '(prefers-color-scheme: dark)' },
};

// En el splash y en la imagen para compartir, el icono redondeado tal cual
const svgSplash = svg;
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

// ---------- Imagen para compartir en redes (Open Graph, 1200x630) ----------
{
  const W = 1200;
  const H = 630;
  const icono = await sharp(svgSplash, { density: 600 }).resize(260, 260).png().toBuffer();
  const capa = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#02081b"/>
    <g font-family="Segoe UI, Helvetica, Arial, sans-serif">
      <text x="430" y="270" font-size="104" font-weight="800" fill="#e7effc">Surtidor</text>
      <text x="434" y="340" font-size="40" font-weight="600" fill="#e7effc">Gasolineras baratas cerca de ti</text>
      <text x="434" y="400" font-size="28" font-weight="500" fill="#a7b5ce">Precios oficiales en tiempo real, sin cookies</text>
      <text x="434" y="500" font-size="30" font-weight="700" fill="#75b0ff">surtidor.vercel.app</text>
    </g>
  </svg>`);
  await sharp(capa)
    .composite([{ input: icono, left: 110, top: Math.round((H - 260) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile('public/og-image.png');
}

console.log(`Iconos, ${links.length} pantallas de inicio e imagen para compartir generadas`);
