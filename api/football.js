export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path, ...rest } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path' });

  const params = new URLSearchParams(rest).toString();
  const url = `https://api.football-data.org/v4/${path}${params ? '?' + params : ''}`;

  console.log('Fetching:', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'X-Auth-Token': 'be0cba1274884061be37400a383508ae' }
  });

  const data = await response.json();
  res.status(response.status).json(data);
}
