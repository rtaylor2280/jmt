import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET /api/purchased-items?categories=true
    if (req.method === 'GET' && req.query.categories === 'true') {
      const rows = await sql`
        SELECT DISTINCT category FROM purchased_items
        WHERE category IS NOT NULL
        ORDER BY category`;
      return res.json(rows.map(r => r.category));
    }

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
        shipping_allocated, tax_allocated, stock_item_id
      } = req.body;

      // Insert purchased item
      const [row] = await sql`
        INSERT INTO purchased_items
          (order_number, item_name, variant, vendor, date_purchased,
           qty_purchased, qty_remaining, unit_cost, shipping_allocated, tax_allocated,
           condition, category, location, notes, stock_item_id)
        VALUES
          (${order_number||null}, ${item_name}, ${variant||null},
           ${vendor||null}, ${date_purchased||null},
           ${qty_purchased||1}, ${qty_purchased||1},
           ${unit_cost||0}, ${shipping_allocated||0}, ${tax_allocated||0},
           ${condition||'New'}, ${category||null}, ${location||null}, ${notes||null},
           ${stock_item_id||null})
        RETURNING *`;

      // If linked to stock item, increment qty and add ledger entry
      if (stock_item_id) {
        await sql`
          UPDATE stock_items SET qty_on_hand = qty_on_hand + ${qty_purchased||1}
          WHERE id = ${stock_item_id}`;
        await sql`
          INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
          VALUES (${stock_item_id}, ${row.id}, ${qty_purchased||1}, 'purchase')`;
      }

      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}