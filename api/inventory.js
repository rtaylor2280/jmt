import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { source_type, consumed, search } = req.query;
      let q = `SELECT * FROM inventory WHERE 1=1`;
      const params = [];
      if (source_type) { params.push(source_type); q += ` AND source_type = $${params.length}`; }
      if (consumed !== undefined) { params.push(consumed === 'true'); q += ` AND consumed = $${params.length}`; }
      if (search) { params.push(`%${search}%`); q += ` AND (item_name ILIKE $${params.length} OR item_id ILIKE $${params.length} OR vendor ILIKE $${params.length})`; }
      q += ` ORDER BY created_at DESC`;
      const rows = await sql.unsafe(q, params);
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const {
        category, vendor, order_number, date_purchased, item_name, variant,
        qty_purchased, qty_remaining, unit_cost, shipping_allocated, tax_allocated,
        condition, source_type, assigned_build, consumed, location, notes
      } = req.body;

      const [row] = await sql`
        INSERT INTO inventory
          (category, vendor, order_number, date_purchased, item_name, variant,
           qty_purchased, qty_remaining, unit_cost, shipping_allocated, tax_allocated,
           condition, source_type, assigned_build, consumed, location, notes)
        VALUES
          (${category}, ${vendor}, ${order_number}, ${date_purchased}, ${item_name}, ${variant},
           ${qty_purchased ?? 1}, ${qty_remaining ?? qty_purchased ?? 1},
           ${unit_cost ?? 0}, ${shipping_allocated ?? 0}, ${tax_allocated ?? 0},
           ${condition}, ${source_type}, ${assigned_build}, ${consumed ?? false}, ${location}, ${notes})
        RETURNING *`;
      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
