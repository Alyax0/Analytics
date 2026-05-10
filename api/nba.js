export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path' });

  try {
    // Decodear el path que viene encodeado desde el frontend
    const decoded = decodeURIComponent(path);
    const url = 'https://api.balldontlie.io/v1/' + decoded;

    console.log('NBA proxy fetching:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': 'b922db60-e2d6-4de6-b156-766b691e668a'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('API error:', response.status, text);
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch(e) {
    console.error('Proxy error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
