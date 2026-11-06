// Función serverless de Vercel: GET /api/estaciones?lat=..&lon=..&radio=..
import { handler } from '../lib/estaciones.js';

export const config = { maxDuration: 30 };

export default handler;
