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
      let rows;
      const s = search ? `%${search}%` : null;
      const src = source_type || null;
      const con = consumed === 'true' ? true : consumed === 'false' ? false : null;

      if (src && con !== null && s) {
        rows = await sql`SELECT * FROM inventory WHERE source_type=${src} AND consumed=${con} AND (item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s}) ORDER BY created_at DESC`;
      } else if (src && con !== null) {
        rows = await sql`SELECT * FROM inventory WHERE source_type=${src} AND consumed=${con} ORDER BY created_at DESC`;
      } else if (src && s) {
        rows = await sql`SELECT * FROM inventory WHERE source_type=${src} AND (item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s}) ORDER BY created_at DESC`;
      } else if (con !== null && s) {
        rows = await sql`SELECT * FROM inventory WHERE consumed=${con} AND (item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s}) ORDER BY created_at DESC`;
      } else if (src) {
        rows = await sql`SELECT * FROM inventory WHERE source_type=${src} ORDER BY created_at DESC`;
      } else if (con !== null) {
        rows = await sql`SELECT * FROM inventory WHERE consumed=${con} ORDER BY created_at DESC`;
      } else if (s) {
        rows = await sql`SELECT * FROM inventory WHERE item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s} ORDER BY created_at DESC`;
      } else {
        rows = await sql`SELECT * FROM inventory ORDER BY created_at DESC`;
      }
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