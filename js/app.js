import { SPORTS, DEFAULT_SPORT } from './sports.js';
import { espnGet } from './api.js';
import {
  normalizeScoreboard, normalizeLatest, scoreboardRequests, splitMatches, normalizeStandings, normalizeLeaders,
  findChampion, monthOf,
} from './model.js';
import {
  esc, ago, dayLabel, matchRow, matchDays, standingsTable, leaderCard, seasonEndCard, skeletons, emptyState, errorState,
} from './ui.js';
import { t, setLang, preferredLang } from './i18n.js';

// Caché del navegador por tipo de dato (el CDN de Vercel cachea aparte)
const TTL = { recent: 60 * 1000, old: 6 * 3600 * 1000, standings: 10 * 60 * 1000, leaders: 3600 * 1000 };
// Con partidos en vivo se actualiza cada minuto; si no, cada 5
const REFRESH_LIVE = 60 * 1000;
const REFRESH_IDLE = 5 * 60 * 1000;
const LEAGUE_KEY = 'futbol_league';

// ===================== RUTAS =====================
// #/<deporte>[/<liga>][/<sección>]. La liga solo va en fútbol; la sección
// por defecto es la primera del deporte.

function savedLeague(sport) {
  if (sport.leagues.length === 1) return sport.leagues[0];
  try {
    const id = localStorage.getItem(LEAGUE_KEY);
    return sport.leagues.find((l) => l.id === id) || sport.leagues[0];
  } catch {
    return sport.leagues[0];
  }
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const sport = SPORTS[parts[0]] ? SPORTS[parts.shift()] : SPORTS[DEFAULT_SPORT];
  let league = sport.leagues.find((l) => l.id === parts[0]);
  if (league) parts.shift();
  else league = savedLeague(sport);
  const section = sport.sections.includes(parts[0]) ? parts[0] : sport.sections[0];
  return { sport, league, section };
}

function href(sport, league, section = sport.sections[0]) {
  const parts = [sport.id];
  if (sport.leagues.length > 1) parts.push(league.id);
  if (section !== sport.sections[0]) parts.push(section);
  return '#/' + parts.join('/');
}

let route = parseHash();

// ===================== DATOS =====================
// Una entrada por liga y tipo de dato: "eng.1|partidos", "nba|tabla"...

const store = new Map();
const entry = (leagueId, section) => {
  const key = `${leagueId}|${section}`;
  if (!store.has(key)) store.set(key, { status: 'idle', data: null, at: 0, stale: false, error: null, loading: false });
  return store.get(key);
};

// Un día que terminó hace más de 2 días ya no cambia
function isOld(dates) {
  const y = +dates.slice(0, 4);
  const m = +dates.slice(4, 6) - 1;
  const end = dates.length === 6 ? new Date(y, m + 1, 0) : new Date(y, m, +dates.slice(6, 8));
  return Date.now() - end.getTime() > 2 * 86400 * 1000;
}

// Si ESPN ya tiene un partido futuro (fuera de la ventana), devuelve { next }.
// Si no, la temporada terminó: { ended, season, champion, last } con los
// últimos partidos jugados, aunque sean de hace semanas. Si falla, null:
// la sección se muestra igual, sin el aviso.
async function loadOffseason(sport, league, force) {
  try {
    const latest = await espnGet(league.id, 'scoreboard', {}, { ttl: TTL.recent, force, normalize: normalizeLatest });
    const now = Date.now();
    const future = latest.data.matches.filter((m) => m.status === 'scheduled' && m.date > now).sort((a, b) => a.date - b.date);
    if (future.length) return { next: future[0].date };

    let played = latest.data.matches.filter((m) => m.status === 'final');
    const lastDate = Math.max(0, ...played.map((m) => m.date));
    // El scoreboard sin fecha trae un solo día: si quedó fuera de la ventana, se pide el mes entero
    if (lastDate && lastDate < now - sport.pastDays * 86400000) {
      const month = monthOf(lastDate);
      const r = await espnGet(league.id, 'scoreboard', { dates: month, limit: 500 }, {
        ttl: isOld(month) ? TTL.old : TTL.recent, force, normalize: normalizeScoreboard,
      });
      played = [...played, ...r.data.filter((m) => m.status === 'final')];
    }
    const last = [...new Map(played.map((m) => [m.id, m])).values()].sort((a, b) => b.date - a.date).slice(0, 6);
    return { ended: true, season: latest.data.season, champion: findChampion(last, sport), last };
  } catch (err) {
    console.warn('No se pudo ver si terminó la temporada:', err.message);
    return null;
  }
}

const FETCHERS = {
  async partidos(sport, league, force) {
    const settled = await Promise.allSettled(
      scoreboardRequests(sport).map((p) =>
        espnGet(league.id, 'scoreboard', p, { ttl: isOld(p.dates) ? TTL.old : TTL.recent, force, normalize: normalizeScoreboard })),
    );
    // Si falla algún día se muestran los demás, con aviso; si fallan todos, error
    const results = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    const failed = settled.find((s) => s.status === 'rejected');
    if (!results.length) throw failed.reason;
    if (failed) results.push({ at: Date.now(), stale: true, error: failed.reason.message });
    const matches = results.flatMap((r) => r.data || []);
    const { live, upcoming } = splitMatches(matches, sport);
    // Sin partidos en vivo ni próximos: puede ser el receso o un parón largo
    const offseason = live.length || upcoming.length ? null : await loadOffseason(sport, league, force);
    return { data: { matches, offseason }, results };
  },
  async tabla(sport, league, force) {
    const r = await espnGet(league.id, 'standings', {}, {
      ttl: TTL.standings, force, normalize: (b) => normalizeStandings(b, sport.standings),
    });
    return { data: r.data, results: [r] };
  },
  async lideres(sport, league, force) {
    // Siempre la temporada regular: sin parámetros ESPN devuelve la etapa actual (playoffs incluidos)
    const params = { season: sport.season(new Date()), seasontype: 2 };
    const r = await espnGet(league.id, 'leaders', params, {
      ttl: TTL.leaders, force, normalize: (b) => normalizeLeaders(b, sport.leaders),
    });
    return { data: r.data, results: [r] };
  },
};

async function load(sport, league, section, { force = false } = {}) {
  const e = entry(league.id, section);
  if (e.loading) return;
  e.loading = true;
  if (e.status !== 'ready') e.status = 'loading';
  try {
    const { data, results } = await FETCHERS[section](sport, league, force);
    e.data = data;
    // El pedido más reciente: los días viejos vienen de una caché de 6 h y no
    // dicen nada de lo fresco que está lo de hoy
    e.at = Math.max(...results.map((r) => r.at));
    e.stale = results.some((r) => r.stale);
    e.error = results.find((r) => r.error)?.error || null;
    e.status = 'ready';
  } catch (err) {
    e.error = err.message;
    // Si ya había datos en pantalla, los mantenemos y avisamos
    if (e.status === 'ready') e.stale = true;
    else e.status = 'error';
  }
  e.loading = false;
  if (league.id === route.league.id) render();
}

// La sección actual y, en segundo plano, los partidos (para el contador "En vivo")
function ensureLoaded(force = false) {
  const { sport, league, section } = route;
  load(sport, league, section, { force });
  if (section !== 'partidos') load(sport, league, 'partidos', { force });
}

// ===================== VISTAS =====================

const app = document.getElementById('app');
let query = '';
let searchOpen = false;
let lastViewKey = '';

const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function updatedLine(e) {
  return e.at ? `<span class="updated">${esc(t('common.updated', { ago: ago(e.at) }))}</span>` : '';
}

function staleNotice(e) {
  return e.stale ? `<div class="notice">${esc(t('errors.stale', { error: e.error || '' }))}</div>` : '';
}

function bodyFor(e, skeleton, renderReady) {
  if (e.status === 'error') return errorState(e.error);
  if (e.status !== 'ready') return skeleton;
  return staleNotice(e) + renderReady(e.data);
}

function matchLists(sport, league, { matches, offseason }) {
  const q = query.trim().toLowerCase();
  const byTeam = (list) => (q
    ? list.filter((m) => [m.home.name, m.home.short, m.away.name, m.away.short].some((n) => n.toLowerCase().includes(q)))
    : list);
  const { live, upcoming, past } = splitMatches(byTeam(matches), sport);
  const ended = offseason?.ended ? offseason : null;
  // En el receso, si no hay resultados en la ventana, se muestran los últimos partidos jugados
  const lastPlayed = ended && !past.length ? byTeam(ended.last) : [];
  if (q && !live.length && !upcoming.length && !past.length && !lastPlayed.length) {
    return emptyState(t('matches.noResultsFor', { q }));
  }

  // Los en vivo van en una sola lista; el resto, agrupado por día
  const block = (label, list, empty, live = false) => `
    <h2 class="section-label">${live ? '<span class="dot"></span>' : ''}${esc(label)} <span class="count">${list.length || ''}</span></h2>
    ${!list.length ? empty
    : live ? `<ul class="rows">${list.map((m) => matchRow(m, sport)).join('')}</ul>`
      : matchDays(list, sport)}`;

  const noUpcoming = offseason?.next
    ? emptyState(t('matches.noUpcoming'), t('offseason.next', { date: dayLabel(offseason.next) }))
    : emptyState(t('matches.noUpcoming'), t('matches.window', { n: sport.nextDays }));

  return [
    ended && !q ? seasonEndCard(ended, sport, league) : '',
    live.length ? block(t('matches.live'), live, '', true) : '',
    // Con la temporada terminada no tiene sentido una sección de próximos vacía
    ended ? '' : block(t('matches.upcoming'), upcoming, noUpcoming),
    lastPlayed.length
      ? block(t('offseason.lastPlayed'), lastPlayed, '')
      : block(t('matches.results'), past, emptyState(t('matches.noResults'), t('matches.windowPast', { n: sport.pastDays }))),
  ].join('');
}

function viewPartidos(sport, league) {
  const e = entry(league.id, 'partidos');
  // El filtro queda escondido detrás de la lupa del encabezado
  const search = searchOpen
    ? `<div class="search-row">
      <label class="visually-hidden" for="filter">${esc(t('matches.filter'))}</label>
      <input id="filter" class="filter-input" type="search" autocomplete="off" placeholder="${esc(t('matches.filter'))}" value="${esc(query)}">
    </div>`
    : '';
  return `${search}
    <div id="match-lists">${bodyFor(e, skeletons(6, 'row-sk'), (data) => matchLists(sport, league, data))}</div>`;
}

function viewTabla(sport, league) {
  const e = entry(league.id, 'tabla');
  return bodyFor(e, skeletons(1, 'tall'), (data) => {
    if (!data.groups.some((g) => g.rows.length)) return emptyState(t('table.empty'));
    const multi = data.groups.length > 1;
    // ESPN nombra los grupos del fútbol "Group A", "Group B"
    const groupName = (name) => name.replace(/^Group (\w+)$/, (m, x) => t('table.group', { x }));
    const tables = data.groups.map((g) => standingsTable(g, sport, multi ? groupName(g.name) : null)).join('');
    // Las conferencias de NBA y MLB entran lado a lado; las tablas de fútbol tienen demasiadas columnas
    const sideBySide = data.groups.length === 2 && sport.standings.columns.length <= 6;
    return sideBySide ? `<div class="tables-2">${tables}</div>` : tables;
  });
}

function viewLideres(sport, league) {
  const e = entry(league.id, 'lideres');
  return bodyFor(e, skeletons(3), (data) => {
    if (!data.categories.length) return emptyState(t('leaders.empty'));
    return `<div class="leaders">${data.categories.map((c) => leaderCard(c, sport)).join('')}</div>`;
  });
}

const VIEWS = { partidos: viewPartidos, tabla: viewTabla, lideres: viewLideres };

function leagueLogo(league, cls) {
  if (!Number.isInteger(league.logo)) return '';
  return `<img class="${cls}" src="https://a.espncdn.com/i/leaguelogos/soccer/500-dark/${league.logo}.png" alt="" onerror="this.remove()">`;
}

function liveCount() {
  const e = entry(route.league.id, 'partidos');
  return e.status === 'ready' ? e.data.matches.filter((m) => m.status === 'live').length : 0;
}

function renderChrome() {
  const { sport, league, section } = route;
  document.documentElement.style.setProperty('--accent', sport.accent);
  document.title = t('meta.title', { name: league.name });

  document.querySelectorAll('.sport-opt').forEach((a) => {
    const s = SPORTS[a.dataset.sport];
    a.href = href(s, savedLeague(s));
    if (a.dataset.sport === sport.id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.querySelector('.sport-switch').setAttribute('aria-label', t('nav.sport'));

  const tabs = document.querySelector('.tabs');
  tabs.setAttribute('aria-label', t('nav.sections'));
  tabs.innerHTML = sport.sections.map((s) =>
    `<a class="tab" href="${href(sport, league, s)}"${s === section ? ' aria-current="page"' : ''}>${esc(t(`nav.${s}`))}</a>`).join('');

  const n = liveCount();
  const pill = document.querySelector('.live-pill');
  pill.hidden = n === 0;
  pill.href = href(sport, league, 'partidos');
  pill.querySelector('.live-label').textContent = t('nav.live');
  pill.querySelector('.live-count').textContent = n;

  document.getElementById('footer-text').innerHTML =
    `${esc(t('footer.data'))} <a href="https://www.espn.com" target="_blank" rel="noopener noreferrer">ESPN</a>. ${esc(t('footer.disclaimer'))}`;
}

function render() {
  const { sport, league, section } = route;
  renderChrome();
  const e = entry(league.id, section);
  app.setAttribute('aria-busy', String(e.status === 'loading'));

  const title = `${leagueLogo(league, 'h1-logo')}${esc(league.name)}`;
  const chips = sport.leagues.length > 1
    ? `<nav class="leagues" aria-label="${esc(t('nav.league'))}">${sport.leagues.map((l) =>
      `<a class="league-chip" href="${href(sport, l, section)}"${l.id === league.id ? ' aria-current="true"' : ''}>${leagueLogo(l, 'chip-logo')}${esc(l.name)}</a>`).join('')}</nav>`
    : '';

  // Las tarjetas se animan al entrar a una vista, no en cada actualización
  const viewKey = `${league.id}|${section}|${e.status}`;
  app.classList.toggle('static', viewKey === lastViewKey);
  lastViewKey = viewKey;

  // A la derecha del título: "Actualizado hace…" y la lupa en Partidos; la temporada en Tabla y Líderes
  let tools = '';
  if (section === 'partidos') {
    tools = `${updatedLine(e)}
      <button type="button" class="icon-btn" data-action="search" aria-expanded="${searchOpen}" aria-controls="filter"
        aria-label="${esc(t('matches.filter'))}" title="${esc(t('matches.filter'))}">${SEARCH_ICON}</button>`;
  } else if (e.status === 'ready' && e.data.season) {
    tools = `<span class="updated">${esc(t('table.season', { season: e.data.season }))}</span>`;
  }

  // Si el foco estaba en el filtro, se recupera después de redibujar
  const filterFocused = document.activeElement?.id === 'filter';
  app.innerHTML = `
    <div class="page-head"><h1>${title}</h1><div class="head-tools">${tools}</div></div>
    ${chips}
    ${VIEWS[section](sport, league)}`;
  const input = filterFocused && document.getElementById('filter');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

// ===================== EVENTOS =====================

window.addEventListener('hashchange', () => {
  const prev = route;
  route = parseHash();
  if (route.sport.leagues.length > 1) {
    try {
      localStorage.setItem(LEAGUE_KEY, route.league.id);
    } catch {
      // no se recuerda la liga, no pasa nada
    }
  }
  if (prev.league.id !== route.league.id) {
    query = '';
    searchOpen = false;
  }
  render();
  ensureLoaded();
  if (prev.sport.id !== route.sport.id || prev.league.id !== route.league.id) window.scrollTo(0, 0);
});

app.addEventListener('input', (ev) => {
  if (ev.target.id !== 'filter') return;
  query = ev.target.value;
  const e = entry(route.league.id, 'partidos');
  if (e.status === 'ready') document.getElementById('match-lists').innerHTML = matchLists(route.sport, route.league, e.data);
});

// Abrir la lupa enfoca el filtro; cerrarla lo vacía
function toggleSearch(open) {
  searchOpen = open;
  if (!open) query = '';
  render();
  if (open) document.getElementById('filter')?.focus();
  else app.querySelector('[data-action="search"]')?.focus();
}

app.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-action="retry"]')) {
    const { sport, league, section } = route;
    load(sport, league, section, { force: true });
    render();
  }
  if (ev.target.closest('[data-action="search"]')) toggleSearch(!searchOpen);
});

app.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ev.target.id === 'filter') toggleSearch(false);
});

// Actualización automática: más seguido si hay partidos en vivo, nunca con la pestaña oculta
setInterval(() => {
  if (document.hidden) return;
  const e = entry(route.league.id, 'partidos');
  const every = liveCount() > 0 ? REFRESH_LIVE : REFRESH_IDLE;
  if (e.status === 'ready' && Date.now() - e.at >= every) load(route.sport, route.league, 'partidos', { force: true });
  else if (e.status === 'ready') {
    // solo refresca el "actualizado hace…"
    const line = app.querySelector('.page-head .updated');
    if (line) line.textContent = t('common.updated', { ago: ago(e.at) });
  }
}, 15 * 1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ensureLoaded();
});

// ===================== INICIO =====================

await setLang(preferredLang());
render();
ensureLoaded();
