import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'No CSV data provided' });

  try {
    const rows = parseCSV(csv);
    let inserted = 0, skipped = 0, errors = [];

    if (type === 'inventory') {
      const VALID_SOURCES = ['Hilt','Parts','Electronics','Blade','Saber'];
      for (const r of rows) {
        try {
          const source = VALID_SOURCES.includes(r.source_type) ? r.source_type : 'Parts';
          await sql`
            INSERT INTO inventory
              (category, vendor, order_number, date_purchased, item_name, variant,
               qty_purchased, qty_remaining, unit_cost, condition, source_type, notes)
            VALUES (
              ${r.category || null},
              ${r.vendor || null},
              ${r.order_number || null},
              ${r.date_purchased || null},
              ${r.item_name},
              ${r.variant || null},
              ${parseInt(r.qty_purchased) || 1},
              ${parseInt(r.qty_purchased) || 1},
              ${parseFloat(r.unit_cost) || 0},
              ${r.condition || 'New'},
              ${source},
              ${r.notes || null}
            )`;
          inserted++;
        } catch (e) {
          skipped++;
          errors.push(`Row "${r.item_name}": ${e.message}`);
        }
      }
    }

    else if (type === 'orders') {
      for (const r of rows) {
        try {
          await sql`
            INSERT INTO order_allocations
              (order_number, vendor, order_date, shipping_total, tax_total)
            VALUES (
              ${r.order_number},
              ${r.vendor || null},
              ${r.order_date || null},
              ${parseFloat(r.shipping_total) || 0},
              ${parseFloat(r.tax_total) || 0}
            )
            ON CONFLICT (order_number) DO UPDATE SET
              shipping_total = EXCLUDED.shipping_total,
              tax_total = EXCLUDED.tax_total`;
          inserted++;
        } catch (e) {
          skipped++;
          errors.push(`Order "${r.order_number}": ${e.message}`);
        }
      }

      // After orders import, allocate shipping/tax proportionally
      for (const r of rows) {
        if (!r.order_number) continue;
        const items = await sql`
          SELECT item_id, (unit_cost * qty_purchased) AS line_cost
          FROM inventory WHERE order_number = ${r.order_number}`;
        const totalCost = items.reduce((s, i) => s + parseFloat(i.line_cost || 0), 0);
        if (totalCost > 0) {
          for (const item of items) {
            const share = parseFloat(item.line_cost) / totalCost;
            await sql`
              UPDATE inventory SET
                shipping_allocated = ${((parseFloat(r.shipping_total) || 0) * share).toFixed(2)},
                tax_allocated      = ${((parseFloat(r.tax_total) || 0) * share).toFixed(2)}
              WHERE item_id = ${item.item_id}`;
          }
        }
      }
    }

    else {
      return res.status(400).json({ error: 'type must be "inventory" or "orders"' });
    }

    return res.json({ inserted, skipped, errors: errors.slice(0, 20) });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
