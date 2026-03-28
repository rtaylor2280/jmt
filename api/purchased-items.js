import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { category, search } = req.query;
      const s   = search ? `%${search}%` : null;
      const cat = category || null;
      let rows;
      if (cat && s) {
        rows = await sql`SELECT * FROM purchased_items WHERE category=${cat} AND (item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s}) ORDER BY created_at DESC`;
      } else if (cat) {
        rows = await sql`SELECT * FROM purchased_items WHERE category=${cat} ORDER BY created_at DESC`;
      } else if (s) {
        rows = await sql`SELECT * FROM purchased_items WHERE item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s} ORDER BY created_at DESC`;
      } else {
        rows = await sql`SELECT * FROM purchased_items ORDER BY created_at DESC`;
      }
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const {
        order_number, item_name, variant, vendor, date_purchased,
        qty_purchased, unit_cost, condition, category, location, notes,
        shipping_allocated, tax_allocated
      } = req.body;
      const [row] = await sql`
        INSERT INTO purchased_items
          (order_number, item_name, variant, vendor, date_purchased,
           qty_purchased, qty_remaining, unit_cost, shipping_allocated, tax_allocated,
           condition, category, location, notes)
        VALUES
          (${order_number||null}, ${item_name}, ${variant||null},
           ${vendor||null}, ${date_purchased||null},
           ${qty_purchased||1}, ${qty_purchased||1},
           ${unit_cost||0}, ${shipping_allocated||0}, ${tax_allocated||0},
           ${condition||'New'}, ${category||null}, ${location||null}, ${notes||null})
        RETURNING *`;
      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}