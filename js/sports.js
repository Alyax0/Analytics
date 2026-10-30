// Configuración por deporte. Para sumar una liga alcanza con agregarla acá y
// en la lista LEAGUES de api/espn.js.
//
// fetchBy: cómo se piden los partidos a ESPN. 'month' trae el mes entero en un
// pedido (fútbol: pocos partidos por mes); 'day' pide día por día (NBA y MLB
// tienen hasta 15 partidos diarios y el mes entero pesa varios MB).
// logo: id del logo de la liga en el CDN de ESPN (versión para fondo oscuro).
// homeFirst: el fútbol muestra primero al local; NBA y MLB, al visitante.
// standings: columnas de la tabla (nombres de stats de ESPN) y por cuál ordenar.

export const SPORTS = {
  futbol: {
    id: 'futbol',
    brand: 'FUT',
    accent: '#00e5a0',
    fetchBy: 'month',
    pastDays: 10,
    nextDays: 14,
    homeFirst: true,
    sections: ['partidos', 'tabla'],
    leagues: [
      { id: 'eng.1', name: 'Premier League', logo: 23 },
      { id: 'esp.1', name: 'LaLiga', logo: 15 },
      { id: 'arg.1', name: 'Liga Profesional', logo: 1 },
      { id: 'mex.1', name: 'Liga MX', logo: 22 },
      { id: 'ita.1', name: 'Serie A', logo: 12 },
      { id: 'ger.1', name: 'Bundesliga', logo: 10 },
      { id: 'fra.1', name: 'Ligue 1', logo: 9 },
      { id: 'ned.1', name: 'Eredivisie', logo: 11 },
      { id: 'uefa.champions', name: 'Champions League', logo: 2 },
      { id: 'uefa.europa', name: 'Europa League', logo: 2310 },
      { id: 'conmebol.libertadores', name: 'Libertadores', logo: 58 },
    ],
    standings: {
      sortBy: 'rank',
      columns: [
        { key: 'gamesPlayed', label: 'played' },
        { key: 'wins', label: 'won' },
        { key: 'ties', label: 'drawn' },
        { key: 'losses', label: 'lost' },
        { key: 'pointsFor', label: 'goalsFor', wide: true },
        { key: 'pointsAgainst', label: 'goalsAgainst', wide: true },
        { key: 'pointDifferential', label: 'goalDiff' },
        { key: 'points', label: 'points', main: true },
      ],
    },
  },
  nba: {
    id: 'nba',
    brand: 'NBA',
    accent: '#c8a84b',
    fetchBy: 'day',
    pastDays: 4,
    nextDays: 3,
    homeFirst: false,
    sections: ['partidos', 'tabla', 'lideres'],
    leagues: [{ id: 'nba', name: 'NBA' }],
    standings: {
      sortBy: 'playoffSeed',
      columns: [
        { key: 'wins', label: 'wins' },
        { key: 'losses', label: 'losses' },
        { key: 'winPercent', label: 'pct', main: true },
        { key: 'gamesBehind', label: 'gb' },
        { key: 'streak', label: 'streak', wide: true },
        { key: 'Last Ten Games', label: 'last10', wide: true },
      ],
    },
    // ESPN nombra la temporada 2026-27 con el año en que termina
    season: (d) => (d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear()),
    // nombre de la categoría en ESPN → decimales
    leaders: { pointsPerGame: 1, reboundsPerGame: 1, assistsPerGame: 1, stealsPerGame: 1, blocksPerGame: 1, '3PointsMadePerGame': 1 },
  },
  mlb: {
    id: 'mlb',
    brand: 'MLB',
    accent: '#4d9fff',
    fetchBy: 'day',
    pastDays: 4,
    nextDays: 3,
    homeFirst: false,
    sections: ['partidos', 'tabla', 'lideres'],
    leagues: [{ id: 'mlb', name: 'MLB' }],
    standings: {
      sortBy: 'playoffSeed',
      columns: [
        { key: 'wins', label: 'wins' },
        { key: 'losses', label: 'losses' },
        { key: 'winPercent', label: 'pct', main: true },
        { key: 'gamesBehind', label: 'gb' },
        { key: 'streak', label: 'streak', wide: true },
        { key: 'Last Ten Games', label: 'last10', wide: true },
      ],
    },
    // Enero y febrero todavía muestran la temporada anterior
    season: (d) => (d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1),
    // 'avg' se muestra como .300
    leaders: { avg: 'avg', homeRuns: 0, RBIs: 0, ERA: 2, strikeouts: 0, saves: 0 },
  },
};

export const DEFAULT_SPORT = 'futbol';
