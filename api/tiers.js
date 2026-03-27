import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      return res.json(await sql`SELECT * FROM build_tiers ORDER BY id`);
    }
    if (req.method === 'POST') {
      const [row] = await sql`INSERT INTO build_tiers (name) VALUES (${req.body.name}) RETURNING *`;
      return res.status(201).json(row);
    }
    if (req.method === 'DELETE') {
      await sql`DELETE FROM build_tiers WHERE id = ${req.query.id}`;
      return res.status(204).end();
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
