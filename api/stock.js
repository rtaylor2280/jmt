import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { category, search, low_stock } = req.query;
      const s   = search ? `%${search}%` : null;
      const cat = category || null;
      let rows;
      if (cat && s) {
        rows = await sql`SELECT * FROM stock_items WHERE category=${cat} AND (name ILIKE ${s} OR sku ILIKE ${s}) ORDER BY name`;
      } else if (cat) {
        rows = await sql`SELECT * FROM stock_items WHERE category=${cat} ORDER BY name`;
      } else if (s) {
        rows = await sql`SELECT * FROM stock_items WHERE name ILIKE ${s} OR sku ILIKE ${s} ORDER BY name`;
      } else if (low_stock === 'true') {
        rows = await sql`SELECT * FROM stock_items WHERE qty_on_hand <= 1 ORDER BY qty_on_hand, name`;
      } else {
        rows = await sql`SELECT * FROM stock_items ORDER BY name`;
      }
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { name, variant, category, location, notes } = req.body;
      const [row] = await sql`
        INSERT INTO stock_items (name, variant, category, location, notes)
        VALUES (${name}, ${variant||null}, ${category||null}, ${location||null}, ${notes||null})
        RETURNING *`;
      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}