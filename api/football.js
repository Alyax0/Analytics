export default async function handler(req, res) {
  const { path } = req.query;

  const response = await fetch(
    `https://api.football-data.org/v4/${path}`,
    { headers: { 'X-Auth-Token': 'be0cba1274884061be37400a383508ae' } }
  );

  const data = await response.json();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(data);
}
