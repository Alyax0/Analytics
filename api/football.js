export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const { endpoint, ...rest } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
 
  const params = new URLSearchParams(rest).toString();
  const url = `https://v3.football.api-sports.io/${endpoint}${params ? '?' + params : ''}`;
 
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-apisports-key': '524f2b1261243db603be484490193668'
      }
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
 
