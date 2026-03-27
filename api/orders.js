import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // If order_number param provided, return line items for that order
      if (req.query.order_number) {
        const rows = await sql`
          SELECT * FROM inventory
          WHERE order_number = ${req.query.order_number}
          ORDER BY item_id`;
        return res.json(rows);
      }

      // Otherwise return all orders with computed totals
      const rows = await sql`
        SELECT
          o.*,
          COUNT(i.id)                          AS item_count,
          COALESCE(SUM(i.unit_cost * i.qty_purchased), 0) AS parts_total,
          COALESCE(SUM(i.total_line_cost), 0)  AS order_total
        FROM order_allocations o
        LEFT JOIN inventory i ON i.order_number = o.order_number
        GROUP BY o.id
        ORDER BY o.order_date DESC NULLS LAST, o.id DESC`;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { order_number, vendor, order_date, shipping_total, tax_total, notes } = req.body;

      await sql`
        INSERT INTO order_allocations (order_number, vendor, order_date, shipping_total, tax_total, notes)
        VALUES (${order_number}, ${vendor}, ${order_date}, ${shipping_total}, ${tax_total}, ${notes})
        ON CONFLICT (order_number) DO UPDATE SET
          shipping_total = EXCLUDED.shipping_total,
          tax_total      = EXCLUDED.tax_total`;

      const items = await sql`
        SELECT item_id, (unit_cost * qty_purchased) AS line_cost
        FROM inventory WHERE order_number = ${order_number}`;
      const totalCost = items.reduce((s, r) => s + parseFloat(r.line_cost || 0), 0);
      if (totalCost > 0) {
        for (const item of items) {
          const share = parseFloat(item.line_cost) / totalCost;
          await sql`
            UPDATE inventory SET
              shipping_allocated = ${((shipping_total * share)).toFixed(2)},
              tax_allocated      = ${((tax_total * share)).toFixed(2)}
            WHERE item_id = ${item.item_id}`;
        }
      }
      return res.status(200).json({ allocated: items.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}