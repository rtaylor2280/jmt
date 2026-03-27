import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET /api/orders?order_number=X  → line items for that order
    if (req.method === 'GET' && req.query.order_number) {
      const rows = await sql`
        SELECT * FROM purchased_items
        WHERE order_number = ${req.query.order_number}
        ORDER BY item_id`;
      return res.json(rows);
    }

    // GET /api/orders  → all orders with totals
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT o.*,
          COUNT(p.id)                                    AS item_count,
          COALESCE(SUM(p.unit_cost * p.qty_purchased),0) AS parts_total,
          COALESCE(SUM(p.total_line_cost),0)             AS order_total
        FROM orders o
        LEFT JOIN purchased_items p ON p.order_number = o.order_number
        GROUP BY o.id
        ORDER BY o.order_date DESC NULLS LAST, o.id DESC`;
      return res.json(rows);
    }

    // POST /api/orders  → upsert order header
    if (req.method === 'POST') {
      const { order_number, vendor, order_date, shipping_total, tax_total, notes } = req.body;
      const [row] = await sql`
        INSERT INTO orders (order_number, vendor, order_date, shipping_total, tax_total, notes)
        VALUES (${order_number}, ${vendor||null}, ${order_date||null},
                ${shipping_total||0}, ${tax_total||0}, ${notes||null})
        ON CONFLICT (order_number) DO UPDATE SET
          vendor         = EXCLUDED.vendor,
          order_date     = EXCLUDED.order_date,
          shipping_total = EXCLUDED.shipping_total,
          tax_total      = EXCLUDED.tax_total,
          notes          = EXCLUDED.notes,
          updated_at     = NOW()
        RETURNING *`;
      // Recalc allocation for existing items on this order
      await sql`SELECT recalc_allocation(${order_number})`;
      return res.status(200).json(row);
    }

    // DELETE /api/orders?order_number=X
    if (req.method === 'DELETE' && req.query.order_number) {
      await sql`DELETE FROM orders WHERE order_number = ${req.query.order_number}`;
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
