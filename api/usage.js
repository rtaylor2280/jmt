import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { build_id } = req.query;
    const rows = build_id
      ? await sql`SELECT u.*, i.item_name FROM build_usage u JOIN inventory i USING (item_id) WHERE u.build_id = ${build_id}`
      : await sql`SELECT u.*, i.item_name FROM build_usage u JOIN inventory i USING (item_id) ORDER BY u.created_at DESC`;
    return res.json(rows);
  }
  if (req.method === 'POST') {
    const { build_id, item_id, qty_used, unit_cost } = req.body;
    const [row] = await sql`
      INSERT INTO build_usage (build_id, item_id, qty_used, unit_cost)
      VALUES (${build_id}, ${item_id}, ${qty_used ?? 1}, ${unit_cost})
      RETURNING *`;
    return res.status(201).json(row);
  }
  if (req.method === 'DELETE') {
    const { id } = req.query;
    await sql`DELETE FROM build_usage WHERE id = ${id}`;
    return res.status(204).end();
  }
}