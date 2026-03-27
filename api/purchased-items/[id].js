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
       const { item_name, variant, category, vendor, date_purchased, qty_purchased,
               qty_remaining, unit_cost, condition, source_type, location, notes } = req.body;
       const [row] = await sql`
         UPDATE purchased_items SET
           item_name=${item_name}, variant=${variant||null}, category=${category||null},
           vendor=${vendor||null}, date_purchased=${date_purchased||null},
           qty_purchased=${qty_purchased}, qty_remaining=${qty_remaining},
           unit_cost=${unit_cost}, condition=${condition||'New'},
           source_type=${source_type}, location=${location||null}, notes=${notes||null}
         WHERE item_id = ${id} RETURNING *`;
       if (!row) return res.status(404).json({ error: 'Not found' });
       if (row.order_number) await sql`SELECT recalc_allocation(${row.order_number})`;
       return res.json(row);
     }
     if (req.method === 'DELETE') {
       const [row] = await sql`DELETE FROM purchased_items WHERE item_id=${id} RETURNING order_number`;
       if (row?.order_number) await sql`SELECT recalc_allocation(${row.order_number})`;
       return res.status(204).end();
     }
   } catch (e) {
     return res.status(500).json({ error: e.message });
   }
}