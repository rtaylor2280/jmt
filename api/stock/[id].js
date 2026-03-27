import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  const { id } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const [row] = await sql`SELECT * FROM stock_items WHERE id = ${id}`;
      return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
    }
    if (req.method === 'PUT') {
      const { name, variant, category, source_type, qty_on_hand, location, notes } = req.body;
      const [row] = await sql`
        UPDATE stock_items SET name=${name}, variant=${variant||null}, category=${category||null},
          source_type=${source_type}, qty_on_hand=${qty_on_hand}, location=${location||null}, notes=${notes||null}
        WHERE id=${id} RETURNING *`;
      return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
    }
    if (req.method === 'DELETE') {
      await sql`DELETE FROM stock_items WHERE id=${id}`;
      return res.status(204).end();
    }
  } catch(e) { return res.status(500).json({ error: e.message }); }
}