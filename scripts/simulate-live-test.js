/**
 * Live Simulation Test for: Product (barcode, base_currency, pricing),
 * Bulk Price Update, Low Stock Alerts, and Profit Report.
 *
 * Run with: node scripts/simulate-live-test.js
 * Requires: server running on http://localhost:3000 (or set API_URL).
 */

const API_URL = process.env.API_URL || 'http://localhost:3000/api';

async function run() {
  console.log('=== Live Simulation Test ===\n');
  const steps = [];

  try {
    // 1. Add Product: Test Oil
    console.log('1. Adding product "Test Oil"...');
    const productRes = await fetch(API_URL + '/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Oil',
        barcode: '999',
        defaultUnitId: 'piece',
        costPerDefaultUnit: 0,
        base_currency: 'USD',
        base_price: 10,
        min_stock_level: 20,
      }),
    });
    const productData = await productRes.json();
    if (!productData.success || !productData.data) {
      throw new Error('Add product failed: ' + JSON.stringify(productData));
    }
    const productId = productData.data.id;
    steps.push({ step: 'Add Product', ok: true, productId });
    console.log('   Created product id:', productId);

    // 2. Add inventory (current_stock = 5) via purchase invoice
    console.log('2. Adding inventory (5 units)...');
    const purchaseRes = await fetch(API_URL + '/procurement/purchase-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId, unitId: 'piece', quantity: 5, unitCostSYP: 0 }],
        payWithCash: true,
        memo: 'Simulation stock for Test Oil',
      }),
    });
    const contentType = purchaseRes.headers.get('content-type') || '';
    let purchaseData;
    if (contentType.includes('application/json')) {
      purchaseData = await purchaseRes.json();
    } else {
      const text = await purchaseRes.text();
      console.log('   Response (' + purchaseRes.status + ') was not JSON. First 120 chars:', text.slice(0, 120));
      console.log('   Tip: Ensure the server is running with latest code (npm run dev) and has POST /api/procurement/purchase-invoice.');
      purchaseData = { success: false };
    }
    if (!purchaseData.success) {
      steps.push({ step: 'Add Inventory', ok: false, message: purchaseData.error || 'Non-JSON or 404' });
      console.log('   Skipping inventory (Test Oil will not appear in Low Stock until stock is added).');
    } else {
      steps.push({ step: 'Add Inventory', ok: true });
      console.log('   Stock added.');
    }

    // 3. Set exchange rate: 15000 SYP/USD (store uses rateToBase: 1 SYP = 1/15000 USD)
    console.log('3. Setting rate 15000 SYP/USD...');
    const rateRes = await fetch(API_URL + '/multi-currency/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'SYP', rate: 1 / 15000 }),
    });
    const rateData = await rateRes.json();
    if (!rateData.success) {
      throw new Error('Set rate failed: ' + JSON.stringify(rateData));
    }
    steps.push({ step: 'Set Rate', ok: true });
    console.log('   Rate set.');

    // 4. Bulk update prices (USD-linked products get salesPricePerUnit = base_price * 15000)
    console.log('4. Triggering bulk price update...');
    const priceRes = await fetch(API_URL + '/prices/update-by-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const priceData = await priceRes.json();
    if (!priceData.success) {
      throw new Error('Price update failed: ' + JSON.stringify(priceData));
    }
    steps.push({ step: 'Bulk Price Update', ok: true, updated: priceData.data?.updated });
    console.log('   Updated', priceData.data?.updated ?? 0, 'product(s).');

    // 5. Verify Test Oil: selling price 150,000 SYP and in low-stock (if inventory was added)
    console.log('5. Verifying product and low-stock...');
    const [productsRes, lowStockRes] = await Promise.all([
      fetch(API_URL + '/products'),
      fetch(API_URL + '/dashboard/low-stock'),
    ]);
    const productsJson = await productsRes.json();
    const lowStockJson = await lowStockRes.json();
    const testOil = (productsJson.data || []).find((p) => p.name === 'Test Oil');
    const inLowStock = (lowStockJson.data || []).some((p) => p.id === productId || p.name === 'Test Oil');

    const expectedPrice = 150000;
    const actualPrice = testOil?.salesPricePerUnit;
    const priceOk = actualPrice === expectedPrice;
    const verifyOk = priceOk && (steps.find((s) => s.step === 'Add Inventory')?.ok ? inLowStock : true);
    steps.push({
      step: 'Verify Test Oil',
      ok: verifyOk,
      salesPricePerUnit: actualPrice,
      expectedPrice,
      inLowStock,
    });
    if (priceOk) {
      console.log('   Test Oil selling price:', actualPrice, 'SYP (expected 150,000) OK');
    } else {
      console.log('   Test Oil selling price:', actualPrice, '(expected', expectedPrice + ')');
    }
    console.log('   In low-stock alerts:', inLowStock ? 'Yes' : 'No (add inventory via purchase invoice for this)');

    // 6. Log dummy receivable 500,000 SYP
    console.log('6. Logging receivable 500,000 SYP...');
    const debtRes = await fetch(API_URL + '/debt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountSYP: 500000,
        debtorId: 'Simulation Customer',
        memo: 'Simulation receivable for Profit Report test',
      }),
    });
    const debtData = await debtRes.json();
    if (!debtData.success) {
      throw new Error('Debt failed: ' + JSON.stringify(debtData));
    }
    steps.push({ step: 'Receivable', ok: true });
    console.log('   Receivable recorded.');

    // 7. Fetch dashboard summary (profit report data)
    console.log('7. Checking profit report data...');
    const summaryRes = await fetch(API_URL + '/dashboard/summary');
    const summaryData = await summaryRes.json();
    const summary = summaryData.data || {};
    steps.push({
      step: 'Profit Report',
      ok: summaryData.success,
      cash: summary.cash,
      totalReceivables: summary.totalReceivables,
      inventoryValue: summary.inventoryValue,
    });
    console.log('   Cash:', summary.cash, '| Receivables:', summary.totalReceivables, '| Inventory:', summary.inventoryValue);
  } catch (err) {
    console.error('Error:', err.message);
    steps.push({ step: 'Error', ok: false, message: err.message });
  }

  console.log('\n--- Summary ---');
  steps.forEach((s) => console.log(s.step + ':', s.ok ? 'OK' : 'FAIL', s.message || ''));
  console.log('\nRefresh the dashboard to see Low Stock Alerts and the Profit Report (تحليل أرباحك وسيولتك).');
}

run();
