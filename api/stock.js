import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
	if (req.method === 'GET' && req.query.ledger === 'true') {
      const limit = parseInt(req.query.limit) || 200;
	  const offset = parseInt(req.query.offset) || 0;
      const rows = await sql`
        SELECT
          sl.id, sl.qty_change, sl.reason, sl.notes,
          sl.created_at,
          si.sku, si.name AS stock_name,
          pi.item_id AS purchased_item_ref,
          pi.order_number
        FROM stock_ledger sl
        JOIN  stock_items     si ON si.id = sl.stock_item_id
        LEFT JOIN purchased_items pi ON pi.id = sl.purchased_item_id
        ORDER BY sl.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`;
      return res.json(rows);
    }  
    if (req.method === 'GET') {
      const { category, search, low_stock, active } = req.query;
      const s    = search ? `%${search}%` : null;
      const cat  = category || null;
      // active filter: 'true' = active only, 'false' = retired only, 'all' = no filter (default: active only)
      const activeFilter = active === 'all' ? null : active === 'false' ? false : true;

      let rows;
      if (cat && s && activeFilter !== null) {
        rows = await sql`SELECT * FROM stock_items WHERE category=${cat} AND (name ILIKE ${s} OR sku ILIKE ${s}) AND active=${activeFilter} ORDER BY name`;
      } else if (cat && s) {
        rows = await sql`SELECT * FROM stock_items WHERE category=${cat} AND (name ILIKE ${s} OR sku ILIKE ${s}) ORDER BY name`;
      } else if (cat && activeFilter !== null) {
        rows = await sql`SELECT * FROM stock_items WHERE category=${cat} AND active=${activeFilter} ORDER BY name`;
      } else if (s && activeFilter !== null) {
        rows = await sql`SELECT * FROM stock_items WHERE (name ILIKE ${s} OR sku ILIKE ${s}) AND active=${activeFilter} ORDER BY name`;
      } else if (cat) {
        rows = await sql`SELECT * FROM stock_items WHERE category=${cat} ORDER BY name`;
      } else if (s) {
        rows = await sql`SELECT * FROM stock_items WHERE name ILIKE ${s} OR sku ILIKE ${s} ORDER BY name`;
      } else if (activeFilter !== null) {
        rows = await sql`SELECT * FROM stock_items WHERE active=${activeFilter} ORDER BY name`;
      } else if (low_stock === 'true') {
        rows = await sql`SELECT * FROM stock_items WHERE qty_on_hand <= 1 ORDER BY qty_on_hand, name`;
      } else {
        rows = await sql`SELECT * FROM stock_items ORDER BY name`;
      }
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { name, variant, category, sku_prefix, location, notes } = req.body;
      const skuSeed = sku_prefix ? sku_prefix.toUpperCase() : null;
      const [row] = await sql`
        INSERT INTO stock_items (name, variant, category, sku, location, notes)
        VALUES (${name}, ${variant||null}, ${category||null},
                ${skuSeed},
                ${location||null}, ${notes||null})
        RETURNING *`;
      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}