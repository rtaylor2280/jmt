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
      const [row] = await sql`SELECT * FROM purchased_items WHERE item_id = ${id}`;
      return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
    }

    if (req.method === 'PUT') {
      const body = req.body;

      if (body._partial) {
        const [row] = await sql`
          UPDATE purchased_items SET
            shipping_allocated = ${body.shipping_allocated},
            tax_allocated      = ${body.tax_allocated}
          WHERE item_id = ${id}
          RETURNING *`;
        return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
      }

      const [current] = await sql`SELECT * FROM purchased_items WHERE item_id = ${id}`;
      if (!current) return res.status(404).json({ error: 'Not found' });

      const {
        item_name, variant, vendor, date_purchased,
        qty_purchased, unit_cost, condition,
        category, location, notes, stock_item_id, is_digital
      } = body;

      const digital    = !!is_digital;
      const newStockId = !digital && stock_item_id ? parseInt(stock_item_id) : null;
      const oldStockId = current.is_digital ? null : (current.stock_item_id || null);
      const oldQty     = current.qty_purchased;
      const newQty     = parseInt(qty_purchased);

      const [row] = await sql`
        UPDATE purchased_items SET
          item_name      = ${item_name},
          variant        = ${variant||null},
          vendor         = ${vendor||null},
          date_purchased = ${date_purchased||null},
          qty_purchased  = ${newQty},
          unit_cost      = ${unit_cost},
          condition      = ${condition||'New'},
          category       = ${category||null},
          location       = ${location||null},
          notes          = ${notes||null},
          stock_item_id  = ${newStockId},
          is_digital     = ${digital}
        WHERE item_id = ${id}
        RETURNING *`;

      // Handle stock adjustments — skip entirely if switching to/from digital
      if (oldStockId && newStockId && oldStockId === newStockId) {
        // Same stock item — adjust for qty difference
        const diff = newQty - oldQty;
        if (diff !== 0) {
          await sql`UPDATE stock_items SET qty_on_hand = qty_on_hand + ${diff}, active = true, updated_at = NOW() WHERE id = ${newStockId}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${newStockId}, ${current.id}, ${diff}, 'purchase_edit')`;
        }
      } else {
        // Stock item changed (or digital toggle changed) — reverse old, apply new
        if (oldStockId) {
          await sql`UPDATE stock_items SET qty_on_hand = qty_on_hand - ${oldQty}, updated_at = NOW() WHERE id = ${oldStockId}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${oldStockId}, ${current.id}, ${-oldQty}, 'purchase_unlinked')`;
        }
        if (newStockId) {
          await sql`UPDATE stock_items SET qty_on_hand = qty_on_hand + ${newQty}, active = true, updated_at = NOW() WHERE id = ${newStockId}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${newStockId}, ${current.id}, ${newQty}, 'purchase_linked')`;
        }
      }

      return res.json(row);
    }

    if (req.method === 'DELETE') {
      const [current] = await sql`SELECT * FROM purchased_items WHERE item_id = ${id}`;
      if (!current) return res.status(404).end();

      // Only reverse stock if not digital and linked
      if (!current.is_digital && current.stock_item_id) {
        await sql`UPDATE stock_items SET qty_on_hand = qty_on_hand - ${current.qty_purchased}, updated_at = NOW() WHERE id = ${current.stock_item_id}`;
        await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
          VALUES (${current.stock_item_id}, ${current.id}, ${-current.qty_purchased}, 'purchase_deleted')`;
      }

      await sql`DELETE FROM purchased_items WHERE item_id = ${id}`;
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}