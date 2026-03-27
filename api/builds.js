import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM builds_view ORDER BY created_at DESC`;
      return res.json(rows);
    }
    if (req.method === 'POST') {
      const { hilt_item_id, customer, tier_id, parts_cost, labor_value,
              target_price, listed_price, sold_price, date_sold, status, notes } = req.body;
      const [row] = await sql`
        INSERT INTO builds (hilt_item_id, customer, tier_id, parts_cost, labor_value,
          target_price, listed_price, sold_price, date_sold, status, notes)
        VALUES (${hilt_item_id}, ${customer}, ${tier_id}, ${parts_cost}, ${labor_value},
          ${target_price}, ${listed_price}, ${sold_price}, ${date_sold}, ${status ?? 'In Progress'}, ${notes})
        RETURNING *`;
      return res.status(201).json(row);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}