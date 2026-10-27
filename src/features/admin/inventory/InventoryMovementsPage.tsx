import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { LoadingState } from '../../shared/components/LoadingState';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import { useOrders } from '../../storefront/checkout/orderStore';
import { classifyError, describePersistenceError } from '../../../lib/persistence/errors';
import { supabaseConfigured } from '../../../lib/supabase/client';
import {
  STOCK_KINDS,
  STOCK_KIND_LABELS_AR,
  checkInventoryAccess,
  fetchMovements,
  fetchStockLevels,
  type StockKind,
  type StockMovement,
} from './inventoryStore';

// Read-only ledger of every stock change (opening, receipts, sales, returns,
// adjustments), newest first. The ledger is append-only in the database; this page
// can only read it.

const PAGE_SIZE = 25;

const selectCls =
  'border border-taupe bg-white px-3 py-2 text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy';

type Load =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'forbidden' }
  | { status: 'unconfigured' }
  | { status: 'schema_missing' }
  | { status: 'error'; message: string };

interface Result {
  key: string;
  load: Load;
  rows: StockMovement[];
  hasMore: boolean;
}

async function loadMovements(
  key: string,
  filters: { productId: string; kind: '' | StockKind; from: string; to: string },
  page: number,
): Promise<Result> {
  if (!supabaseConfigured) return { key, load: { status: 'unconfigured' }, rows: [], hasMore: false };
  try {
    // a non-admin would get an EMPTY ledger under RLS, which must not read as "no movements"
    if ((await checkInventoryAccess()) !== 'admin') return { key, load: { status: 'forbidden' }, rows: [], hasMore: false };
    const res = await fetchMovements(
      {
        productId: filters.productId || undefined,
        kind: filters.kind || undefined,
        from: filters.from ? startOfDay(filters.from) : undefined,
        to: filters.to ? endOfDay(filters.to) : undefined,
      },
      page,
      PAGE_SIZE,
    );
    return { key, load: { status: 'ready' }, rows: res.rows, hasMore: res.hasMore };
  } catch (e) {
    const err = classifyError(e);
    console.error('movements load failed:', err.code, err.detail);
    return {
      key,
      load: err.code === 'schema_missing' ? { status: 'schema_missing' } : { status: 'error', message: describePersistenceError(err) },
      rows: [],
      hasMore: false,
    };
  }
}

const KIND_STYLES: Record<StockKind, string> = {
  opening: 'border-espresso/25 bg-espresso/5 text-espresso',
  receipt: 'border-gold/50 bg-gold/10 text-espresso',
  sale: 'border-espresso/30 bg-espresso/10 text-espresso',
  sale_accounted: 'border-espresso/20 bg-white text-espresso/70',
  return_restock: 'border-gold/50 bg-gold/10 text-espresso',
  return_damaged: 'border-burgundy/40 bg-burgundy/10 text-burgundy',
  adjustment: 'border-espresso/30 bg-white text-espresso',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// local midnight / end of day -> ISO
const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

function Delta({ m }: { m: StockMovement }) {
  if (m.kind === 'return_damaged' || m.kind === 'sale_accounted') {
    return (
      <span className="text-espresso/70" title="لا يغيّر الرصيد">
        0 <span className="text-[11px] text-espresso/50">({m.quantity} وحدة، بلا تغيير في الرصيد)</span>
      </span>
    );
  }
  const positive = m.qtyDelta > 0;
  return (
    <span className={`font-semibold ${positive ? 'text-espresso' : 'text-burgundy'}`} dir="ltr">
      {positive ? '+' : ''}
      {m.qtyDelta}
    </span>
  );
}

export function InventoryMovementsPage() {
  const catalog = useCatalog();
  const orders = useOrders();
  const [params, setParams] = useSearchParams();
  const productId = params.get('product') ?? '';
  const [kind, setKind] = useState<'' | StockKind>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [productOptions, setProductOptions] = useState<Array<{ id: string; label: string }>>([]);

  // Products that appear in the ledger or the catalog, for the product filter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!supabaseConfigured || (await checkInventoryAccess()) !== 'admin') return;
        const levels = await fetchStockLevels();
        if (cancelled) return;
        const names = new Map(catalog.products.map((p) => [p.id, `${p.name.ar} — ${p.sku}`]));
        setProductOptions(
          levels
            .map((l) => ({ id: l.productId, label: names.get(l.productId) ?? `${l.productName ?? l.productId} (محذوف)` }))
            .sort((a, b) => a.label.localeCompare(b.label, 'ar')),
        );
      } catch {
        // the filter list is a convenience; the ledger itself reports its own errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog.products]);

  // The result belongs to the query that produced it; any other query (or a retry)
  // reads as "loading" until its own answer arrives.
  const queryKey = JSON.stringify([productId, kind, from, to, page, nonce]);
  useEffect(() => {
    let cancelled = false;
    void loadMovements(queryKey, { productId, kind, from, to }, page).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [queryKey, productId, kind, from, to, page]);

  const current = result?.key === queryKey ? result : null;
  const load: Load = current?.load ?? { status: 'loading' };
  const rows = current?.rows ?? [];
  const hasMore = current?.hasMore ?? false;
  const reload = () => setNonce((n) => n + 1);

  const orderRef = useMemo(() => new Map(orders.map((o) => [o.id, o.ref])), [orders]);
  const productLabel = (m: StockMovement) => {
    const p = catalog.products.find((x) => x.id === m.productId);
    return { name: p?.name.ar ?? m.productName ?? m.productId, sku: p?.sku ?? m.productSku ?? '', removed: !p };
  };
  const actor = (m: StockMovement) => m.actorEmail ?? (m.actor ? `${m.actor.slice(0, 8)}…` : '—');
  const hasFilters = productId !== '' || kind !== '' || from !== '' || to !== '';

  const setProduct = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('product', id);
    else next.delete('product');
    setParams(next, { replace: true });
    setPage(0);
  };
  const clear = () => {
    setProduct('');
    setKind('');
    setFrom('');
    setTo('');
    setPage(0);
  };

  const orderCell = (m: StockMovement) =>
    m.orderId ? (
      <Link to={`/admin/orders/${m.orderId}`} className="font-mono text-xs text-burgundy underline-offset-4 hover:underline" dir="ltr">
        {orderRef.get(m.orderId) ?? m.orderId.slice(0, 8)}
      </Link>
    ) : (
      <span className="text-espresso/40">—</span>
    );

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/admin/inventory"
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> المخزون
      </Link>
      <div className="mt-4">
        <AdminPageHeader
          title="سجل حركات المخزون"
          description="كل تغيير في الرصيد (افتتاحي، وارد، بيع، مرتجع، تعديل) بالكمية قبل وبعد والسبب والمنفِّذ. السجل للقراءة فقط ولا يمكن تعديله أو حذفه."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={productId} onChange={(e) => setProduct(e.target.value)} aria-label="التصفية حسب المنتج" className={`${selectCls} max-w-xs`}>
          <option value="">كل المنتجات</option>
          {productId && !productOptions.some((o) => o.id === productId) && <option value={productId}>{productId}</option>}
          {productOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as '' | StockKind);
            setPage(0);
          }}
          aria-label="التصفية حسب نوع الحركة"
          className={selectCls}
        >
          <option value="">كل الأنواع</option>
          {STOCK_KINDS.map((k) => (
            <option key={k} value={k}>{STOCK_KIND_LABELS_AR[k]}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} aria-label="من تاريخ" className={selectCls} />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} aria-label="إلى تاريخ" className={selectCls} />
        {hasFilters && (
          <button type="button" onClick={clear} className="text-xs font-medium text-burgundy underline-offset-4 hover:underline">
            مسح
          </button>
        )}
      </div>

      {load.status === 'loading' && <LoadingState label="جارٍ تحميل السجل…" />}
      {load.status === 'forbidden' && (
        <p role="alert" className="mt-5 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          ليست لديك صلاحية عرض سجل المخزون — سجّل الدخول بحساب مسؤول.
        </p>
      )}
      {load.status === 'unconfigured' && (
        <p role="alert" className="mt-5 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          الاتصال بقاعدة البيانات غير مُعدّ في هذا الإصدار.
        </p>
      )}
      {load.status === 'schema_missing' && (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm leading-6 text-espresso">
          <TriangleAlert className="mt-1 size-4 shrink-0 text-burgundy" aria-hidden />
          <span>
            جداول المخزون غير موجودة: الترحيل <span dir="ltr">0009_inventory.sql</span> لم يُطبَّق بعد، فلا يوجد سجل لعرضه.
          </span>
        </div>
      )}
      {load.status === 'error' && (
        <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          <span className="flex-1">تعذّر تحميل السجل — {load.message}</span>
          <button type="button" onClick={reload} className="rounded border border-espresso/25 px-4 py-1.5 text-xs font-medium text-espresso hover:border-espresso">
            إعادة المحاولة
          </button>
        </div>
      )}

      {load.status === 'ready' &&
        (rows.length === 0 ? (
          <div className="mt-5 rounded border border-dashed border-taupe bg-white py-14 text-center text-sm text-espresso/60">
            {hasFilters ? 'لا توجد حركات تطابق عوامل التصفية.' : 'لا توجد حركات مخزون بعد.'}
          </div>
        ) : (
          <>
            {/* desktop table */}
            <div className="mt-5 hidden overflow-x-auto rounded border border-taupe/70 bg-white md:block">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-taupe/60 text-xs tracking-wide text-espresso/50">
                    <th className="px-3 py-3 text-start font-medium">الوقت</th>
                    <th className="px-3 py-3 text-start font-medium">المنتج</th>
                    <th className="px-3 py-3 text-start font-medium">النوع</th>
                    <th className="px-3 py-3 text-start font-medium">التغيير</th>
                    <th className="px-3 py-3 text-start font-medium">قبل ← بعد</th>
                    <th className="px-3 py-3 text-start font-medium">السبب</th>
                    <th className="px-3 py-3 text-start font-medium">الطلب</th>
                    <th className="px-3 py-3 text-start font-medium">المنفِّذ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-taupe/50">
                  {rows.map((m) => {
                    const p = productLabel(m);
                    return (
                      <tr key={m.id} className="align-top hover:bg-porcelain/50">
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-espresso/65">{when(m.createdAt)}</td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-espresso">{p.name}</p>
                          <p className="font-mono text-xs text-espresso/55" dir="ltr">{p.sku}</p>
                          {p.removed && <p className="text-[11px] text-burgundy">محذوف من الكتالوج</p>}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${KIND_STYLES[m.kind]}`}>
                            {STOCK_KIND_LABELS_AR[m.kind]}
                          </span>
                          {m.override && <p className="mt-1 text-[11px] font-medium text-burgundy">تجاوز مخزون موثَّق</p>}
                        </td>
                        <td className="px-3 py-3"><Delta m={m} /></td>
                        <td className="whitespace-nowrap px-3 py-3 text-espresso/80" dir="ltr">{m.qtyBefore} → {m.qtyAfter}</td>
                        <td className="px-3 py-3 text-espresso/80">
                          {m.reason}
                          {m.reference && <p className="text-xs text-espresso/55">مرجع: {m.reference}</p>}
                        </td>
                        <td className="px-3 py-3">{orderCell(m)}</td>
                        <td className="px-3 py-3 text-xs text-espresso/65" dir="ltr">{actor(m)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <ul className="mt-5 space-y-3 md:hidden">
              {rows.map((m) => {
                const p = productLabel(m);
                return (
                  <li key={m.id} className="rounded border border-taupe/70 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-espresso">{p.name}</p>
                        <p className="font-mono text-xs text-espresso/55" dir="ltr">{p.sku}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${KIND_STYLES[m.kind]}`}>
                        {STOCK_KIND_LABELS_AR[m.kind]}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <dt className="text-espresso/55">التغيير</dt>
                      <dd><Delta m={m} /></dd>
                      <dt className="text-espresso/55">قبل ← بعد</dt>
                      <dd className="text-espresso/80" dir="ltr">{m.qtyBefore} → {m.qtyAfter}</dd>
                      <dt className="text-espresso/55">السبب</dt>
                      <dd className="text-espresso/80">{m.reason}</dd>
                      <dt className="text-espresso/55">الوقت</dt>
                      <dd className="text-espresso/65">{when(m.createdAt)}</dd>
                      <dt className="text-espresso/55">الطلب</dt>
                      <dd>{orderCell(m)}</dd>
                      <dt className="text-espresso/55">المنفِّذ</dt>
                      <dd className="text-espresso/65" dir="ltr">{actor(m)}</dd>
                    </dl>
                  </li>
                );
              })}
            </ul>

            <nav aria-label="التنقل بين الصفحات" className="mt-5 flex items-center justify-between gap-3 text-sm">
              <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} className="inline-flex items-center gap-1 rounded border border-espresso/25 px-3 py-1.5 text-espresso disabled:opacity-40">
                <ChevronRight className="size-4" aria-hidden /> الأحدث
              </button>
              <span className="text-xs text-espresso/60">صفحة {page + 1}</span>
              <button type="button" onClick={() => setPage(page + 1)} disabled={!hasMore} className="inline-flex items-center gap-1 rounded border border-espresso/25 px-3 py-1.5 text-espresso disabled:opacity-40">
                الأقدم <ChevronLeft className="size-4" aria-hidden />
              </button>
            </nav>
          </>
        ))}
    </div>
  );
}
