import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query; // item_id string e.g. "EB-014"

  try {
    if (req.method === 'GET') {
      const [row] = await sql`SELECT * FROM inventory WHERE item_id = ${id}`;
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.json(row);
    }

    if (req.method === 'PUT') {
      const {
        category, vendor, order_number, date_purchased, item_name, variant,
        qty_purchased, qty_remaining, unit_cost, shipping_allocated, tax_allocated,
        condition, source_type, assigned_build, consumed, location, notes
      } = req.body;

      const [row] = await sql`
        UPDATE inventory SET
          category = ${category}, vendor = ${vendor}, order_number = ${order_number},
          date_purchased = ${date_purchased}, item_name = ${item_name}, variant = ${variant},
          qty_purchased = ${qty_purchased}, qty_remaining = ${qty_remaining},
          unit_cost = ${unit_cost}, shipping_allocated = ${shipping_allocated},
          tax_allocated = ${tax_allocated}, condition = ${condition},
          source_type = ${source_type}, assigned_build = ${assigned_build},
          consumed = ${consumed}, location = ${location}, notes = ${notes}
        WHERE item_id = ${id}
        RETURNING *`;
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.json(row);
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM inventory WHERE item_id = ${id}`;
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
