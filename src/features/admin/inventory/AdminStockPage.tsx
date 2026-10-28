import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { LoadingState } from '../../shared/components/LoadingState';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import type { CatalogProduct } from '../../storefront/catalog/catalogData';
import { attributeByKey, attributeValueLabel } from '../../storefront/catalog/attributeStore';
import { isVariantProduct } from '../../storefront/catalog/variants';
import { stockKey, stockState } from '../../storefront/catalog/stockStore';
import { describePersistenceError } from '../../../lib/persistence/errors';
import {
  DEFAULT_LOW_THRESHOLD,
  fetchStockRows,
  saveStock,
  untrackStock,
  type StockRow,
} from './stockAdmin';

// «المخزون» — one table: what the shop has, and what is about to run out.
// A unit (simple product, or one variant) is tracked once it has a count; the
// storefront then derives متوفر / قرب يخلص / نفدت from it (migration 0009).

interface Unit {
  key: string;
  productId: string;
  variantId: string;
  name: string;
  sku: string;
}

function unitsOf(products: CatalogProduct[]): Unit[] {
  const out: Unit[] = [];
  for (const p of products) {
    if (isVariantProduct(p)) {
      for (const v of p.variants ?? []) {
        const options = Object.entries(v.combo)
          .map(([axis, value]) => `${attributeByKey(axis)?.name.ar ?? axis}: ${attributeValueLabel(axis, value, 'ar') ?? value}`)
          .join(' · ');
        out.push({
          key: stockKey(p.id, v.id),
          productId: p.id,
          variantId: v.id,
          name: options ? `${p.name.ar} — ${options}` : p.name.ar,
          sku: v.sku,
        });
      }
    } else {
      out.push({ key: stockKey(p.id, ''), productId: p.id, variantId: '', name: p.name.ar, sku: p.sku });
    }
  }
  return out;
}

type Filter = 'all' | 'attention' | 'untracked';

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'attention', label: 'قرب يخلص / خلص' },
  { key: 'untracked', label: 'غير متابَع' },
];

const inputCls =
  'w-20 border border-taupe bg-white px-2 py-1.5 text-center text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy';

// 0 = needs attention first, 3 = untracked last
function rank(row: StockRow | undefined): number {
  if (!row) return 3;
  const s = stockState(row.qty - row.reserved, row.lowThreshold);
  return s === 'out_of_stock' ? 0 : s === 'low_stock' ? 1 : 2;
}

function StatusPill({ row }: { row: StockRow | undefined }) {
  if (!row) return <span className="text-xs text-espresso/40">غير متابَع</span>;
  const available = row.qty - row.reserved;
  const s = stockState(available, row.lowThreshold);
  const [label, tone] =
    row.qty < 0
      ? ['راجع الجرد', 'bg-burgundy/10 text-burgundy']
      : s === 'out_of_stock'
        ? ['خلص', 'bg-burgundy/10 text-burgundy']
        : s === 'low_stock'
          ? ['قرب يخلص', 'bg-amber-100 text-amber-800']
          : ['متوفر', 'bg-emerald-100 text-emerald-800'];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}

function StockRowView({ unit, row, onChanged }: { unit: Unit; row: StockRow | undefined; onChanged: () => void }) {
  const [qty, setQty] = useState(row ? String(row.qty) : '');
  const [threshold, setThreshold] = useState(String(row?.lowThreshold ?? DEFAULT_LOW_THRESHOLD));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qtyN = Number(qty);
  const thN = Number(threshold);
  const valid = qty.trim() !== '' && Number.isInteger(qtyN) && qtyN >= 0 && Number.isInteger(thN) && thN >= 0;
  const dirty = !row || qtyN !== row.qty || thN !== row.lowThreshold;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(describePersistenceError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-t border-taupe/50 align-top">
      <td className="py-3 pe-3">
        <div className="text-sm text-espresso">{unit.name}</div>
        <div className="text-xs text-espresso/50">{unit.sku}</div>
        {error && <p role="alert" className="mt-1 text-xs text-burgundy">{error}</p>}
      </td>
      <td className="py-3 pe-3"><StatusPill row={row} /></td>
      <td className="py-3 pe-3">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`الكمية — ${unit.name}`}
          className={inputCls}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </td>
      <td className="py-3 pe-3 text-center text-sm text-espresso/70">{row ? row.reserved : '—'}</td>
      <td className="py-3 pe-3 text-center text-sm text-espresso">{row ? row.qty - row.reserved : '—'}</td>
      <td className="py-3 pe-3">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`حد التنبيه — ${unit.name}`}
          className={inputCls}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </td>
      <td className="py-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!valid || !dirty || busy}
            onClick={() => run(() => saveStock(unit.productId, unit.variantId, qtyN, thN))}
            className="bg-espresso px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >
            {row ? 'حفظ' : 'ابدأ المتابعة'}
          </button>
          {row && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => untrackStock(unit.productId, unit.variantId))}
              className="border border-taupe px-3 py-1.5 text-xs text-espresso/70 disabled:opacity-40"
            >
              إيقاف المتابعة
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function AdminStockPage() {
  const catalog = useCatalog();
  const [rows, setRows] = useState<Map<string, StockRow> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(() => {
    fetchStockRows()
      .then((r) => {
        setRows(r);
        setLoadError(null);
      })
      .catch((e: unknown) => setLoadError(describePersistenceError(e)));
  }, []);
  useEffect(load, [load]);

  const units = useMemo(() => unitsOf(catalog.products), [catalog.products]);
  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return units
      .filter((u) => {
        const row = rows.get(u.key);
        if (q && !`${u.name} ${u.sku}`.toLowerCase().includes(q)) return false;
        if (filter === 'untracked') return !row;
        if (filter === 'attention') return !!row && rank(row) <= 1;
        return true;
      })
      .sort((a, b) => rank(rows.get(a.key)) - rank(rows.get(b.key)));
  }, [units, rows, query, filter]);

  const counts = useMemo(() => {
    let out = 0;
    let low = 0;
    for (const u of units) {
      const r = rows?.get(u.key);
      if (!r) continue;
      const k = rank(r);
      if (k === 0) out++;
      else if (k === 1) low++;
    }
    return { out, low };
  }, [units, rows]);

  return (
    <div>
      <AdminPageHeader
        title="المخزون"
        description="الكمية الفعلية لكل منتج. الموقع يعرض «خلص» تلقائيًا لما المتاح يوصل صفر. الطلبات الجديدة بتحجز قطعها فورًا، والكمية الفعلية بتنقص لما الطلب يتسلّم أو يتباع من المحل."
      />

      {loadError && (
        <p role="alert" className="mb-4 text-sm text-burgundy">
          {loadError}
        </p>
      )}

      {rows && (
        <p className="mb-4 text-sm text-espresso/70">
          خلص: <strong className="text-burgundy">{counts.out}</strong> · قرب يخلص:{' '}
          <strong className="text-amber-800">{counts.low}</strong>
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث بالاسم أو الكود"
            aria-label="بحث"
            className="w-64 border border-taupe bg-white py-2 ps-9 pe-3 text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          />
        </label>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`border px-3 py-1.5 text-xs ${filter === f.key ? 'border-espresso bg-espresso text-white' : 'border-taupe text-espresso/70'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!rows && !loadError ? (
        <LoadingState />
      ) : rows ? (
        <div className="overflow-x-auto rounded border border-taupe/70 bg-white p-5">
          <table className="w-full text-start">
            <thead>
              <tr className="text-xs text-espresso/60">
                <th className="pb-2 pe-3 text-start font-medium">المنتج</th>
                <th className="pb-2 pe-3 text-start font-medium">الحالة</th>
                <th className="pb-2 pe-3 text-start font-medium">الكمية</th>
                <th className="pb-2 pe-3 text-center font-medium">محجوز</th>
                <th className="pb-2 pe-3 text-center font-medium">متاح</th>
                <th className="pb-2 pe-3 text-start font-medium">ينبّه عند</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <StockRowView key={`${u.key}:${rows.get(u.key)?.qty}:${rows.get(u.key)?.lowThreshold}`} unit={u} row={rows.get(u.key)} onChanged={load} />
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="py-6 text-center text-sm text-espresso/50">لا توجد نتائج.</p>}
        </div>
      ) : null}
    </div>
  );
}
