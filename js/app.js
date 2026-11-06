import { SPORTS, DEFAULT_SPORT } from './sports.js';
import { espnGet } from './api.js';
import {
  normalizeScoreboard, normalizeLatest, scoreboardRequests, splitMatches, normalizeStandings, normalizeLeaders, normalizeRankings,
  normalizeScorers, normalizePlayerBio, normalizePlayerOverview, findChampion, monthOf,
} from './model.js';
import {
  esc, ago, dayLabel, formatLongDate, matchRow, matchDays, featuredMatch, standingsTable, leaderCard, rankingTable, seasonEndCard,
  skeletons, emptyState,
  errorState, playerCard, playerSkeleton,
} from './ui.js';
import { t, setLang, preferredLang } from './i18n.js';
import { ICONS, BRAND_MARK } from './icons.js';

// Caché del navegador por tipo de dato (el CDN de Vercel cachea aparte)
const TTL = { recent: 60 * 1000, old: 6 * 3600 * 1000, standings: 10 * 60 * 1000, leaders: 3600 * 1000 };
// Con partidos en vivo se actualiza cada minuto; si no, cada 5
const REFRESH_LIVE = 60 * 1000;
const REFRESH_IDLE = 5 * 60 * 1000;
// Última liga elegida en cada deporte con varias ("futbol_league", "tenis_league")
const leagueKey = (sport) => `${sport.id}_league`;

// ===================== RUTAS =====================
// #/<deporte>[/<liga>][/<sección>]. La liga solo va en fútbol; la sección
// por defecto es la primera del deporte.

function savedLeague(sport) {
  if (sport.leagues.length === 1) return sport.leagues[0];
  try {
    const id = localStorage.getItem(leagueKey(sport));
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
  async ranking(sport, league, force) {
    const r = await espnGet(league.id, 'rankings', {}, {
      ttl: TTL.leaders, force, normalize: (b) => normalizeRankings(b, sport.rankingSize),
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
  async goleadores(sport, league, force) {
    const r = await espnGet(league.id, 'scorers', {}, { ttl: TTL.leaders, force, normalize: (b) => normalizeScorers(b) });
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

  // Arriba, en grande, el partido que se está jugando o el próximo; no se repite en las listas
  const featured = q ? null : live[0] || upcoming[0] || null;
  const without = (list) => list.filter((m) => m !== featured);

  // Título de sección grande + lista; los en vivo en una sola lista, el resto agrupado por día
  const block = (label, list, empty, isLive = false) => `
    <div class="pm-section-head"><h2 class="pm-h2">${isLive ? '<span class="live-dot"></span> ' : ''}${esc(label)}</h2>
      <span class="pm-count">${list.length || ''}</span></div>
    ${!list.length ? empty
    : isLive ? `<ul class="list">${list.map((m) => matchRow(m, sport)).join('')}</ul>`
      : matchDays(list, sport)}`;

  const noUpcoming = offseason?.next
    ? emptyState(t('matches.noUpcoming'), t('offseason.next', { date: dayLabel(offseason.next) }))
    : emptyState(t('matches.noUpcoming'), t('matches.window', { n: sport.nextDays }));

  return [
    ended && !q ? seasonEndCard(ended, sport, league) : '',
    featured ? featuredMatch(featured, sport) : '',
    without(live).length ? block(t('matches.live'), without(live), '', true) : '',
    // Con la temporada terminada no tiene sentido una sección de próximos vacía
    ended ? '' : block(t('matches.upcoming'), without(upcoming), noUpcoming),
    lastPlayed.length
      ? block(t('offseason.lastPlayed'), lastPlayed, '')
      : block(t('matches.results'), past, emptyState(t('matches.noResults'), t('matches.windowPast', { n: sport.pastDays }))),
  ].join('');
}

// Línea de datos debajo del título grande ("2 en vivo / 20 próximos / …"), como en Counter
function heroFacts(sport, section, e) {
  const facts = [];
  if (e.status === 'ready') {
    if (section === 'partidos' && e.data.offseason?.ended) {
      // En el receso los contadores darían todo 0: mejor decir que terminó
      facts.push(t('hero.ended', { season: esc(e.data.offseason.season || '') }));
    } else if (section === 'partidos') {
      const { live, upcoming, past } = splitMatches(e.data.matches, sport);
      facts.push(t('hero.live', { n: live.length }), t('hero.upcoming', { n: upcoming.length }), t('hero.results', { n: past.length }));
    } else if (e.data.season) {
      facts.push(t('hero.season', { season: e.data.season }));
      if (e.data.groups) facts.push(t('hero.teams', { n: e.data.groups.reduce((s, g) => s + g.rows.length, 0) }));
    } else if (e.data.updated) {
      facts.push(t('ranking.updated', { date: formatLongDate(e.data.updated) }), t('hero.top', { n: e.data.rows.length }));
    }
  }
  const updated = section === 'partidos' && e.at ? `<span class="sep">/</span><span class="updated">${esc(t('common.updated', { ago: ago(e.at) }))}</span>` : '';
  return `<div class="hero-facts">${facts.map((f) => `<span>${f}</span>`).join('<span class="sep">/</span>') || '&nbsp;'}${updated}</div>`;
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

// Líderes (NBA, MLB) y Goleadores (fútbol) usan las mismas tarjetas
const viewLeaders = (section) => (sport, league) => {
  const e = entry(league.id, section);
  return bodyFor(e, skeletons(3), (data) => {
    if (!data.categories.some((c) => c.leaders.length)) return emptyState(t('leaders.empty'));
    return `<div class="leaders">${data.categories.map((c) => leaderCard(c, sport)).join('')}</div>`;
  });
};

function viewRanking(sport, league) {
  const e = entry(league.id, 'ranking');
  return bodyFor(e, skeletons(1, 'tall'), (data) => (data.rows.length ? rankingTable(data) : emptyState(t('ranking.empty'))));
}

const VIEWS = {
  partidos: viewPartidos, tabla: viewTabla, lideres: viewLeaders('lideres'), goleadores: viewLeaders('goleadores'), ranking: viewRanking,
};

function leagueLogo(league, cls) {
  if (!league.logo) return '';
  return `<img class="${cls}" src="${esc(league.logo)}" alt="" onerror="this.remove()">`;
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
  document.querySelector('.modal-close').setAttribute('aria-label', t('player.close'));

  const tabs = document.querySelector('.tabs');
  tabs.setAttribute('aria-label', t('nav.sections'));
  tabs.innerHTML = sport.sections.map((s) =>
    `<a class="tab" href="${href(sport, league, s)}"${s === section ? ' aria-current="page"' : ''}><span class="tab-icon">${ICONS[s] || ''}</span>${esc(t(`nav.${s}`))}</a>`).join('');

  // "En vivo" siempre visible: apagado con 0, verde cuando hay partidos jugándose
  const n = liveCount();
  const pill = document.querySelector('.live-pill');
  pill.classList.toggle('on', n > 0);
  pill.href = href(sport, league, 'partidos');
  pill.querySelector('.live-label').textContent = t('nav.live');
  pill.querySelector('.live-count').textContent = n;

  document.getElementById('footer-text').innerHTML = `
    <div class="footer-top">
      <span class="footer-brand">Frelytics</span>
      <ul class="footer-sources"><li><span>${esc(t('footer.data'))}</span> <a href="https://www.espn.com" target="_blank" rel="noopener noreferrer">ESPN</a></li></ul>
    </div>
    <p class="footer-note">${esc(t('footer.disclaimer'))}</p>`;
}

function render() {
  const { sport, league, section } = route;
  renderChrome();
  const e = entry(league.id, section);
  app.setAttribute('aria-busy', String(e.status === 'loading'));

  const chips = sport.leagues.length > 1
    ? `<nav class="leagues" aria-label="${esc(t('nav.league'))}">${sport.leagues.map((l) =>
      `<a class="league-chip" href="${href(sport, l, section)}"${l.id === league.id ? ' aria-current="true"' : ''}>${leagueLogo(l, 'chip-logo')}${esc(l.name)}</a>`).join('')}</nav>`
    : '';
  // Deporte · liga arriba del título; en NBA y MLB la liga es el deporte
  const kicker = [t(`sports.${sport.id}`), sport.leagues.length > 1 ? league.name : null].filter(Boolean).join(' · ');

  // Las tarjetas se animan al entrar a una vista, no en cada actualización
  const viewKey = `${league.id}|${section}|${e.status}`;
  app.classList.toggle('static', viewKey === lastViewKey);
  lastViewKey = viewKey;

  // La lupa del filtro va al lado de las ligas, solo en Partidos
  const search = section === 'partidos'
    ? `<button type="button" class="search-toggle" data-action="search" aria-expanded="${searchOpen}" aria-controls="filter"
        aria-label="${esc(t('matches.filter'))}" title="${esc(t('matches.filter'))}">${ICONS.buscar}</button>`
    : '';

  // Si el foco estaba en el filtro, se recupera después de redibujar
  const filterFocused = document.activeElement?.id === 'filter';
  app.innerHTML = `
    <section class="pm-head${league.logo ? ' has-art' : ''}">
      <div class="pm-head-text">
        <span class="kicker"><span class="kicker-dot"></span>${esc(kicker)}</span>
        <h1 class="pm-title">${esc(t(`nav.${section}`))}</h1>
        ${heroFacts(sport, section, e)}
      </div>
      ${league.logo ? `<div class="pm-art">${leagueLogo(league, 'pm-art-img')}</div>` : ''}
    </section>
    ${chips || search ? `<div class="head-row">${chips || '<span></span>'}${search}</div>` : ''}
    ${VIEWS[section](sport, league)}`;
  // En el celular la fila de ligas se desliza: que la elegida quede a la vista
  const leaguesNav = app.querySelector('.leagues');
  const current = leaguesNav?.querySelector('[aria-current="true"]');
  if (current && leaguesNav.scrollWidth > leaguesNav.clientWidth) {
    leaguesNav.scrollLeft = Math.max(0, current.offsetLeft - leaguesNav.offsetLeft - 16);
  }
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
      localStorage.setItem(leagueKey(route.sport), route.league.id);
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
  const player = ev.target.closest('[data-player]');
  if (player) openPlayer(player.dataset.player);
});

// ===================== FICHA DE JUGADOR =====================
// Un <dialog> con dos pedidos en paralelo: datos personales y estadísticas.
// Si las estadísticas fallan, se muestra igual la ficha sin ellas.

const modal = document.getElementById('player-modal');
const modalBody = document.getElementById('player-modal-content');
let playerGen = 0;
let playerId = null;

async function openPlayer(id) {
  const gen = ++playerGen;
  playerId = id;
  const { sport, league } = route;
  modalBody.innerHTML = playerSkeleton();
  if (!modal.open) modal.showModal();
  const opts = { ttl: 30 * 60 * 1000 };
  const [bio, overview] = await Promise.allSettled([
    espnGet(league.id, 'player', { athlete: id }, { ...opts, normalize: normalizePlayerBio }),
    espnGet(league.id, 'player-overview', { athlete: id }, { ...opts, normalize: normalizePlayerOverview }),
  ]);
  // Si mientras cargaba se abrió otro jugador o se cerró, esta respuesta ya no importa
  if (gen !== playerGen || !modal.open) return;
  modalBody.innerHTML = bio.status === 'fulfilled'
    ? playerCard(bio.value.data, overview.status === 'fulfilled' ? overview.value.data : null, sport)
    : errorState(bio.reason.message);
}

modal.addEventListener('click', (ev) => {
  // Clic en el fondo (fuera del contenido) o en la cruz
  if (ev.target === modal || ev.target.closest('[data-action="close-player"]')) modal.close();
  if (ev.target.closest('[data-action="retry"]') && playerId) openPlayer(playerId);
});
modal.addEventListener('close', () => {
  playerGen++;
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
  else if (e.status === 'ready' && route.section === 'partidos') {
    // solo refresca el "actualizado hace…"; en Tabla, Líderes y Ranking ese
    // lugar muestra la temporada o la fecha del ranking y no se toca
    const line = app.querySelector('.hero-facts .updated');
    if (line) line.textContent = t('common.updated', { ago: ago(e.at) });
  }
}, 15 * 1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ensureLoaded();
});

// ===================== INICIO =====================

await setLang(preferredLang());
document.querySelector('.brand-mark').innerHTML = BRAND_MARK;
document.querySelector('.modal-close').innerHTML = ICONS.cerrar;
render();
ensureLoaded();
