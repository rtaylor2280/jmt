import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
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
}