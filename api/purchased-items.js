import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

function calcAvgCost(currentAvg, currentQty, changeQty, changeCost) {
  const newQty = currentQty + changeQty;
  if (newQty <= 0) return Number(currentAvg) || 0;
  return ((Number(currentAvg) * currentQty) + (Number(changeCost) * changeQty)) / newQty;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' && req.query.categories === 'true') {
      const rows = await sql`SELECT DISTINCT category FROM purchased_items WHERE category IS NOT NULL ORDER BY category`;
      return res.json(rows.map(r => r.category));
    }

    if (req.method === 'GET') {
      const { category, search } = req.query;
      const s = search ? `%${search}%` : null;
      const cat = category || null;
      let rows;
      if (cat && s)  rows = await sql`SELECT * FROM purchased_items WHERE category=${cat} AND (item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s}) ORDER BY created_at DESC`;
      else if (cat)  rows = await sql`SELECT * FROM purchased_items WHERE category=${cat} ORDER BY created_at DESC`;
      else if (s)    rows = await sql`SELECT * FROM purchased_items WHERE item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s} ORDER BY created_at DESC`;
      else           rows = await sql`SELECT * FROM purchased_items ORDER BY created_at DESC`;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const {
        order_number, item_name, variant, vendor, date_purchased,
        qty_purchased, unit_cost, condition, category, location, notes,
        shipping_allocated, tax_allocated, stock_item_id, is_digital,
        update_unit_cost
      } = req.body;

      const digital  = !!is_digital;
      const stockId  = !digital && stock_item_id ? parseInt(stock_item_id) : null;
      const qty      = parseInt(qty_purchased) || 1;
      const cost     = parseFloat(unit_cost) || 0;

      const [row] = await sql`
        INSERT INTO purchased_items
          (order_number, item_name, variant, vendor, date_purchased,
           qty_purchased, unit_cost, shipping_allocated, tax_allocated,
           condition, category, location, notes, stock_item_id, is_digital)
        VALUES
          (${order_number||null}, ${item_name}, ${variant||null},
           ${vendor||null}, ${date_purchased||null},
           ${qty}, ${cost}, ${shipping_allocated||0}, ${tax_allocated||0},
           ${condition||'New'}, ${category||null}, ${location||null}, ${notes||null},
           ${stockId}, ${digital})
        RETURNING *`;

      if (stockId) {
        const [si] = await sql`SELECT qty_on_hand, avg_cost, unit_cost FROM stock_items WHERE id = ${stockId}`;
        const newAvg = calcAvgCost(si.avg_cost, si.qty_on_hand, qty, cost);
        const shouldUpdateUnitCost = update_unit_cost !== false || Number(si.unit_cost) === 0;
        await sql`
          UPDATE stock_items SET
            qty_on_hand = qty_on_hand + ${qty},
            avg_cost    = ${newAvg},
            unit_cost   = ${shouldUpdateUnitCost ? cost : si.unit_cost},
            active      = true,
            updated_at  = NOW()
          WHERE id = ${stockId}`;
        await sql`INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason)
          VALUES (${stockId}, ${row.id}, ${qty}, 'purchase')`;
      }

      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}