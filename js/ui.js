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
  const s = fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d);
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
  if (sportId === 'mlb') {
    // ESPN manda "Top 7th", "Bot 7th", "Mid 7th" o "End 7th"
    const half = { top: 'top', bot: 'bottom', bottom: 'bottom', mid: 'middle', middle: 'middle', end: 'end' }[
      m.detail.split(' ')[0].toLowerCase()];
    return half ? t(`match.inning.${half}`, { n: m.period }) : m.detail;
  }
  return m.detail;
}

function finalLabel(m) {
  // "Final/OT", "Final/12" (entradas), "FT-Pens", "AET"
  if (/pen/i.test(m.detail)) return t('match.finalPens');
  if (/AET/i.test(m.detail)) return t('match.finalAet');
  const extra = m.detail.split('/')[1];
  return extra ? `${t('match.final')} · ${extra}` : t('match.final');
}

function badge(m, sportId) {
  if (m.status === 'live') return `<span class="badge live">● ${esc(liveLabel(m, sportId))}</span>`;
  if (m.status === 'final') return `<span class="badge">${esc(finalLabel(m))}</span>`;
  if (m.status === 'off') {
    const key = `match.off.${m.statusName}`;
    const label = t(key);
    return `<span class="badge off">${esc(label === key ? m.detail : label)}</span>`;
  }
  return `<span class="badge scheduled">${esc(m.timeValid && m.date ? formatTime(m.date) : t('common.toConfirm'))}</span>`;
}

// ---------- Componentes ----------

function logo(url, cls = 'team-logo') {
  const src = safeUrl(url);
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" width="26" height="26" onerror="this.style.visibility='hidden'">`
    : `<span class="${cls} empty"></span>`;
}

function teamRow(side, m, showRecord) {
  const hasScore = (m.status === 'live' || m.status === 'final') && side.score !== null;
  const lost = m.status === 'final' && !side.winner && (m.home.winner || m.away.winner);
  return `<div class="team-row${lost ? ' lost' : ''}">
    ${logo(side.logo)}
    <span class="team-name">${esc(side.short)}${showRecord && side.record ? `<span class="team-record">${esc(side.record)}</span>` : ''}</span>
    <span class="team-score">${hasScore ? esc(side.score) : ''}</span>
  </div>`;
}

export function matchCard(m, sport, i = 0) {
  const [first, second] = sport.homeFirst ? [m.home, m.away] : [m.away, m.home];
  const showRecord = sport.id !== 'futbol';
  const head = [dayLabel(m.date), m.note].filter(Boolean).join(' · ');
  const label = t('match.aria', { a: first.name, b: second.name });
  return `<article class="match is-${m.status}" style="animation-delay:${Math.min(i, 12) * 30}ms" aria-label="${esc(label)}">
    <div class="match-head"><span class="match-note">${esc(head)}</span>${badge(m, sport.id)}</div>
    ${teamRow(first, m, showRecord)}
    ${teamRow(second, m, showRecord)}
  </article>`;
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

function formatStat(value, dec) {
  if (!Number.isFinite(value)) return '–';
  if (dec === 'avg') return value.toFixed(3).replace(/^0/, '');
  return value.toFixed(dec);
}

export function leaderCard(cat, sport) {
  const key = `leaders.${cat.name}`;
  const title = t(key) === key ? cat.abbr : t(key);
  const dec = sport.leaders[cat.name];
  return `<div class="leader-card">
    <div class="leader-title">${esc(title)}</div>
    ${cat.leaders.map((l, i) => `<div class="leader-row">
      <span class="leader-rank">${i + 1}</span>
      ${logo(l.photo, 'leader-photo')}
      <div class="leader-info"><div class="leader-name">${esc(l.name)}</div><div class="leader-team">${esc(l.team)}</div></div>
      <span class="leader-value">${esc(formatStat(l.value, dec))}</span>
    </div>`).join('')}
  </div>`;
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
