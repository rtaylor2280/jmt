import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

function calcAvgCost(currentAvg, currentQty, changeQty, changeCost) {
  const newQty = currentQty + changeQty;
  if (newQty <= 0) return Number(currentAvg) || 0;
  return ((Number(currentAvg) * currentQty) + (Number(changeCost) * changeQty)) / newQty;
}

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
          WHERE item_id = ${id} RETURNING *`;
        return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
      }

      const [current] = await sql`SELECT * FROM purchased_items WHERE item_id = ${id}`;
      if (!current) return res.status(404).json({ error: 'Not found' });

      const {
        item_name, variant, vendor, date_purchased,
        qty_purchased, unit_cost, condition,
        category, location, notes, stock_item_id, is_digital,
        update_unit_cost
      } = body;

      const digital    = !!is_digital;
      const newStockId = !digital && stock_item_id ? parseInt(stock_item_id) : null;
      const oldStockId = current.is_digital ? null : (current.stock_item_id || null);
      const oldQty     = current.qty_purchased;
      const newQty     = parseInt(qty_purchased);
      const cost       = parseFloat(unit_cost) || 0;

      const [row] = await sql`
        UPDATE purchased_items SET
          item_name      = ${item_name},
          variant        = ${variant||null},
          vendor         = ${vendor||null},
          date_purchased = ${date_purchased||null},
          qty_purchased  = ${newQty},
          unit_cost      = ${cost},
          condition      = ${condition||'New'},
          category       = ${category||null},
          location       = ${location||null},
          notes          = ${notes||null},
          stock_item_id  = ${newStockId},
          is_digital     = ${digital}
        WHERE item_id = ${id} RETURNING *`;

      if (oldStockId && newStockId && oldStockId === newStockId) {
        const diff = newQty - oldQty;
        if (diff !== 0) {
          const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${newStockId}`;
          const newAvg = calcAvgCost(si.avg_cost, si.qty_on_hand, diff, cost);
          const shouldUpdateUnitCost = update_unit_cost !== false || Number(si.unit_cost) === 0;
          await sql`UPDATE stock_items SET
            qty_on_hand = qty_on_hand + ${diff},
            avg_cost    = ${newAvg},
            unit_cost   = ${shouldUpdateUnitCost ? cost : si.unit_cost},
            active      = true,
            updated_at  = NOW()
            WHERE id = ${newStockId}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${newStockId}, ${current.id}, ${diff}, 'purchase_edit')`;
        }
      } else {
        if (oldStockId) {
          const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${oldStockId}`;
          const newAvg = calcAvgCost(si.avg_cost, si.qty_on_hand, -oldQty, Number(current.unit_cost));
          await sql`UPDATE stock_items SET
            qty_on_hand = qty_on_hand - ${oldQty},
            avg_cost    = ${newAvg},
            updated_at  = NOW()
            WHERE id = ${oldStockId}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${oldStockId}, ${current.id}, ${-oldQty}, 'purchase_unlinked')`;
        }
        if (newStockId) {
          const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${newStockId}`;
          const newAvg = calcAvgCost(si.avg_cost, si.qty_on_hand, newQty, cost);
          const shouldUpdateUnitCost = update_unit_cost !== false || Number(si.unit_cost) === 0;
          await sql`UPDATE stock_items SET
            qty_on_hand = qty_on_hand + ${newQty},
            avg_cost    = ${newAvg},
            unit_cost   = ${shouldUpdateUnitCost ? cost : si.unit_cost},
            active      = true,
            updated_at  = NOW()
            WHERE id = ${newStockId}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${newStockId}, ${current.id}, ${newQty}, 'purchase_linked')`;
        }
      }

      return res.json(row);
    }

    if (req.method === 'DELETE') {
      const [current] = await sql`SELECT * FROM purchased_items WHERE item_id = ${id}`;
      if (!current) return res.status(404).end();

      if (!current.is_digital && current.stock_item_id) {
        const [si] = await sql`SELECT qty_on_hand, avg_cost FROM stock_items WHERE id = ${current.stock_item_id}`;
        const newAvg = calcAvgCost(si.avg_cost, si.qty_on_hand, -current.qty_purchased, Number(current.unit_cost));
        await sql`UPDATE stock_items SET
          qty_on_hand = qty_on_hand - ${current.qty_purchased},
          avg_cost    = ${newAvg},
          updated_at  = NOW()
          WHERE id = ${current.stock_item_id}`;
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