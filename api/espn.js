// Proxy a los endpoints públicos de ESPN (no oficiales, sin key).
//
// Uso: /api/espn?league=eng.1&path=scoreboard&dates=20261030
//      /api/espn?league=arg.1&path=scoreboard&dates=202610&limit=300   (mes entero)
//      /api/espn?league=nba&path=standings
//      /api/espn?league=arg.1&path=news&lang=es&region=ar
// Solo se aceptan las ligas, rutas y parámetros de las listas de abajo.
// La respuesta se cachea en el CDN de Vercel: todos los visitantes comparten
// la misma copia y ESPN recibe un pedido por URL cada tantos segundos.
// Como la API no es oficial puede cambiar sin aviso: el frontend tiene que
// tolerar errores y caer al modo demo.

// clave → deporte/liga en ESPN
const LEAGUES = {
  'eng.1': 'soccer/eng.1',
  'esp.1': 'soccer/esp.1',
  'ger.1': 'soccer/ger.1',
  'ita.1': 'soccer/ita.1',
  'fra.1': 'soccer/fra.1',
  'ned.1': 'soccer/ned.1',
  'mex.1': 'soccer/mex.1',
  'arg.1': 'soccer/arg.1',
  'uefa.champions': 'soccer/uefa.champions',
  'uefa.europa': 'soccer/uefa.europa',
  'conmebol.libertadores': 'soccer/conmebol.libertadores',
  nba: 'basketball/nba',
  mlb: 'baseball/mlb',
};

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const SITE_V3 = 'https://site.api.espn.com/apis/site/v3/sports';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports';

const DAY = /^\d{8}$/;
const MONTH = /^\d{6}$/;
const ID = /^\d{1,12}$/;
const SEASON = /^\d{4}$/;
const REGIONS = new Set(['us', 'mx', 'ar', 'es']);

// Validadores de parámetros por nombre
const PARAMS = {
  dates: (v) => DAY.test(v) || MONTH.test(v), // los rangos AAAAMMDD-AAAAMMDD dan 400 en ESPN
  event: (v) => ID.test(v),
  team: (v) => ID.test(v),
  season: (v) => SEASON.test(v),
  seasontype: (v) => v === '2' || v === '3', // 2 = temporada regular, 3 = playoffs
  lang: (v) => v === 'es' || v === 'en',
  region: (v) => REGIONS.has(v),
  limit: (v) => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 500,
};

// Los partidos de hace más de 2 días ya no cambian: se cachean 6 h.
// Con un mes entero cuenta el último día del mes.
function scoreboardTtl(params) {
  const day = params.get('dates');
  if (!day) return 30;
  const y = +day.slice(0, 4);
  const m = +day.slice(4, 6) - 1;
  const end = day.length === 6 ? Date.UTC(y, m + 1, 0) : Date.UTC(y, m, +day.slice(6, 8));
  return Date.now() - end > 2 * 86400 * 1000 ? 6 * 3600 : 30;
}

// ruta → URL de ESPN, segundos de caché y parámetros permitidos.
// `team` va en la ruta, no en la query.
const PATHS = {
  scoreboard: { url: (l) => `${SITE}/${l}/scoreboard`, ttl: scoreboardTtl, params: ['dates', 'limit'] },
  summary: { url: (l) => `${SITE}/${l}/summary`, ttl: 30, params: ['event'], required: ['event'] },
  standings: { url: (l) => `${STANDINGS}/${l}/standings`, ttl: 600, params: ['season'] },
  news: { url: (l) => `${SITE}/${l}/news`, ttl: 900, params: ['lang', 'region', 'limit'] },
  teams: { url: (l) => `${SITE}/${l}/teams`, ttl: 86400, params: [] },
  schedule: { url: (l, q) => `${SITE}/${l}/teams/${q.get('team')}/schedule`, ttl: 600, params: ['team', 'season'], required: ['team'] },
  leaders: { url: (l) => `${SITE_V3}/${l}/leaders`, ttl: 3600, params: ['season', 'seasontype'], only: ['nba', 'mlb'] },
};

function parse(query) {
  const { league, path } = query;
  if (!(league in LEAGUES) || !(path in PATHS)) return null;

  const route = PATHS[path];
  if (route.only && !route.only.includes(league)) return null;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === 'league' || key === 'path') continue;
    if (typeof value !== 'string' || !route.params.includes(key) || !PARAMS[key](value)) return null;
    params.set(key, value);
  }
  if (route.required && !route.required.every((k) => params.has(k))) return null;

  const base = route.url(LEAGUES[league], params);
  params.delete('team');
  const ttl = typeof route.ttl === 'function' ? route.ttl(params) : route.ttl;
  const qs = params.toString();
  return { url: base + (qs ? '?' + qs : ''), ttl, path };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const parsed = parse(req.query);
  if (!parsed) return res.status(400).json({ error: 'Liga, ruta o parámetro no permitidos' });

  try {
    const response = await fetch(parsed.url, { headers: { Accept: 'application/json' } });
    const text = await response.text().catch(() => '');
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // En los días sin partidos ESPN responde 200 con el cuerpo vacío
      if (response.ok && parsed.path === 'scoreboard' && !text.trim()) data = { events: [] };
    }

    if (!response.ok || !data) {
      res.setHeader('Cache-Control', 'no-store');
      // Los 5xx de ESPN y las respuestas que no son JSON no son culpa del cliente
      const status = response.status >= 500 || !data ? 502 : response.status;
      return res.status(status).json({ error: `ESPN respondió ${response.status}` });
    }

    res.setHeader('Cache-Control', `public, s-maxage=${parsed.ttl}, stale-while-revalidate=${parsed.ttl * 4}`);
    return res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'No se pudo contactar a ESPN' });
  }
}
