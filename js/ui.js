// Helpers de formato y componentes HTML reutilizables.

import { t, getLang } from './i18n.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// ---------- Fechas (zona horaria del visitante, idioma elegido) ----------

const formats = new Map();
function fmt(options) {
  const key = `${getLang()}|${JSON.stringify(options)}`;
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat(getLang(), options));
  return formats.get(key);
}

export const formatTime = (ts) => fmt({ hour: '2-digit', minute: '2-digit' }).format(ts);
// "29 de octubre" / "October 29", para usar dentro de una frase
export const formatLongDate = (ts) => fmt({ day: 'numeric', month: 'long' }).format(ts);

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ts) {
  if (!ts) return t('common.dateToConfirm');
  const d = new Date(ts);
  const today = new Date();
  const offset = (n) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  if (dayKey(d) === offset(0)) return t('common.today');
  if (dayKey(d) === offset(1)) return t('common.tomorrow');
  if (dayKey(d) === offset(-1)) return t('common.yesterday');
  const s = fmt({ weekday: 'long', day: 'numeric', month: 'short' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('common.justNow');
  if (m < 60) return t('common.minutesAgo', { n: m });
  return t('common.hoursAgo', { n: Math.round(m / 60) });
}

// ---------- Estado de un partido ----------

function liveLabel(m, sportId) {
  if (m.statusName === 'STATUS_HALFTIME') return t('match.halftime');
  if (sportId === 'futbol') return m.clock || t('match.live');
  if (sportId === 'nba') {
    if (m.statusName === 'STATUS_END_PERIOD') return t('match.endQuarter', { n: m.period });
    if (m.period > 4) return t('match.overtime', { n: m.period - 4, clock: m.clock });
    return t('match.quarter', { n: m.period, clock: m.clock });
  }
  if (sportId === 'tenis') return t('match.set', { n: m.period || 1 });
  if (sportId === 'mlb') {
    // ESPN manda "Top 7th", "Bot 7th", "Mid 7th" o "End 7th"
    const half = { top: 'top', bot: 'bottom', bottom: 'bottom', mid: 'middle', middle: 'middle', end: 'end' }[
      m.detail.split(' ')[0].toLowerCase()];
    return half ? t(`match.inning.${half}`, { n: m.period }) : m.detail;
  }
  return m.detail;
}

function finalLabel(m) {
  // Tenis: abandono y W.O. cuentan como terminados
  if (m.statusName === 'STATUS_RETIRED') return t('match.retired');
  if (m.statusName === 'STATUS_WALKOVER') return t('match.walkover');
  // "Final/OT", "Final/12" (entradas), "FT-Pens", "AET"
  if (/pen/i.test(m.detail)) return t('match.finalPens');
  if (/AET/i.test(m.detail)) return t('match.finalAet');
  const extra = m.detail.split('/')[1];
  return extra ? `${t('match.final')} · ${extra}` : t('match.final');
}

// Columna izquierda de cada fila: minuto/cuarto en vivo, "Final", postergado u hora
function statusCell(m, sportId) {
  if (m.status === 'live') return `<span class="st live"><span class="st-dot"></span>${esc(liveLabel(m, sportId))}</span>`;
  if (m.status === 'final') return `<span class="st final">${esc(finalLabel(m))}</span>`;
  if (m.status === 'off') {
    const key = `match.off.${m.statusName}`;
    const label = t(key);
    return `<span class="st off">${esc(label === key ? m.detail : label)}</span>`;
  }
  return `<span class="st scheduled">${esc(m.timeValid && m.date ? formatTime(m.date) : t('common.toConfirm'))}</span>`;
}

// ---------- Componentes ----------

// ESPN tiene una versión de cada logo pensada para fondo oscuro (/500-dark/):
// sin ella, logos como el de los Rays o el Tottenham casi no se ven. Si no
// existe, se vuelve al logo normal y, si tampoco carga, se oculta.
const FALLBACK = "if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=''}else{this.style.visibility='hidden'}";

function logo(url, cls = 'team-logo') {
  const src = safeUrl(url);
  if (!src) return `<span class="${cls} empty"></span>`;
  // Las banderas de países no tienen versión oscura
  const dark = src.includes('/teamlogos/countries/') ? src : src.replace(/\/teamlogos\/([a-z]+)\/500\//, '/teamlogos/$1/500-dark/');
  return `<img class="${cls}" src="${esc(dark)}" ${dark !== src ? `data-fb="${esc(src)}"` : ''} alt="" loading="lazy" width="26" height="26" onerror="${FALLBACK}">`;
}

// Logo dentro de un cuadrito (como en Analytics Counter). size: '' | 'sm' | 'xl'
function badge(url, size = '', flag = false) {
  return `<span class="logo-badge${size ? ` ${size}` : ''}${flag ? ' flag' : ''}">${logo(url, 'badge-img')}</span>`;
}

// Nombre de la ronda en el idioma elegido; si no está traducida, la de ESPN
function roundLabel(round) {
  if (!round) return null;
  const key = `rounds.${round.replace(/[^a-z0-9]/gi, '')}`;
  return t(key) === key ? round : t(key);
}

function rowNote(m) {
  if (m.note) return m.note;
  return [m.tournament, roundLabel(m.round)].filter(Boolean).join(' · ') || null;
}

const hasScore = (m) => (m.status === 'live' || m.status === 'final')
  && (m.home.sets ? m.home.sets.length > 0 : m.home.score !== null);

// Resultado del centro: "2–1", sets de tenis "6-3 7-6⁵" o "vs"
function scoreCell(m, first, second) {
  if (!hasScore(m)) return '<span class="vs">vs</span>';
  if (first.sets) {
    return first.sets.map((s, i) => {
      const o = second.sets[i] || { v: '', tb: null };
      const tb = s.tb !== null || o.tb !== null ? `<sup>${esc(Math.min(s.tb ?? 99, o.tb ?? 99))}</sup>` : '';
      return `<span class="m-set">${esc(s.v)}-${esc(o.v)}${tb}</span>`;
    }).join('');
  }
  return `${esc(first.score)}<span>–</span>${esc(second.score)}`;
}

function sideOrder(m, sport) {
  return sport.homeFirst ? [m.home, m.away] : [m.away, m.home];
}

const lost = (side, m) => m.status === 'final' && !side.winner && (m.home.winner || m.away.winner);

function teamCell(side, m, sport, right = false) {
  const record = sport.id !== 'futbol' && side.record ? `<span class="m-record">${esc(side.record)}</span>` : '';
  const name = `<span class="m-name">${esc(side.short)}</span>`;
  const logoHtml = badge(side.logo, 'sm', Boolean(side.sets));
  const parts = right ? [record, name, logoHtml] : [logoHtml, name, record];
  return `<span class="m-team${right ? ' right' : ''}${lost(side, m) ? ' dim' : ''}${side.winner ? ' win' : ''}">${parts.join('')}</span>`;
}

// Una fila: a la izquierda estado y torneo; al centro los dos equipos enfrentados
export function matchRow(m, sport) {
  const [first, second] = sideOrder(m, sport);
  const label = t('match.aria', { a: first.name, b: second.name });
  const note = rowNote(m);
  return `<li class="match is-${m.status}" aria-label="${esc(label)}">
    <div class="m-meta">
      ${statusCell(m, sport.id)}
      ${note ? `<span class="m-sub">${esc(note)}</span>` : ''}
    </div>
    <div class="m-teams">
      ${teamCell(first, m, sport)}
      <span class="m-score">${scoreCell(m, first, second)}</span>
      ${teamCell(second, m, sport, true)}
    </div>
  </li>`;
}

// Lista de partidos agrupada por día (en el orden en que vienen)
export function matchDays(matches, sport) {
  const days = [];
  for (const m of matches) {
    const key = m.date ? dayKey(new Date(m.date)) : 'tbd';
    if (days.at(-1)?.key !== key) days.push({ key, date: m.date, list: [] });
    days.at(-1).list.push(m);
  }
  return days.map((d) => `<section class="day">
    <h3 class="section-label">${esc(dayLabel(d.date))} <span>${d.list.length}</span></h3>
    <ul class="list">${d.list.map((m) => matchRow(m, sport)).join('')}</ul>
  </section>`).join('');
}

// Partido destacado arriba de la lista: el que se está jugando o, si no hay,
// el próximo. Nombres grandes enfrentados, como en Analytics Counter.
export function featuredMatch(m, sport) {
  const [first, second] = sideOrder(m, sport);
  const live = m.status === 'live';
  const note = rowNote(m);
  const pill = live
    ? `<span class="pill live">${esc(t('featured.live'))}</span>`
    : `<span class="pill">${esc(t('featured.next'))}</span>`;
  const when = live
    ? `<span class="live-text"><span class="live-dot"></span>${esc(liveLabel(m, sport.id))}</span>`
    : `<span>${esc(dayLabel(m.date))} · ${esc(m.timeValid && m.date ? formatTime(m.date) : t('common.toConfirm'))}</span>`;
  const team = (side, cls) => `<div class="pm-team ${cls}${lost(side, m) ? ' dim' : ''}">
      ${badge(side.logo, 'xl', Boolean(side.sets))}
      <span class="pm-team-name">${esc(side.short)}</span>
    </div>`;
  return `<section class="pm-card" aria-label="${esc(t('match.aria', { a: first.name, b: second.name }))}">
    <div class="pm-feature-top">${pill}${note ? `<span class="pm-meta">${esc(note)}</span>` : ''}</div>
    <div class="pm-versus">
      ${team(first, 'a')}
      <div class="pm-vs">${scoreCell(m, first, second)}</div>
      ${team(second, 'b')}
    </div>
    <div class="pm-feature-foot"><span class="pm-when">${when}</span></div>
  </section>`;
}

export function standingsTable(group, sport, title) {
  const cols = sport.standings.columns;
  const notes = new Map();
  const rows = group.rows.map((r, i) => {
    if (r.note?.color && r.note.text) notes.set(r.note.color, r.note.text);
    const pos = r.stats.rank?.v ?? r.stats[sport.standings.sortBy]?.v ?? i + 1;
    const color = r.note?.color && /^#[0-9a-f]{3,8}$/i.test(r.note.color) ? r.note.color : 'transparent';
    return `<tr>
      <td class="pos" style="border-left-color:${color}">${esc(pos)}</td>
      <td class="team-col"><span class="team-cell">${logo(r.team.logo, 'team-logo')}<span class="short">${esc(r.team.short)}</span><span class="long">${esc(r.team.name)}</span></span></td>
      ${cols.map((c) => `<td class="${c.main ? 'main' : ''}${c.wide ? ' wide' : ''}">${esc(r.stats[c.key]?.d ?? '–')}</td>`).join('')}
    </tr>`;
  });
  const legend = notes.size
    ? `<div class="legend">${[...notes].map(([c, txt]) => `<span><i style="background:${esc(c)}"></i>${esc(txt)}</span>`).join('')}</div>`
    : '';
  return `<div class="table-wrap">
    ${title ? `<div class="table-title">${esc(title)}</div>` : ''}
    <table class="standings">
      <thead><tr>
        <th>#</th><th class="team-col">${esc(t('table.team'))}</th>
        ${cols.map((c) => `<th class="${c.wide ? 'wide' : ''}" title="${esc(t(`table.long.${c.label}`))}">${esc(t(`table.cols.${c.label}`))}</th>`).join('')}
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${legend}
  </div>`;
}

// Ranking ATP/WTA: posición, jugador con bandera, puntos y cuántos puestos subió o bajó
export function rankingTable(data) {
  const fmtPoints = new Intl.NumberFormat(getLang());
  const trend = (n) => {
    if (n > 0) return `<span class="trend up" title="${esc(t('ranking.up', { n }))}">▲ ${n}</span>`;
    if (n < 0) return `<span class="trend down" title="${esc(t('ranking.down', { n: -n }))}">▼ ${-n}</span>`;
    return '<span class="trend">–</span>';
  };
  return `<div class="table-wrap">
    <table class="standings ranking">
      <thead><tr>
        <th>#</th><th class="team-col">${esc(t('ranking.player'))}</th>
        <th>${esc(t('ranking.points'))}</th><th title="${esc(t('ranking.trendLong'))}">${esc(t('ranking.trend'))}</th>
      </tr></thead>
      <tbody>${data.rows.map((r) => `<tr>
        <td class="pos">${esc(r.rank)}</td>
        <td class="team-col"><span class="team-cell">${logo(r.flag, 'team-logo flag')}<span>${esc(r.name)}</span></span></td>
        <td class="main">${r.points === null ? '–' : esc(fmtPoints.format(r.points))}</td>
        <td>${trend(r.trend)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function formatStat(value, dec) {
  if (!Number.isFinite(value)) return '–';
  if (dec === 'avg') return value.toFixed(3).replace(/^0/, '');
  return value.toFixed(dec);
}

export function leaderCard(cat, sport) {
  const key = `leaders.${cat.name}`;
  const title = t(key) === key ? cat.abbr : t(key);
  const dec = sport.leaders[cat.name];
  // Si el deporte tiene ficha de jugador, cada fila es un botón que la abre
  const row = (l, i) => {
    const team = [l.team, l.apps !== null && l.apps !== undefined ? t('leaders.apps', { n: l.apps }) : null].filter(Boolean).join(' · ');
    const inner = `<span class="leader-rank">${i + 1}</span>
      ${logo(l.photo, 'leader-photo')}
      <span class="leader-info"><span class="leader-name">${esc(l.name)}</span><span class="leader-team">${esc(team)}</span></span>
      <span class="leader-value">${esc(formatStat(l.value, dec))}</span>`;
    return sport.players && l.id
      ? `<button type="button" class="leader-row" data-player="${esc(l.id)}" aria-label="${esc(t('player.open', { name: l.name }))}">${inner}</button>`
      : `<div class="leader-row">${inner}</div>`;
  };
  return `<div class="leader-card">
    <div class="leader-title">${esc(title)}</div>
    ${cat.leaders.map(row).join('')}
  </div>`;
}

// ---------- Ficha de jugador ----------

// Abreviaturas de ESPN en el idioma elegido ("GP" → "PJ"); si no está, la original
function statLabel(abbr) {
  const key = `stats.${abbr.replace(/[^a-z0-9]/gi, '')}`;
  return t(key) === key ? abbr : t(key);
}

// Algunos valores vienen como texto ("Started", "Substitute"): se traducen si se puede
function statValue(v) {
  if (/^[\d.,\-–()% ]*$/.test(v)) return v;
  const key = `stats.values.${String(v).replace(/[^a-z]/gi, '')}`;
  return t(key) === key ? v : t(key);
}

function statsTable(labels, names, rows, firstCol) {
  return `<div class="table-wrap player-table">
    <table class="standings">
      <thead><tr><th class="team-col">${esc(firstCol)}</th>${labels.map((l, i) =>
        `<th title="${esc(names[i] || l)}">${esc(statLabel(l))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="team-col">${r.head}</td>${r.stats.map((s) => `<td>${esc(statValue(s))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </div>`;
}

export function playerSkeleton() {
  return `<div class="player-head"><span class="player-photo empty"></span><div class="skeleton" style="height:48px;flex:1"></div></div>
    ${skeletons(2, 'row-sk')}`;
}

// Altura y peso: en español en metros y kilos; en inglés, como los da ESPN
function bodyLine(bio) {
  if (getLang() !== 'en' && (bio.heightIn || bio.weightLb)) {
    const n = new Intl.NumberFormat(getLang(), { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    return [
      bio.heightIn ? `${n.format(bio.heightIn * 0.0254)} m` : '',
      bio.weightLb ? `${Math.round(bio.weightLb * 0.4536)} kg` : '',
    ].filter(Boolean).join(' · ');
  }
  return [bio.height, bio.weight].filter(Boolean).join(' · ');
}

export function playerCard(bio, overview, sport) {
  const posKey = `positions.${sport.id}.${bio.position.replace(/[^a-z]/gi, '')}`;
  const facts = [
    t(posKey) === posKey ? bio.position : t(posKey),
    bio.jersey ? `#${bio.jersey}` : '',
    bio.age !== null ? t('player.age', { n: bio.age }) : '',
    bio.country || bio.birthPlace,
    bodyLine(bio),
  ].filter(Boolean);
  const photo = bio.photo ? logo(bio.photo, 'player-photo') : logo(bio.team?.logo, 'player-photo team');

  // En fútbol ESPN arma el resumen con la liga "por defecto" del jugador, que
  // puede no ser la actual: ahí alcanza con la tabla por competición
  const summary = bio.summary.length && sport.id !== 'futbol'
    ? `<div class="player-summary">${bio.summary.map((s) =>
      `<div><span class="ps-value">${esc(s.value)}</span><span class="ps-label">${esc(statLabel(s.label))}</span></div>`).join('')}</div>`
    : '';

  const splits = overview?.splits.length
    ? `<h3 class="player-section">${esc(t('player.stats'))}</h3>
      ${statsTable(overview.labels, overview.names, overview.splits.map((s) => ({ head: esc(splitName(s.name)), stats: s.stats })), t('player.split'))}`
    : '';

  const games = overview?.games.length
    ? `<h3 class="player-section">${esc(t('player.lastGames'))}</h3>
      ${statsTable(overview.gameLabels, overview.gameNames, overview.games.map((g) => ({
        head: `<span class="game-cell"><span class="game-res ${g.result === 'W' ? 'w' : g.result === 'L' ? 'l' : ''}">${esc(t(`player.result.${g.result}`) === `player.result.${g.result}` ? g.result : t(`player.result.${g.result}`))}</span>
          ${esc(g.atVs)} ${logo(g.opponentLogo, 'team-logo')} ${esc(g.opponent)} <span class="game-score">${esc(g.score)}</span></span>`,
        stats: g.stats,
      })), t('player.game'))}`
    : '';

  return `<div class="player-head">
      ${photo}
      <div class="player-id">
        <h2 class="player-name" id="player-modal-title">${esc(bio.name)}</h2>
        ${bio.team ? `<div class="player-team">${logo(bio.team.logo, 'team-logo')}${esc(bio.team.name)}</div>` : ''}
        <div class="player-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
      </div>
    </div>
    ${summary}${splits}${games}
    ${!splits && !games ? emptyState(t('player.noStats')) : ''}`;
}

// "Regular Season", "Career"… en el idioma elegido; los nombres de competiciones quedan igual
function splitName(name) {
  const key = `player.splits.${name.replace(/[^a-z]/gi, '')}`;
  return t(key) === key ? name : t(key);
}

// Aviso de temporada terminada, con el campeón si se pudo detectar
export function seasonEndCard(off, sport, league) {
  const heading = off.season ? t('offseason.ended', { season: off.season }) : t('offseason.endedNoSeason');
  const finalsKey = `offseason.finals.${sport.id}`;
  const title = t(finalsKey) === finalsKey ? league.name : t(finalsKey);
  const champ = off.champion?.team;
  return `<section class="season-end" aria-label="${esc(heading)}">
    <p class="season-end-kicker">${esc(heading)}</p>
    ${champ ? `<div class="season-end-champ">
      ${logo(champ.logo, 'season-end-logo')}
      <div>
        <div class="season-end-name">${esc(champ.name)}</div>
        <div class="season-end-title">${esc(t('offseason.champion', { title }))}</div>
      </div>
    </div>` : ''}
    <p class="season-end-hint">${esc(t('offseason.noCalendar'))}</p>
  </section>`;
}

export function skeletons(n, cls = '') {
  return Array.from({ length: n }, () => `<div class="skeleton ${cls}"></div>`).join('');
}

export function emptyState(text, hint = '') {
  return `<div class="state">${esc(text)}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
}

export function errorState(message) {
  return `<div class="state">${esc(t('errors.title'))}<small>${esc(message)}</small>
    <button type="button" data-action="retry">${esc(t('common.retry'))}</button></div>`;
}
