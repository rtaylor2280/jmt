import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  // POST: save order totals, then proportionally update inventory rows for that order_number
  if (req.method === 'POST') {
    const { order_number, vendor, order_date, shipping_total, tax_total, notes } = req.body;
    // Upsert the allocation record
    await sql`
      INSERT INTO order_allocations (order_number, vendor, order_date, shipping_total, tax_total, notes)
      VALUES (${order_number}, ${vendor}, ${order_date}, ${shipping_total}, ${tax_total}, ${notes})
      ON CONFLICT (order_number) DO UPDATE SET
        shipping_total = EXCLUDED.shipping_total, tax_total = EXCLUDED.tax_total`;
    // Get all items in this order and their total cost weight
    const items = await sql`
      SELECT item_id, (unit_cost * qty_purchased) AS line_cost
      FROM inventory WHERE order_number = ${order_number}`;
    const totalCost = items.reduce((s, r) => s + parseFloat(r.line_cost), 0);
    if (totalCost > 0) {
      for (const item of items) {
        const share = parseFloat(item.line_cost) / totalCost;
        await sql`
          UPDATE inventory SET
            shipping_allocated = ${(shipping_total * share).toFixed(2)},
            tax_allocated      = ${(tax_total * share).toFixed(2)}
          WHERE item_id = ${item.item_id}`;
      }
    }
    return res.status(200).json({ allocated: items.length });
  }
  if (req.method === 'GET') {
    return res.json(await sql`SELECT * FROM order_allocations ORDER BY order_date DESC`);
  }
}