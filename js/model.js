// Normalización de las respuestas de ESPN y armado de las listas de partidos.
// Todo lo que depende del formato de ESPN está acá: si la API cambia, se arregla en este archivo.

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// ---------- Partidos ----------

// Estados de ESPN que no son ni "en juego" ni "terminado" normal
const OFF_STATUSES = new Set(['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_SUSPENDED', 'STATUS_ABANDONED', 'STATUS_FORFEIT', 'STATUS_DELAYED']);

function normalizeSide(c) {
  const team = c?.team || {};
  const score = c?.score;
  return {
    id: team.id || null,
    name: team.displayName || team.name || '?',
    short: team.shortDisplayName || team.abbreviation || team.name || '?',
    abbr: team.abbreviation || '',
    logo: team.logo || team.logos?.[0]?.href || null,
    score: score === undefined || score === null || score === '' ? null : Number(score),
    winner: c?.winner === true,
    record: c?.records?.find((r) => r.type === 'total')?.summary || null,
  };
}

export function normalizeMatch(e) {
  const comp = e.competitions?.[0] || {};
  const st = e.status || comp.status || {};
  const type = st.type || {};
  const competitors = comp.competitors || [];
  let status = 'scheduled';
  if (OFF_STATUSES.has(type.name)) status = 'off';
  else if (type.state === 'in') status = 'live';
  else if (type.state === 'post') status = 'final';
  return {
    id: String(e.id),
    date: e.date ? new Date(e.date).getTime() : null,
    timeValid: comp.timeValid !== false,
    status,
    statusName: type.name || '',
    detail: type.shortDetail || '',
    clock: st.displayClock || '',
    period: st.period || 0,
    note: comp.notes?.[0]?.headline || null,
    venue: comp.venue?.fullName || null,
    home: normalizeSide(competitors.find((c) => c.homeAway === 'home') || competitors[0]),
    away: normalizeSide(competitors.find((c) => c.homeAway === 'away') || competitors[1]),
  };
}

export function normalizeScoreboard(body) {
  if (!body || !Array.isArray(body.events)) throw new Error('scoreboard sin events');
  return body.events.map(normalizeMatch);
}

// Parámetros de cada pedido a /api/espn?path=scoreboard para cubrir
// desde pastDays atrás hasta nextDays adelante
export function scoreboardRequests(sport, now = new Date()) {
  const from = addDays(now, -sport.pastDays);
  const to = addDays(now, sport.nextDays);
  if (sport.fetchBy === 'day') {
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push({ dates: ymd(d) });
    return days;
  }
  const months = new Set([ymd(from).slice(0, 6), ymd(to).slice(0, 6)]);
  return [...months].map((m) => ({ dates: m, limit: 300 }));
}

// Separa en vivo / próximos / resultados dentro de la ventana del deporte
export function splitMatches(matches, sport, now = Date.now()) {
  const unique = [...new Map(matches.map((m) => [m.id, m])).values()];
  const from = now - sport.pastDays * 86400000;
  const to = now + sport.nextDays * 86400000;
  const live = unique.filter((m) => m.status === 'live').sort((a, b) => a.date - b.date);
  const upcoming = unique
    .filter((m) => m.status === 'scheduled' && (m.date ?? 0) <= to)
    .sort((a, b) => a.date - b.date);
  const past = unique
    .filter((m) => (m.status === 'final' || m.status === 'off') && (m.date ?? 0) >= from)
    .sort((a, b) => b.date - a.date);
  return { live, upcoming, past };
}

// ---------- Tablas ----------

// Solo se guardan las columnas que se muestran (más la de orden y la posición)
export function normalizeStandings(body, cfg) {
  const groups = body?.children?.length ? body.children : body?.standings ? [body] : null;
  if (!groups) throw new Error('standings sin grupos');
  const keys = new Set([cfg.sortBy, 'rank', ...cfg.columns.map((c) => c.key)]);
  return {
    // "2026-27 English Premier League" → "2026-27"
    season: groups[0].standings?.seasonDisplayName?.match(/^\d{4}(-\d{2})?/)?.[0] || null,
    groups: groups.map((g) => {
      const rows = (g.standings?.entries || []).map((en) => {
        const stats = {};
        for (const s of en.stats || []) {
          if (keys.has(s.name)) stats[s.name] = { v: s.value ?? null, d: s.displayValue ?? s.summary ?? '' };
        }
        const team = en.team || {};
        return {
          team: {
            id: team.id || null,
            name: team.displayName || team.name || '?',
            short: team.shortDisplayName || team.abbreviation || team.name || '?',
            logo: team.logos?.[0]?.href || null,
          },
          stats,
          note: en.note ? { color: en.note.color || null, text: en.note.description || '' } : null,
        };
      });
      const sortValue = (r) => r.stats[cfg.sortBy]?.v ?? r.stats.rank?.v ?? 999;
      rows.sort((a, b) => sortValue(a) - sortValue(b));
      return { name: g.name || body.name || '', rows };
    }),
  };
}

// ---------- Líderes ----------

export function normalizeLeaders(body, wanted) {
  const cats = body?.leaders?.categories;
  if (!Array.isArray(cats)) throw new Error('leaders sin categorías');
  return {
    season: body.requestedSeason?.displayName || null,
    categories: Object.keys(wanted)
      .map((name) => cats.find((c) => c.name === name))
      .filter(Boolean)
      .map((c) => ({
        name: c.name,
        abbr: c.abbreviation || '',
        leaders: (c.leaders || []).slice(0, 5).map((l) => ({
          name: l.athlete?.displayName || '?',
          photo: l.athlete?.headshot?.href || null,
          team: l.team?.abbreviation || '',
          value: typeof l.value === 'number' ? l.value : Number(l.value),
        })),
      })),
  };
}
