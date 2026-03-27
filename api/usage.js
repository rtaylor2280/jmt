import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { build_id } = req.query;
      const rows = build_id
        ? await sql`SELECT u.*, s.name, s.sku FROM build_usage u JOIN stock_items s ON s.id = u.stock_item_id WHERE u.build_id = ${build_id} ORDER BY u.created_at`
        : await sql`SELECT u.*, s.name, s.sku FROM build_usage u JOIN stock_items s ON s.id = u.stock_item_id ORDER BY u.created_at DESC`;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { build_id, stock_item_id, qty_used, unit_cost } = req.body;
      const [row] = await sql`
        INSERT INTO build_usage (build_id, stock_item_id, qty_used, unit_cost)
        VALUES (${build_id}, ${stock_item_id}, ${qty_used ?? 1}, ${unit_cost})
        RETURNING *`;
      return res.status(201).json(row);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      await sql`DELETE FROM build_usage WHERE id = ${id}`;
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
