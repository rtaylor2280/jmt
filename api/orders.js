import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

function calcAvgCost(currentAvg, currentQty, changeQty, changeCost) {
  const newQty = currentQty + changeQty;
  if (newQty <= 0) return Number(currentAvg) || 0;
  return ((Number(currentAvg) * currentQty) + (Number(changeCost) * changeQty)) / newQty;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' && req.query.order_number) {
      const rows = await sql`SELECT * FROM purchased_items WHERE order_number = ${req.query.order_number} ORDER BY item_id`;
      return res.json(rows);
    }

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
      return res.status(200).json(row);
    }

    if (req.method === 'DELETE' && req.query.order_number) {
      const items = await sql`
        SELECT id, stock_item_id, qty_purchased, unit_cost, is_digital
        FROM purchased_items
        WHERE order_number = ${req.query.order_number}`;

      for (const item of items) {
        if (!item.is_digital && item.stock_item_id) {
          const [si] = await sql`SELECT qty_on_hand, avg_cost FROM stock_items WHERE id = ${item.stock_item_id}`;
          const newAvg = calcAvgCost(si.avg_cost, si.qty_on_hand, -item.qty_purchased, Number(item.unit_cost));
          await sql`UPDATE stock_items SET
            qty_on_hand = qty_on_hand - ${item.qty_purchased},
            avg_cost    = ${newAvg},
            updated_at  = NOW()
            WHERE id = ${item.stock_item_id}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${item.stock_item_id}, ${item.id}, ${-item.qty_purchased}, 'order_deleted')`;
        }
      }

      await sql`DELETE FROM purchased_items WHERE order_number = ${req.query.order_number}`;
      await sql`DELETE FROM orders WHERE order_number = ${req.query.order_number}`;
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}