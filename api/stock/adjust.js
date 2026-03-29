import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { stock_item_id, qty_change, reason, notes } = req.body;

  if (!stock_item_id || qty_change === undefined || qty_change === 0) {
    return res.status(400).json({ error: 'stock_item_id and non-zero qty_change are required' });
  }

  try {
    const [item] = await sql`SELECT * FROM stock_items WHERE id = ${stock_item_id}`;
    if (!item) return res.status(404).json({ error: 'Stock item not found' });

    const newQty = item.qty_on_hand + parseInt(qty_change);
    if (newQty < 0) return res.status(400).json({ error: 'Adjustment would result in negative stock' });

    await sql`UPDATE stock_items SET qty_on_hand = ${newQty}, updated_at = NOW() WHERE id = ${stock_item_id}`;
    await sql`
      INSERT INTO stock_ledger (stock_item_id, qty_change, reason, notes)
      VALUES (${stock_item_id}, ${parseInt(qty_change)}, ${reason||'adjustment'}, ${notes||null})`;

    const [updated] = await sql`SELECT * FROM stock_items WHERE id = ${stock_item_id}`;
    return res.json(updated);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}