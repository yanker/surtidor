# Surtidor para Android (TWA)

La app de Android es una **Trusted Web Activity**: abre `https://surtidor.vercel.app` a pantalla completa con el Chrome del móvil. Lo que despliegues en Vercel llega a la app al instante, sin publicar una versión nueva en Google Play. Solo hay que publicar versión si cambia algo de esta carpeta (nombre, icono, colores, accesos directos…).

```
android/
├── twa-manifest.json   # Configuración de Bubblewrap (paquete, colores, icono, ubicación…)
├── play/               # Recursos para la ficha de Google Play
│   ├── icono-512.png
│   ├── imagen-destacada.png   (1024×500)
│   └── captura-1…5.png        (1080×1920)
└── README.md
```

> **Importante:** la clave de firma (`*.keystore`) y los paquetes generados (`.aab`, `.apk`) están en `.gitignore`. **Nunca los subas al repositorio** y guarda una copia de la clave y su contraseña en un sitio seguro: sin ella no podrás publicar actualizaciones.

## 1. Requisitos (una sola vez)

```bash
npm install -g @bubblewrap/cli
bubblewrap doctor
```

La primera vez, Bubblewrap ofrece descargar él mismo el **JDK 17** y el **SDK de Android**; responde que sí (no hace falta Android Studio).

## 2. Generar el proyecto y la clave

Desde esta carpeta:

```bash
cd android
bubblewrap update --skipVersionUpgrade
```

- Genera el proyecto Android (Gradle) a partir de `twa-manifest.json`.
- Si no existe `surtidor-upload.keystore`, te pedirá crear la **clave de subida**: nombre, organización, país (`ES`) y una contraseña. Apúntala.

## 3. Compilar

```bash
bubblewrap build
```

Te pedirá la contraseña de la clave y generará:

- `app-release-bundle.aab` → el que se sube a Google Play.
- `app-release-signed.apk` → para instalarlo directamente en tu móvil y probarlo (`adb install app-release-signed.apk` o pasándolo al teléfono).

## 4. Vincular la web con la app (Digital Asset Links)

Para que Android confíe en la web y **oculte la barra de dirección**, `public/.well-known/assetlinks.json` debe contener las huellas SHA-256 de las claves con las que se firma la app. Hay dos:

1. **Tu clave de subida** (para el APK de pruebas):
   ```bash
   bubblewrap fingerprint list
   ```
   o bien `keytool -list -v -keystore surtidor-upload.keystore -alias surtidor`.
2. **La clave de firma de Google Play** (la que lleva la app que se instala desde la tienda): en Play Console → *Prueba y publicación → Configuración → Integridad de la app → Firma de apps*, copia el «Certificado SHA-256».

Sustituye los dos valores `PENDIENTE:…` del archivo por esas huellas (formato `AB:CD:EF:…`), haz commit y despliega. Compruébalo en
`https://surtidor.vercel.app/.well-known/assetlinks.json` y con la herramienta de Google:
`https://developers.google.com/digital-asset-links/tools/generator`.

> Si la barra de dirección sigue apareciendo en la app, casi siempre es porque falta la huella de la clave de Google Play.

## 5. Publicar en Google Play

1. Cuenta de desarrollador en <https://play.google.com/console> (pago único de 25 $).
2. **Crear app** → nombre «Surtidor», idioma español, app gratuita.
3. **Prueba cerrada** (obligatoria en cuentas personales nuevas): sube el `.aab`, añade **al menos 12 testers** por su correo de Google y mantenla **14 días seguidos**. Después ya puedes pedir el acceso a producción.
4. Completa el **contenido de la app**:
   - **Política de privacidad:** `https://surtidor.vercel.app/privacidad`
   - **Anuncios:** no contiene anuncios.
   - **Acceso a la app:** toda la funcionalidad está disponible sin restricciones.
   - **Clasificación de contenido:** cuestionario → categoría «Utilidades / Productividad», sin contenido sensible.
   - **Público objetivo:** mayores de 18 años (es una app para conductores).
   - **Seguridad de los datos:** ver el apartado siguiente.
   - **Permisos de ubicación:** la app usa la ubicación **solo en primer plano**.
5. Rellena la **ficha de la tienda** con los textos y las imágenes de `play/`.

### Seguridad de los datos (formulario de Play)

- ¿Recoge o comparte datos de usuario? → **Sí, ubicación aproximada y precisa**, porque se envían al servidor para buscar gasolineras y calcular rutas.
  - **Recogida:** sí. **Compartición con terceros:** no.
  - **Tratamiento efímero:** sí (no se guarda).
  - **Obligatorio u opcional:** opcional (se puede buscar por localidad).
  - **Finalidad:** funcionalidad de la app.
- ¿Los datos se cifran en tránsito? → **Sí** (HTTPS).
- ¿Se pueden eliminar? → No se guardan datos en ningún servidor.
- Ningún otro tipo de dato (nada personal, financiero, de actividad, identificadores…).

## 6. Actualizar la app

- **Cambios en la web:** basta con desplegar en Vercel.
- **Cambios en `twa-manifest.json`** (icono, nombre, colores, accesos directos): sube `appVersionCode` (+1) y `appVersionName`, ejecuta `bubblewrap update` y `bubblewrap build`, y sube el nuevo `.aab`.

---

## Textos de la ficha de Google Play

**Nombre de la app** (máx. 30):

```
Surtidor: gasolineras baratas
```

**Descripción breve** (máx. 80):

```
Gasolineras más baratas cerca de ti y en tu ruta, con precios oficiales.
```

**Descripción completa** (máx. 4000):

```
Surtidor te muestra al momento las gasolineras más baratas a tu alrededor y a lo largo de tu viaje, con los precios oficiales del Ministerio para la Transición Ecológica, actualizados cada media hora.

⛽ CERCA DE TI
• Usa tu ubicación y busca en un radio de 5 a 50 km, o escribe una localidad o código postal.
• Gasolina 95 y 98, E10, diésel, diésel premium, GLP, GNC y AdBlue.
• Ordena por precio o por distancia y filtra solo las gasolineras abiertas ahora.
• Te dice cuál es la más barata, el precio medio de la zona y cuánto ahorras llenando el depósito.
• Precios por colores: verde, ámbar o rojo según lo barata o cara que sea cada una.

🛣️ PLANIFICA TU VIAJE
• Indica origen y destino y elige entre las rutas posibles.
• Para cada ruta: kilómetros, duración, número de gasolineras y el precio más bajo.
• Solo las gasolineras a menos de 1, 2 o 5 km de la carretera, para no desviarte.
• Pulsa «Iniciar viaje» y el mapa te sigue: verás las gasolineras que te quedan por delante y cuántos kilómetros llevas.

🗺️ MAPA Y FICHA
• Mapa con el precio sobre cada gasolinera.
• Ficha con todos los precios, el horario y la dirección.
• Cómo llegar con Google Maps, Waze o Apple Maps, o compártela con quien quieras.

🔒 SIN ANUNCIOS NI SEGUIMIENTO
• Gratis, sin registro, sin publicidad y sin cookies.
• Tu ubicación solo se usa para buscar gasolineras y no se guarda.
• Tema claro y oscuro, y funciona sin conexión con los últimos precios consultados.

Los precios son los que comunica cada estación al Ministerio; confírmalos siempre en el surtidor.
```

**Categoría:** Mapas y navegación · **Etiquetas:** gasolineras, carburantes, precios, viaje, navegación.

**Imágenes:** `play/icono-512.png`, `play/imagen-destacada.png` y las cinco `play/captura-*.png` (teléfono).
