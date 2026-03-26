import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method === 'GET') {
    const [row] = await sql`SELECT * FROM builds_view WHERE build_id = ${id}`;
    return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
  }
  if (req.method === 'PUT') {
    const { hilt_item_id, customer, tier_id, parts_cost, labor_value,
            target_price, listed_price, sold_price, date_sold, status, notes } = req.body;
    const [row] = await sql`
      UPDATE builds SET hilt_item_id=${hilt_item_id}, customer=${customer}, tier_id=${tier_id},
        parts_cost=${parts_cost}, labor_value=${labor_value}, target_price=${target_price},
        listed_price=${listed_price}, sold_price=${sold_price}, date_sold=${date_sold},
        status=${status}, notes=${notes}
      WHERE build_id = ${id} RETURNING *`;
    return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
  }
  if (req.method === 'DELETE') {
    await sql`DELETE FROM builds WHERE build_id = ${id}`;
    return res.status(204).end();
  }
}