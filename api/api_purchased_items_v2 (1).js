// ── api/purchased-items.js ────────────────────────────────────────────────────
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { source_type, search } = req.query;
      const s   = search ? `%${search}%` : null;
      const src = source_type || null;
      let rows;
      if (src && s) {
        rows = await sql`SELECT * FROM purchased_items WHERE source_type=${src} AND (item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s}) ORDER BY created_at DESC`;
      } else if (src) {
        rows = await sql`SELECT * FROM purchased_items WHERE source_type=${src} ORDER BY created_at DESC`;
      } else if (s) {
        rows = await sql`SELECT * FROM purchased_items WHERE item_name ILIKE ${s} OR item_id ILIKE ${s} OR vendor ILIKE ${s} ORDER BY created_at DESC`;
      } else {
        rows = await sql`SELECT * FROM purchased_items ORDER BY created_at DESC`;
      }
      return res.json(rows);
    }

    // POST: add line item to an order, then recalc allocation
    if (req.method === 'POST') {
      const {
        order_number, item_name, variant, category, vendor, date_purchased,
        qty_purchased, unit_cost, condition, source_type, location, notes
      } = req.body;
      const { shipping_allocated, tax_allocated } = req.body;
      const [row] = await sql`
        INSERT INTO purchased_items
          (order_number, item_name, variant, category, vendor, date_purchased,
           qty_purchased, qty_remaining, unit_cost, shipping_allocated, tax_allocated,
           condition, source_type, location, notes)
        VALUES
          (${order_number||null}, ${item_name}, ${variant||null}, ${category||null},
           ${vendor||null}, ${date_purchased||null},
           ${qty_purchased||1}, ${qty_purchased||1},
           ${unit_cost||0}, ${shipping_allocated||0}, ${tax_allocated||0},
           ${condition||'New'}, ${source_type}, ${location||null}, ${notes||null})
        RETURNING *`;
      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}


// ── api/purchased-items/[id].js ───────────────────────────────────────────────
// Create this as a SEPARATE file at api/purchased-items/[id].js
//
// import { neon } from '@neondatabase/serverless';
// const sql = neon(process.env.DATABASE_URL);
// export default async function handler(req, res) {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
//   if (req.method === 'OPTIONS') return res.status(200).end();
//   const { id } = req.query;
//   try {
//     if (req.method === 'GET') {
//       const [row] = await sql`SELECT * FROM purchased_items WHERE item_id = ${id}`;
//       return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
//     }
//     if (req.method === 'PUT') {
//       const { item_name, variant, category, vendor, date_purchased, qty_purchased,
//               qty_remaining, unit_cost, condition, source_type, location, notes } = req.body;
//       const [row] = await sql`
//         UPDATE purchased_items SET
//           item_name=${item_name}, variant=${variant||null}, category=${category||null},
//           vendor=${vendor||null}, date_purchased=${date_purchased||null},
//           qty_purchased=${qty_purchased}, qty_remaining=${qty_remaining},
//           unit_cost=${unit_cost}, condition=${condition||'New'},
//           source_type=${source_type}, location=${location||null}, notes=${notes||null}
//         WHERE item_id = ${id} RETURNING *`;
//       if (!row) return res.status(404).json({ error: 'Not found' });
//       if (row.order_number) await sql`SELECT recalc_allocation(${row.order_number})`;
//       return res.json(row);
//     }
//     if (req.method === 'DELETE') {
//       const [row] = await sql`DELETE FROM purchased_items WHERE item_id=${id} RETURNING order_number`;
//       if (row?.order_number) await sql`SELECT recalc_allocation(${row.order_number})`;
//       return res.status(204).end();
//     }
//   } catch (e) {
//     return res.status(500).json({ error: e.message });
//   }
// }
