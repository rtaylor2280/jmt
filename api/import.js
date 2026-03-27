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

// Parse a combined paste (items CSV + optional order footer)
function parsePaste(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  let orderHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('order_number,vendor,order_date')) { orderHeaderIdx = i; break; }
  }
  const itemLines  = orderHeaderIdx > 0 ? lines.slice(0, orderHeaderIdx) : lines;
  const orderLines = orderHeaderIdx > 0 ? lines.slice(orderHeaderIdx) : [];

  const items  = itemLines.length  > 1 ? parseCSVLines(itemLines)  : [];
  const orders = orderLines.length > 1 ? parseCSVLines(orderLines) : [];
  return { items, orders };
}

function parseCSVLines(lines) {
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

const VALID_SOURCES = ['Hilt','Parts','Electronics','Blade','Saber'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { mode, csv, text } = req.body;

  try {
    // ── PASTE mode: full order paste (items + optional order footer) ──────────
    if (mode === 'paste') {
      const { items, orders: orderRows } = parsePaste(text || csv);
      let insertedItems = 0, insertedOrders = 0, errors = [];

      // Upsert order header first
      for (const o of orderRows) {
        if (!o.order_number) continue;
        await sql`
          INSERT INTO orders (order_number, vendor, order_date, shipping_total, tax_total)
          VALUES (${o.order_number}, ${o.vendor||null}, ${o.order_date||null},
                  ${parseFloat(o.shipping_total)||0}, ${parseFloat(o.tax_total)||0})
          ON CONFLICT (order_number) DO UPDATE SET
            vendor=EXCLUDED.vendor, order_date=EXCLUDED.order_date,
            shipping_total=EXCLUDED.shipping_total, tax_total=EXCLUDED.tax_total,
            updated_at=NOW()`;
        insertedOrders++;
      }

      // Insert line items
      for (const r of items) {
        try {
          const src = VALID_SOURCES.includes(r.source_type) ? r.source_type : 'Parts';
          // Ensure order exists if referenced
          if (r.order_number) {
            await sql`
              INSERT INTO orders (order_number, vendor, order_date)
              VALUES (${r.order_number}, ${r.vendor||null}, ${r.date_purchased||null})
              ON CONFLICT (order_number) DO NOTHING`;
          }
          await sql`
            INSERT INTO purchased_items
              (order_number, item_name, variant, category, vendor, date_purchased,
               qty_purchased, qty_remaining, unit_cost, condition, source_type, notes)
            VALUES
              (${r.order_number||null}, ${r.item_name}, ${r.variant||null}, ${r.category||null},
               ${r.vendor||null}, ${r.date_purchased||null},
               ${parseInt(r.qty_purchased)||1}, ${parseInt(r.qty_purchased)||1},
               ${parseFloat(r.unit_cost)||0}, ${r.condition||'New'}, ${src}, ${r.notes||null})`;
          insertedItems++;
        } catch(e) {
          errors.push(`"${r.item_name}": ${e.message}`);
        }
      }

      // Recalc allocation for all touched orders
      const orderNums = [...new Set(items.map(r => r.order_number).filter(Boolean))];
      for (const on of orderNums) await sql`SELECT recalc_allocation(${on})`;

      return res.json({ insertedItems, insertedOrders, errors: errors.slice(0,20) });
    }

    // ── BULK mode: inventory CSV file (legacy import) ─────────────────────────
    if (mode === 'inventory') {
      const rows = parseCSV(csv);
      let inserted = 0, skipped = 0, errors = [];
      for (const r of rows) {
        try {
          const src = VALID_SOURCES.includes(r.source_type) ? r.source_type : 'Parts';
          if (r.order_number) {
            await sql`INSERT INTO orders (order_number, vendor, order_date)
              VALUES (${r.order_number}, ${r.vendor||null}, ${r.date_purchased||null})
              ON CONFLICT (order_number) DO NOTHING`;
          }
          await sql`
            INSERT INTO purchased_items
              (order_number, item_name, variant, category, vendor, date_purchased,
               qty_purchased, qty_remaining, unit_cost, condition, source_type, notes)
            VALUES
              (${r.order_number||null}, ${r.item_name}, ${r.variant||null}, ${r.category||null},
               ${r.vendor||null}, ${r.date_purchased||null},
               ${parseInt(r.qty_purchased)||1}, ${parseInt(r.qty_purchased)||1},
               ${parseFloat(r.unit_cost)||0}, ${r.condition||'New'}, ${src}, ${r.notes||null})`;
          inserted++;
        } catch(e) { skipped++; errors.push(`"${r.item_name}": ${e.message}`); }
      }
      return res.json({ inserted, skipped, errors: errors.slice(0,20) });
    }

    // ── BULK mode: orders CSV file ────────────────────────────────────────────
    if (mode === 'orders') {
      const rows = parseCSV(csv);
      let inserted = 0, skipped = 0, errors = [];
      for (const r of rows) {
        try {
          await sql`
            INSERT INTO orders (order_number, vendor, order_date, shipping_total, tax_total)
            VALUES (${r.order_number}, ${r.vendor||null}, ${r.order_date||null},
                    ${parseFloat(r.shipping_total)||0}, ${parseFloat(r.tax_total)||0})
            ON CONFLICT (order_number) DO UPDATE SET
              shipping_total=EXCLUDED.shipping_total, tax_total=EXCLUDED.tax_total`;
          await sql`SELECT recalc_allocation(${r.order_number})`;
          inserted++;
        } catch(e) { skipped++; errors.push(`Order "${r.order_number}": ${e.message}`); }
      }
      return res.json({ inserted, skipped, errors: errors.slice(0,20) });
    }

    return res.status(400).json({ error: 'mode must be paste | inventory | orders' });

  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
