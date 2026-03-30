import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

function calcAvgCost(currentAvg, currentQty, changeQty, changeCost) {
  const newQty = currentQty + changeQty;
  if (newQty <= 0) return Number(currentAvg) || 0;
  return ((Number(currentAvg) * currentQty) + (Number(changeCost) * changeQty)) / newQty;
}

function landedCostPerUnit(unit_cost, qty, shipping_allocated, tax_allocated) {
  const q = parseInt(qty) || 1;
  return (parseFloat(unit_cost) || 0) + ((parseFloat(shipping_allocated) || 0) + (parseFloat(tax_allocated) || 0)) / q;
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

      // Partial update: allocation values changed — recalc avg/unit cost on stock
      if (body._partial) {
        const [current] = await sql`SELECT * FROM purchased_items WHERE item_id = ${id}`;
        if (!current) return res.status(404).json({ error: 'Not found' });

        const oldLanded = landedCostPerUnit(current.unit_cost, current.qty_purchased, current.shipping_allocated, current.tax_allocated);
        const newLanded = landedCostPerUnit(current.unit_cost, current.qty_purchased, body.shipping_allocated, body.tax_allocated);

        const [row] = await sql`
          UPDATE purchased_items SET
            shipping_allocated = ${body.shipping_allocated},
            tax_allocated      = ${body.tax_allocated}
          WHERE item_id = ${id} RETURNING *`;

        // If linked to stock, reverse old landed cost contribution and apply new
        if (!current.is_digital && current.stock_item_id) {
          const qty = current.qty_purchased;
          const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${current.stock_item_id}`;
          // Reverse old, apply new
          let avg = calcAvgCost(si.avg_cost, si.qty_on_hand, -qty, oldLanded);
          avg = calcAvgCost(avg, si.qty_on_hand - qty, qty, newLanded);
          await sql`UPDATE stock_items SET avg_cost = ${avg}, updated_at = NOW() WHERE id = ${current.stock_item_id}`;
        }

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

      // Use stored allocations for landed cost on edits (allocations are managed separately)
      const shipAlloc  = parseFloat(current.shipping_allocated) || 0;
      const taxAlloc   = parseFloat(current.tax_allocated) || 0;
      const oldLanded  = landedCostPerUnit(current.unit_cost, oldQty, shipAlloc, taxAlloc);
      const newLanded  = landedCostPerUnit(cost, newQty, shipAlloc, taxAlloc);

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
        if (diff !== 0 || oldLanded !== newLanded) {
          const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${newStockId}`;
          // Reverse old contribution, apply new
          let avg = calcAvgCost(si.avg_cost, si.qty_on_hand, -oldQty, oldLanded);
          avg = calcAvgCost(avg, si.qty_on_hand - oldQty, newQty, newLanded);
          const shouldUpdateUnitCost = update_unit_cost !== false || Number(si.unit_cost) === 0;
          await sql`UPDATE stock_items SET
            qty_on_hand = qty_on_hand + ${diff},
            avg_cost    = ${avg},
            unit_cost   = ${shouldUpdateUnitCost ? newLanded : si.unit_cost},
            active      = true,
            updated_at  = NOW()
            WHERE id = ${newStockId}`;
          if (diff !== 0) {
            await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
              VALUES (${newStockId}, ${current.id}, ${diff}, 'purchase_edit')`;
          }
        }
      } else {
        if (oldStockId) {
          const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${oldStockId}`;
          const avg = calcAvgCost(si.avg_cost, si.qty_on_hand, -oldQty, oldLanded);
          await sql`UPDATE stock_items SET
            qty_on_hand = qty_on_hand - ${oldQty},
            avg_cost    = ${avg},
            updated_at  = NOW()
            WHERE id = ${oldStockId}`;
          await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
            VALUES (${oldStockId}, ${current.id}, ${-oldQty}, 'purchase_unlinked')`;
        }
        if (newStockId) {
          const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${newStockId}`;
          const avg = calcAvgCost(si.avg_cost, si.qty_on_hand, newQty, newLanded);
          const shouldUpdateUnitCost = update_unit_cost !== false || Number(si.unit_cost) === 0;
          await sql`UPDATE stock_items SET
            qty_on_hand = qty_on_hand + ${newQty},
            avg_cost    = ${avg},
            unit_cost   = ${shouldUpdateUnitCost ? newLanded : si.unit_cost},
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
        const landed = landedCostPerUnit(current.unit_cost, current.qty_purchased, current.shipping_allocated, current.tax_allocated);
        const [si] = await sql`SELECT qty_on_hand, avg_cost FROM stock_items WHERE id = ${current.stock_item_id}`;
        const avg = calcAvgCost(si.avg_cost, si.qty_on_hand, -current.qty_purchased, landed);
        await sql`UPDATE stock_items SET
          qty_on_hand = qty_on_hand - ${current.qty_purchased},
          avg_cost    = ${avg},
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