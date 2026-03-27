Create as SEPARATE file: api/stock/receive.js

import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { stock_item_id, purchased_item_id, qty_received, unit_cost } = req.body;
    const [row] = await sql`
      INSERT INTO stock_receipts (stock_item_id, purchased_item_id, qty_received, unit_cost)
      VALUES (${stock_item_id}, ${purchased_item_id||null}, ${qty_received||1}, ${unit_cost||null})
      RETURNING *`;
    // Also decrement purchased_items qty_remaining
    if (purchased_item_id) {
      await sql`UPDATE purchased_items SET qty_remaining = qty_remaining - ${qty_received||1}
                WHERE item_id = ${purchased_item_id}`;
    }
    return res.status(201).json(row);
  } catch(e) { return res.status(500).json({ error: e.message }); }
}