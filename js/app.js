import { SPORTS, DEFAULT_SPORT } from './sports.js';
import { espnGet } from './api.js';
import { normalizeScoreboard, scoreboardRequests, splitMatches, normalizeStandings, normalizeLeaders } from './model.js';
import { esc, ago, matchCard, standingsTable, leaderCard, skeletons, emptyState, errorState } from './ui.js';
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
    return { data: results.flatMap((r) => r.data || []), results };
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
    e.at = Math.min(...results.map((r) => r.at));
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
let lastViewKey = '';

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

function matchLists(sport, matches) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? matches.filter((m) => [m.home.name, m.home.short, m.away.name, m.away.short].some((n) => n.toLowerCase().includes(q)))
    : matches;
  const { live, upcoming, past } = splitMatches(filtered, sport);
  if (q && !live.length && !upcoming.length && !past.length) return emptyState(t('matches.noResultsFor', { q }));

  const block = (label, list, empty, dot = false) => `
    <h2 class="section-label">${dot ? '<span class="dot"></span>' : ''}${esc(label)} <span class="count">${list.length || ''}</span></h2>
    ${list.length ? `<div class="grid">${list.map((m, i) => matchCard(m, sport, i)).join('')}</div>` : empty}`;

  return [
    live.length ? block(t('matches.live'), live, '', true) : '',
    block(t('matches.upcoming'), upcoming, emptyState(t('matches.noUpcoming'), t('matches.window', { n: sport.nextDays }))),
    block(t('matches.results'), past, emptyState(t('matches.noResults'), t('matches.windowPast', { n: sport.pastDays }))),
  ].join('');
}

function viewPartidos(sport, league) {
  const e = entry(league.id, 'partidos');
  return `
    <div class="toolbar">
      <label class="visually-hidden" for="filter">${esc(t('matches.filter'))}</label>
      <input id="filter" class="filter-input" type="search" autocomplete="off" placeholder="${esc(t('matches.filter'))}" value="${esc(query)}">
      ${updatedLine(e)}
    </div>
    <div id="match-lists">${bodyFor(e, skeletons(6), (data) => matchLists(sport, data))}</div>`;
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
    return `${data.season ? `<p class="updated" style="margin-bottom:10px">${esc(t('table.season', { season: data.season }))}</p>` : ''}
      ${sideBySide ? `<div class="tables-2">${tables}</div>` : tables}`;
  });
}

function viewLideres(sport, league) {
  const e = entry(league.id, 'lideres');
  return bodyFor(e, skeletons(3), (data) => {
    if (!data.categories.length) return emptyState(t('leaders.empty'));
    return `${data.season ? `<p class="updated" style="margin-bottom:10px">${esc(t('table.season', { season: data.season }))}</p>` : ''}
      <div class="leaders">${data.categories.map((c) => leaderCard(c, sport)).join('')}</div>`;
  });
}

const VIEWS = { partidos: viewPartidos, tabla: viewTabla, lideres: viewLideres };

function leagueLogo(league, cls) {
  if (!Number.isInteger(league.logo)) return '';
  return `<img class="${cls}" src="https://a.espncdn.com/i/leaguelogos/soccer/500-dark/${league.logo}.png" alt="" onerror="this.remove()">`;
}

function liveCount() {
  const e = entry(route.league.id, 'partidos');
  return e.status === 'ready' ? e.data.filter((m) => m.status === 'live').length : 0;
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

  // Si el foco estaba en el filtro, se recupera después de redibujar
  const filterFocused = document.activeElement?.id === 'filter';
  app.innerHTML = `
    <div class="page-head"><h1>${title}</h1><p>${esc(t(`sections.${section}.subtitle`))}</p></div>
    ${chips}
    ${VIEWS[section](sport, league)}`;
  if (filterFocused) {
    const input = document.getElementById('filter');
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
  if (prev.league.id !== route.league.id) query = '';
  render();
  ensureLoaded();
  if (prev.sport.id !== route.sport.id || prev.league.id !== route.league.id) window.scrollTo(0, 0);
});

app.addEventListener('input', (ev) => {
  if (ev.target.id !== 'filter') return;
  query = ev.target.value;
  const e = entry(route.league.id, 'partidos');
  if (e.status === 'ready') document.getElementById('match-lists').innerHTML = matchLists(route.sport, e.data);
});

app.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-action="retry"]')) {
    const { sport, league, section } = route;
    load(sport, league, section, { force: true });
    render();
  }
});

// Actualización automática: más seguido si hay partidos en vivo, nunca con la pestaña oculta
setInterval(() => {
  if (document.hidden) return;
  const e = entry(route.league.id, 'partidos');
  const every = liveCount() > 0 ? REFRESH_LIVE : REFRESH_IDLE;
  if (e.status === 'ready' && Date.now() - e.at >= every) load(route.sport, route.league, 'partidos', { force: true });
  else if (e.status === 'ready') {
    // solo refresca el "actualizado hace…"
    const line = app.querySelector('.toolbar .updated');
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
