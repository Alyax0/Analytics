// Cliente de /api/espn con caché en localStorage.
// Se guarda lo ya normalizado (las respuestas crudas de ESPN pesan cientos de KB).
// Si la API falla y hay una copia guardada, se devuelve marcada como "stale".

import { t } from './i18n.js';

const CACHE_PREFIX = 'fl1_';

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key, entry) {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // sin espacio o storage bloqueado: seguimos sin caché
  }
}

// normalize(body) convierte la respuesta de ESPN al formato de js/model.js;
// si lanza, la respuesta se trata como inesperada.
export async function espnGet(league, path, params = {}, { ttl, force = false, normalize }) {
  const query = new URLSearchParams({ league, path, ...params });
  const key = CACHE_PREFIX + query;
  const cached = readCache(key);
  if (!force && cached && Date.now() - cached.at < ttl) {
    return { data: cached.data, at: cached.at, stale: false };
  }
  try {
    const res = await fetch(`/api/espn?${query}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || t('errors.status', { status: res.status }));
    let data;
    try {
      data = normalize(body);
    } catch (e) {
      console.warn('Respuesta inesperada de ESPN:', e);
      throw new Error(t('errors.unexpected'));
    }
    const entry = { at: Date.now(), data };
    writeCache(key, entry);
    return { data, at: entry.at, stale: false };
  } catch (e) {
    if (cached) return { data: cached.data, at: cached.at, stale: true, error: e.message };
    throw e;
  }
}
