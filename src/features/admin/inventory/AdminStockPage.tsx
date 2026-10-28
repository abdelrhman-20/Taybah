import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Search } from 'lucide-react';
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

// 16px text on inputs: smaller makes iOS Safari zoom the page when one is focused.
const inputCls =
  'border border-taupe bg-white text-center text-base text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const stepBtn =
  'flex size-12 shrink-0 items-center justify-center rounded-full border border-taupe bg-white text-espresso transition active:scale-95 disabled:opacity-40';

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
  return <span className={`inline-block shrink-0 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>;
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

  const step = (d: number) => setQty(String(Math.max(0, (Number.isInteger(qtyN) ? qtyN : 0) + d)));

  return (
    <li className="rounded-lg border border-taupe/60 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-medium leading-6 text-espresso">{unit.name}</p>
          <p className="mt-0.5 text-xs text-espresso/50">{unit.sku}</p>
        </div>
        <StatusPill row={row} />
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-burgundy">{error}</p>}

      <div className="mt-4 flex items-center justify-center gap-3">
        <button type="button" aria-label={`زيادة — ${unit.name}`} className={stepBtn} onClick={() => step(1)}>
          <Plus className="size-5" aria-hidden />
        </button>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`الكمية — ${unit.name}`}
          className={`${inputCls} h-12 w-24 text-2xl font-display`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <button type="button" aria-label={`نقصان — ${unit.name}`} className={stepBtn} onClick={() => step(-1)}>
          <Minus className="size-5" aria-hidden />
        </button>
      </div>

      {row && (
        <p className="mt-3 text-center text-sm text-espresso/60">
          محجوز <strong className="text-espresso">{row.reserved}</strong> · متاح{' '}
          <strong className="text-espresso">{row.qty - row.reserved}</strong>
        </p>
      )}

      <label className="mt-3 flex items-center justify-between gap-3 text-sm text-espresso/70">
        نبّهني لما يقل عن
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`حد التنبيه — ${unit.name}`}
          className={`${inputCls} h-10 w-20`}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </label>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!valid || !dirty || busy}
          onClick={() => run(() => saveStock(unit.productId, unit.variantId, qtyN, thN))}
          className="h-12 flex-1 bg-espresso text-sm font-medium text-white transition active:scale-[0.99] disabled:opacity-40"
        >
          {row ? 'حفظ' : 'ابدأ المتابعة'}
        </button>
        {row && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => untrackStock(unit.productId, unit.variantId))}
            className="h-12 border border-taupe px-4 text-sm text-espresso/70 disabled:opacity-40"
          >
            إيقاف المتابعة
          </button>
        )}
      </div>
    </li>
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

      <div className="mb-4 space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث بالاسم أو الكود"
            aria-label="بحث"
            className="h-12 w-full border border-taupe bg-white ps-9 pe-3 text-base text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`h-10 shrink-0 rounded-full border px-4 text-sm ${filter === f.key ? 'border-espresso bg-espresso text-white' : 'border-taupe bg-white text-espresso/70'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!rows && !loadError ? (
        <LoadingState />
      ) : rows ? (
        shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-taupe bg-white py-10 text-center text-sm text-espresso/50">
            لا توجد نتائج.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {shown.map((u) => (
              <StockRowView
                key={`${u.key}:${rows.get(u.key)?.qty}:${rows.get(u.key)?.lowThreshold}`}
                unit={u}
                row={rows.get(u.key)}
                onChanged={load}
              />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
