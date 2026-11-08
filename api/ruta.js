// Función serverless de Vercel: GET /api/ruta?o=lat,lon&d=lat,lon&desvio=2
import { handlerRuta } from '../lib/ruta.js';

export const config = { maxDuration: 30 };

export default handlerRuta;
