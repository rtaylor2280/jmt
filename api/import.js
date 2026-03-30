import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

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

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  return parseCSVLines(lines);
}

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

async function insertPurchasedItem(r) {
  const qty       = parseInt(r.qty_purchased) || 1;
  const unitCost  = parseFloat(r.unit_cost)   || 0;
  const shipAlloc = parseFloat(r.shipping_allocated) || 0;
  const taxAlloc  = parseFloat(r.tax_allocated)      || 0;
  const stockId   = r.stock_item_id ? parseInt(r.stock_item_id) : null;

  const [item] = await sql`
    INSERT INTO purchased_items
      (order_number, item_name, variant, vendor, date_purchased,
       qty_purchased, unit_cost, shipping_allocated, tax_allocated,
       condition, category, location, notes, stock_item_id)
    VALUES
      (${r.order_number || null}, ${r.item_name}, ${r.variant || null},
       ${r.vendor || null}, ${r.date_purchased || null},
       ${qty}, ${unitCost}, ${shipAlloc}, ${taxAlloc},
       ${r.condition || 'New'}, ${r.category || r.source_type || null},
       ${r.location || null}, ${r.notes || null}, ${stockId})
    RETURNING id`;

  // Write stock ledger entry if linked to a stock item
  if (stockId) {
    await sql`
      UPDATE stock_items
      SET qty_on_hand = qty_on_hand + ${qty}, updated_at = NOW()
      WHERE id = ${stockId}`;
    await sql`
      INSERT INTO stock_ledger (stock_item_id, purchased_item_id, qty_change, reason, notes)
      VALUES (${stockId}, ${item.id}, ${qty}, 'purchase', ${'Imported: ' + (r.item_name || '')})`;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { mode, csv, text } = req.body;

  try {
    // ── Paste mode ───────────────────────────────────────────────────────────
    if (mode === 'paste') {
      const { items, orders: orderRows } = parsePaste(text || csv);
      let insertedItems = 0, insertedOrders = 0, errors = [];

      for (const o of orderRows) {
        if (!o.order_number) continue;
        await sql`
          INSERT INTO orders (order_number, vendor, order_date, shipping_total, tax_total, notes)
          VALUES (${o.order_number}, ${o.vendor || null}, ${o.order_date || null},
                  ${parseFloat(o.shipping_total) || 0}, ${parseFloat(o.tax_total) || 0},
                  ${o.notes || null})
          ON CONFLICT (order_number) DO UPDATE SET
            vendor          = EXCLUDED.vendor,
            order_date      = EXCLUDED.order_date,
            shipping_total  = EXCLUDED.shipping_total,
            tax_total       = EXCLUDED.tax_total,
            notes           = EXCLUDED.notes,
            updated_at      = NOW()`;
        insertedOrders++;
      }

      for (const r of items) {
        try {
          if (r.order_number) {
            await sql`
              INSERT INTO orders (order_number, vendor, order_date)
              VALUES (${r.order_number}, ${r.vendor || null}, ${r.date_purchased || null})
              ON CONFLICT (order_number) DO NOTHING`;
          }
          await insertPurchasedItem(r);
          insertedItems++;
        } catch (e) {
          errors.push(`"${r.item_name}": ${e.message}`);
        }
      }

      return res.json({ insertedItems, insertedOrders, errors: errors.slice(0, 20) });
    }

    // ── Inventory (purchased items CSV) ──────────────────────────────────────
    if (mode === 'inventory') {
      const rows = parseCSV(csv);
      let inserted = 0, skipped = 0, errors = [];

      for (const r of rows) {
        try {
          if (r.order_number) {
            await sql`
              INSERT INTO orders (order_number, vendor, order_date)
              VALUES (${r.order_number}, ${r.vendor || null}, ${r.date_purchased || null})
              ON CONFLICT (order_number) DO NOTHING`;
          }
          await insertPurchasedItem(r);
          inserted++;
        } catch (e) {
          skipped++;
          errors.push(`"${r.item_name}": ${e.message}`);
        }
      }

      return res.json({ inserted, skipped, errors: errors.slice(0, 20) });
    }

    // ── Orders CSV ───────────────────────────────────────────────────────────
    if (mode === 'orders') {
      const rows = parseCSV(csv);
      let inserted = 0, skipped = 0, errors = [];

      for (const r of rows) {
        try {
          await sql`
            INSERT INTO orders (order_number, vendor, order_date, shipping_total, tax_total, notes)
            VALUES (${r.order_number}, ${r.vendor || null}, ${r.order_date || null},
                    ${parseFloat(r.shipping_total) || 0}, ${parseFloat(r.tax_total) || 0},
                    ${r.notes || null})
            ON CONFLICT (order_number) DO UPDATE SET
              vendor         = EXCLUDED.vendor,
              order_date     = EXCLUDED.order_date,
              shipping_total = EXCLUDED.shipping_total,
              tax_total      = EXCLUDED.tax_total,
              notes          = EXCLUDED.notes,
              updated_at     = NOW()`;
          inserted++;
        } catch (e) {
          skipped++;
          errors.push(`Order "${r.order_number}": ${e.message}`);
        }
      }

      return res.json({ inserted, skipped, errors: errors.slice(0, 20) });
    }

    return res.status(400).json({ error: 'mode must be paste | inventory | orders' });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}