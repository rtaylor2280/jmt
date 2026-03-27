import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { source_type, search } = req.query;
      const s   = search ? `%${search}%` : null;
      const src = source_type || null;
      let rows;
      if (src && s) {
        rows = await sql`SELECT * FROM purchased_items WHERE source_type=${src} AND (item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s}) ORDER BY created_at DESC`;
      } else if (src) {
        rows = await sql`SELECT * FROM purchased_items WHERE source_type=${src} ORDER BY created_at DESC`;
      } else if (s) {
        rows = await sql`SELECT * FROM purchased_items WHERE item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s} ORDER BY created_at DESC`;
      } else {
        rows = await sql`SELECT * FROM purchased_items ORDER BY created_at DESC`;
      }
      return res.json(rows);
    }

    // POST: add line item to an order, then recalc allocation
    if (req.method === 'POST') {
      const {
        order_number, item_name, variant, category, vendor, date_purchased,
        qty_purchased, unit_cost, condition, source_type, location, notes
      } = req.body;
      const [row] = await sql`
        INSERT INTO purchased_items
          (order_number, item_name, variant, category, vendor, date_purchased,
           qty_purchased, qty_remaining, unit_cost, condition, source_type, location, notes)
        VALUES
          (${order_number||null}, ${item_name}, ${variant||null}, ${category||null},
           ${vendor||null}, ${date_purchased||null},
           ${qty_purchased||1}, ${qty_purchased||1},
           ${unit_cost||0}, ${condition||'New'}, ${source_type}, ${location||null}, ${notes||null})
        RETURNING *`;
      if (order_number) await sql`SELECT recalc_allocation(${order_number})`;
      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}