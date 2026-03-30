import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      const [row] = await sql`SELECT * FROM stock_items WHERE id = ${id}`;
      if (!row) return res.status(404).json({ error: 'Not found' });
      // Get ledger entries
      const ledger = await sql`
        SELECT sl.*,
          pi.item_id     AS purchased_item_ref,
          pi.order_number AS order_number
        FROM stock_ledger sl
        LEFT JOIN purchased_items pi ON pi.id = sl.purchased_item_id
        WHERE sl.stock_item_id = ${id}
        ORDER BY sl.created_at DESC
        LIMIT 50`;
      return res.json({ ...row, ledger });
    }

    if (req.method === 'PUT') {
      const body = req.body;

      // Retire/activate toggle
      if (body._toggle_active !== undefined) {
        const [row] = await sql`
          UPDATE stock_items SET active = ${body._toggle_active}, updated_at = NOW()
          WHERE id = ${id} RETURNING *`;
        return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
      }

      // Info fields only
      const { name, variant, category, location, notes, low_stock_threshold } = body;
      const threshold = low_stock_threshold !== '' && low_stock_threshold != null
        ? parseInt(low_stock_threshold) : null;
      const [row] = await sql`
        UPDATE stock_items SET
          name                = ${name},
          variant             = ${variant||null},
          category            = ${category||null},
          location            = ${location||null},
          notes               = ${notes||null},
          low_stock_threshold = ${threshold}
        WHERE id = ${id}
        RETURNING *`;
      return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
    }

    if (req.method === 'DELETE') {
      const [linked] = await sql`
        SELECT COUNT(*) as cnt FROM purchased_items WHERE stock_item_id = ${id}`;
      if (parseInt(linked.cnt) > 0) {
        return res.status(400).json({ error: 'Cannot delete stock item with linked purchases' });
      }
      await sql`DELETE FROM stock_items WHERE id = ${id}`;
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}