// ── api/builds.js ─────────────────────────────────────────────────────────────
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


// ── api/builds/[id].js ────────────────────────────────────────────────────────
// (create this as a separate file in api/builds/[id].js)
//
// import { neon } from '@neondatabase/serverless';
// const sql = neon(process.env.DATABASE_URL);
// export default async function handler(req, res) {
//   const { id } = req.query;
//   if (req.method === 'GET') {
//     const [row] = await sql`SELECT * FROM builds_view WHERE build_id = ${id}`;
//     return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
//   }
//   if (req.method === 'PUT') {
//     const { hilt_item_id, customer, tier_id, parts_cost, labor_value,
//             target_price, listed_price, sold_price, date_sold, status, notes } = req.body;
//     const [row] = await sql`
//       UPDATE builds SET hilt_item_id=${hilt_item_id}, customer=${customer}, tier_id=${tier_id},
//         parts_cost=${parts_cost}, labor_value=${labor_value}, target_price=${target_price},
//         listed_price=${listed_price}, sold_price=${sold_price}, date_sold=${date_sold},
//         status=${status}, notes=${notes}
//       WHERE build_id = ${id} RETURNING *`;
//     return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
//   }
//   if (req.method === 'DELETE') {
//     await sql`DELETE FROM builds WHERE build_id = ${id}`;
//     return res.status(204).end();
//   }
// }


// ── api/usage.js ──────────────────────────────────────────────────────────────
// (create as api/usage.js)
//
// import { neon } from '@neondatabase/serverless';
// const sql = neon(process.env.DATABASE_URL);
// export default async function handler(req, res) {
//   if (req.method === 'GET') {
//     const { build_id } = req.query;
//     const rows = build_id
//       ? await sql`SELECT u.*, i.item_name FROM build_usage u JOIN inventory i USING (item_id) WHERE u.build_id = ${build_id}`
//       : await sql`SELECT u.*, i.item_name FROM build_usage u JOIN inventory i USING (item_id) ORDER BY u.created_at DESC`;
//     return res.json(rows);
//   }
//   if (req.method === 'POST') {
//     const { build_id, item_id, qty_used, unit_cost } = req.body;
//     const [row] = await sql`
//       INSERT INTO build_usage (build_id, item_id, qty_used, unit_cost)
//       VALUES (${build_id}, ${item_id}, ${qty_used ?? 1}, ${unit_cost})
//       RETURNING *`;
//     return res.status(201).json(row);
//   }
//   if (req.method === 'DELETE') {
//     const { id } = req.query;
//     await sql`DELETE FROM build_usage WHERE id = ${id}`;
//     return res.status(204).end();
//   }
// }


// ── api/tiers.js ──────────────────────────────────────────────────────────────
// (create as api/tiers.js)
//
// import { neon } from '@neondatabase/serverless';
// const sql = neon(process.env.DATABASE_URL);
// export default async function handler(req, res) {
//   if (req.method === 'GET') {
//     return res.json(await sql`SELECT * FROM build_tiers ORDER BY id`);
//   }
//   if (req.method === 'POST') {
//     const [row] = await sql`INSERT INTO build_tiers (name) VALUES (${req.body.name}) RETURNING *`;
//     return res.status(201).json(row);
//   }
//   if (req.method === 'DELETE') {
//     await sql`DELETE FROM build_tiers WHERE id = ${req.query.id}`;
//     return res.status(204).end();
//   }
// }


// ── api/orders.js (shipping/tax allocation) ───────────────────────────────────
// (create as api/orders.js)
//
// import { neon } from '@neondatabase/serverless';
// const sql = neon(process.env.DATABASE_URL);
// export default async function handler(req, res) {
//   // POST: save order totals, then proportionally update inventory rows for that order_number
//   if (req.method === 'POST') {
//     const { order_number, vendor, order_date, shipping_total, tax_total, notes } = req.body;
//     // Upsert the allocation record
//     await sql`
//       INSERT INTO order_allocations (order_number, vendor, order_date, shipping_total, tax_total, notes)
//       VALUES (${order_number}, ${vendor}, ${order_date}, ${shipping_total}, ${tax_total}, ${notes})
//       ON CONFLICT (order_number) DO UPDATE SET
//         shipping_total = EXCLUDED.shipping_total, tax_total = EXCLUDED.tax_total`;
//     // Get all items in this order and their total cost weight
//     const items = await sql`
//       SELECT item_id, (unit_cost * qty_purchased) AS line_cost
//       FROM inventory WHERE order_number = ${order_number}`;
//     const totalCost = items.reduce((s, r) => s + parseFloat(r.line_cost), 0);
//     if (totalCost > 0) {
//       for (const item of items) {
//         const share = parseFloat(item.line_cost) / totalCost;
//         await sql`
//           UPDATE inventory SET
//             shipping_allocated = ${(shipping_total * share).toFixed(2)},
//             tax_allocated      = ${(tax_total * share).toFixed(2)}
//           WHERE item_id = ${item.item_id}`;
//       }
//     }
//     return res.status(200).json({ allocated: items.length });
//   }
//   if (req.method === 'GET') {
//     return res.json(await sql`SELECT * FROM order_allocations ORDER BY order_date DESC`);
//   }
// }
