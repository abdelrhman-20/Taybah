import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, ClipboardCheck, History, Lock, Search, TriangleAlert } from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { LoadingState } from '../../shared/components/LoadingState';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import { getAttributes } from '../../storefront/catalog/attributeStore';
import { getDocsState, subscribeDocs, type DocsState } from '../../storefront/catalog/catalogDocs';
import type { Availability, CatalogProduct } from '../../storefront/catalog/catalogData';
import { ORDER_STATUS_LABELS_AR, useOrders } from '../../storefront/checkout/orderStore';
import { formatPrice } from '../../shared/utils/format';
import { classifyError, describePersistenceError } from '../../../lib/persistence/errors';
import { supabaseConfigured } from '../../../lib/supabase/client';
import {
  checkInventoryAccess,
  fetchStockLevels,
  fetchWholesalePrices,
  type StockLevel,
} from './inventoryStore';
import {
  AVAILABILITY_CONFLICT_LABELS_AR,
  STOCK_STATUS_LABELS_AR,
  STOCK_STATUS_RANK,
  STORE_AVAILABILITY_LABELS_AR,
  availabilityConflict,
  effectiveAvailability,
  stockStatus,
  type AvailabilityConflict,
  type StockStatus,
} from './inventoryStatus';
import { InventoryActionDialog, type InventoryAction } from './InventoryActionDialog';

// ADMIN INVENTORY — one warehouse, quantity per PRODUCT (every variant of a product
// shares one balance). Quantities and wholesale prices are admin-only data read
// under RLS; every change goes through the approved RPCs (inventoryStore.ts).
// The storefront «availability» is manual and is never changed from here — the page
// only warns when it contradicts the real stock.

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
  load: Load;
  levels: Map<string, StockLevel>;
  wholesale: Map<string, number> | null;
}

const NO_LEVELS = new Map<string, StockLevel>();

// One full load of the admin-only inventory data. Never throws: every failure is a
// `load` state the page renders (and retries) explicitly.
async function loadInventory(): Promise<Result> {
  if (!supabaseConfigured) return { load: { status: 'unconfigured' }, levels: NO_LEVELS, wholesale: null };
  try {
    // Non-admins would receive EMPTY lists under RLS, which must never be shown as
    // "nothing is initialized" — and must never trigger a wholesale-price request.
    if ((await checkInventoryAccess()) !== 'admin') {
      return { load: { status: 'forbidden' }, levels: NO_LEVELS, wholesale: null };
    }
    const [rows, prices] = await Promise.all([
      fetchStockLevels(),
      fetchWholesalePrices().catch((e: unknown) => {
        console.error('wholesale prices unavailable:', classifyError(e).code);
        return null;
      }),
    ]);
    return { load: { status: 'ready' }, levels: new Map(rows.map((l) => [l.productId, l])), wholesale: prices };
  } catch (e) {
    const err = classifyError(e);
    console.error('inventory load failed:', err.code, err.detail);
    return {
      load: err.code === 'schema_missing' ? { status: 'schema_missing' } : { status: 'error', message: describePersistenceError(err) },
      levels: NO_LEVELS,
      wholesale: null,
    };
  }
}

interface InvRow {
  key: string;
  productId: string;
  product: CatalogProduct | undefined;
  name: string;
  sku: string;
  image: string;
  categoryName: string;
  price: number | null;
  // undefined = the private price could not be loaded; null = no wholesale price set
  wholesale: number | null | undefined;
  level: StockLevel | null;
  status: StockStatus;
  storefront: Availability | null;
  conflict: AvailabilityConflict | null;
  removed: boolean;
}

type FilterKey = 'all' | StockStatus | 'conflict';
type SortKey = 'name' | 'severity' | 'stock-asc' | 'stock-desc' | 'price-desc';

const STATUS_STYLES: Record<StockStatus, string> = {
  ok: 'border-gold/50 bg-gold/10 text-espresso',
  low: 'border-espresso/30 bg-espresso/10 text-espresso',
  out: 'border-burgundy/40 bg-burgundy/10 text-burgundy',
  negative: 'border-burgundy bg-burgundy text-white',
  uninitialized: 'border-dashed border-espresso/35 bg-white text-espresso/70',
};

function StatusBadge({ status }: { status: StockStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[status]}`}>
      {STOCK_STATUS_LABELS_AR[status]}
    </span>
  );
}

function ConflictNote({ conflict, storefront }: { conflict: AvailabilityConflict; storefront: Availability | null }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] leading-4 text-burgundy">
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        تحذير: {AVAILABILITY_CONFLICT_LABELS_AR[conflict]}
        {storefront ? ` (المعروض: ${STORE_AVAILABILITY_LABELS_AR[storefront]})` : ''}
      </span>
    </p>
  );
}

function ActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-espresso/25 px-2.5 py-1 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy disabled:opacity-40"
    >
      {label}
    </button>
  );
}

// Orders can only be validated against the catalog stored in the database. Until it
// is migrated the page shows the built-in demo catalog, whose products the database
// does not know — every stock action would fail — so the actions are disabled.
function catalogBlock(docs: DocsState): string | null {
  if (docs.initialized) return null;
  if (docs.status === 'loading') return 'جارٍ تحميل الكتالوج من قاعدة البيانات…';
  if (docs.status === 'unconfigured') return 'الاتصال بقاعدة البيانات غير مُعدّ في هذا الإصدار.';
  if (docs.status === 'error') return 'تعذّر تحميل الكتالوج من قاعدة البيانات — أعد تحميل الصفحة.';
  return docs.schemaMissing
    ? 'جداول الكتالوج غير موجودة في قاعدة البيانات (الترحيل 0006 لم يُطبَّق)، والمنتجات المعروضة من الكتالوج المدمج وليست محفوظة في قاعدة البيانات.'
    : 'الكتالوج لم يُرحَّل إلى قاعدة البيانات بعد، والمنتجات المعروضة من الكتالوج المدمج وليست محفوظة في قاعدة البيانات.';
}

export function AdminInventoryPage() {
  const catalog = useCatalog();
  const docs = useSyncExternalStore(subscribeDocs, getDocsState);
  const orders = useOrders();
  // The last completed load; `nonce` triggers a (re)load. Reloading keeps showing the
  // previous data until the fresh answer arrives (no flash after a stock action).
  const [result, setResult] = useState<Result | null>(null);
  const [nonce, setNonce] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('severity');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<{ action: InventoryAction; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadInventory().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const load: Load = result?.load ?? { status: 'loading' };
  const levels = result?.levels ?? NO_LEVELS;
  const wholesale = result?.wholesale ?? null;
  const reload = () => setNonce((n) => n + 1);

  const blocked = catalogBlock(docs);
  const ready = load.status === 'ready';
  const actionsEnabled = ready && !blocked;

  const rows = useMemo<InvRow[]>(() => {
    const attrs = getAttributes();
    const catName = (slug: string) => catalog.categories.find((c) => c.slug === slug)?.name.ar ?? slug;
    const wp = (id: string): number | null | undefined => (wholesale === null ? undefined : (wholesale.get(id) ?? null));
    const list: InvRow[] = catalog.products.map((p) => {
      const level = levels.get(p.id) ?? null;
      const status = stockStatus(level);
      const storefront = effectiveAvailability(p, attrs);
      return {
        key: p.id,
        productId: p.id,
        product: p,
        name: p.name.ar,
        sku: p.sku,
        image: p.image,
        categoryName: catName(p.category),
        price: p.price,
        wholesale: wp(p.id),
        level,
        status,
        storefront,
        conflict: availabilityConflict(status, storefront),
        removed: false,
      };
    });
    const known = new Set(catalog.products.map((p) => p.id));
    for (const level of levels.values()) {
      if (known.has(level.productId)) continue;
      list.push({
        key: level.productId,
        productId: level.productId,
        product: undefined,
        name: level.productName ?? level.productId,
        sku: level.productSku ?? '',
        image: '',
        categoryName: 'محذوف من الكتالوج',
        price: null,
        wholesale: wp(level.productId),
        level,
        status: stockStatus(level),
        storefront: null,
        conflict: null,
        removed: true,
      });
    }
    return list;
  }, [catalog.products, catalog.categories, levels, wholesale]);

  const counts = useMemo(() => {
    const c = { low: 0, out: 0, negative: 0, uninitialized: 0, conflict: 0 };
    for (const r of rows) {
      if (r.status === 'low') c.low += 1;
      else if (r.status === 'out') c.out += 1;
      else if (r.status === 'negative') c.negative += 1;
      else if (r.status === 'uninitialized') c.uninitialized += 1;
      if (r.conflict) c.conflict += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (q && !`${r.name} ${r.product?.name.en ?? ''} ${r.sku}`.toLowerCase().includes(q)) return false;
      if (category !== 'all' && r.product?.category !== category) return false;
      if (filter === 'conflict') return r.conflict !== null;
      if (filter !== 'all' && r.status !== filter) return false;
      return true;
    });
    const stock = (r: InvRow) => r.level?.onHand ?? Number.POSITIVE_INFINITY;
    switch (sort) {
      case 'stock-asc':
        return [...list].sort((a, b) => stock(a) - stock(b) || a.name.localeCompare(b.name, 'ar'));
      case 'stock-desc':
        return [...list].sort((a, b) => (b.level?.onHand ?? -1) - (a.level?.onHand ?? -1) || a.name.localeCompare(b.name, 'ar'));
      case 'price-desc':
        return [...list].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
      case 'name':
        return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      default:
        return [...list].sort(
          (a, b) => STOCK_STATUS_RANK[a.status] - STOCK_STATUS_RANK[b.status] || a.name.localeCompare(b.name, 'ar'),
        );
    }
  }, [rows, query, category, filter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const hasFilters = query !== '' || filter !== 'all' || category !== 'all';
  const clear = () => {
    setQuery('');
    setFilter('all');
    setCategory('all');
    setPage(0);
  };

  const dialogRow = dialog ? rows.find((r) => r.key === dialog.key) : undefined;
  const returnOrders = dialogRow
    ? orders
        .filter((o) => o.lines.some((l) => l.productId === dialogRow.productId))
        .map((o) => ({
          id: o.id,
          label: `${o.ref} — ${ORDER_STATUS_LABELS_AR[o.status]} (${o.lines
            .filter((l) => l.productId === dialogRow.productId)
            .reduce((n, l) => n + l.qty, 0)})`,
        }))
    : [];

  const open = (action: InventoryAction, key: string) => {
    setMessage(null);
    setDialog({ action, key });
  };

  const tile = (key: FilterKey, label: string, n: number, tone: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => {
        setFilter(filter === key ? 'all' : key);
        setPage(0);
      }}
      className={`rounded border px-4 py-3 text-start transition focus-visible:outline-2 focus-visible:outline-burgundy ${
        filter === key ? 'border-burgundy bg-burgundy/5' : 'border-taupe/70 bg-white hover:border-burgundy/40'
      }`}
    >
      <span className="block text-xs text-espresso/60">{label}</span>
      <span className={`mt-1 block font-display text-2xl ${n > 0 ? tone : 'text-espresso/40'}`}>{n}</span>
    </button>
  );

  const actions = (r: InvRow) =>
    r.level === null ? (
      <ActionButton label="تهيئة الرصيد" onClick={() => open('opening', r.key)} disabled={!actionsEnabled || r.removed} />
    ) : (
      <>
        <ActionButton label="تعديل الكمية" onClick={() => open('adjust', r.key)} disabled={!actionsEnabled} />
        <ActionButton label="وارد" onClick={() => open('receive', r.key)} disabled={!actionsEnabled} />
        <ActionButton label="مرتجع" onClick={() => open('return', r.key)} disabled={!actionsEnabled} />
        <ActionButton label="الحد الأدنى" onClick={() => open('threshold', r.key)} disabled={!actionsEnabled} />
      </>
    );

  const wholesaleCell = (r: InvRow) =>
    r.wholesale === undefined ? (
      <span className="text-espresso/40" title="تعذّر تحميل الأسعار الخاصة">—</span>
    ) : r.wholesale === null ? (
      <span className="text-espresso/40">لم يُحدَّد</span>
    ) : (
      formatPrice(r.wholesale, 'ar')
    );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <AdminPageHeader
          title="المخزون"
          description="مستودع واحد وكمية لكل منتج (تُجمع كل تنويعات المنتج في رصيد واحد). الكميات وسعر الجملة للأدمن فقط، وكل تعديل يُسجَّل في سجل الحركات."
        />
        <Link
          to="/admin/inventory/movements"
          className="inline-flex items-center gap-2 rounded border border-espresso/25 px-4 py-2 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <History className="size-4" aria-hidden /> سجل الحركات
        </Link>
        <Link
          to="/admin/inventory/reconciliation"
          className="inline-flex items-center gap-2 rounded border border-espresso/25 px-4 py-2 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <ClipboardCheck className="size-4" aria-hidden /> تسوية الجرد
        </Link>
      </div>

      <p role="note" className="mb-4 rounded border border-gold/40 bg-gold/10 px-4 py-3 text-xs leading-5 text-espresso/80">
        ملاحظة: خصم المخزون عند تسليم الطلبات وعند البيع من المتجر <strong>غير مُفعَّل بعد</strong> — الأرصدة هنا تُدار يدويًا ولا تتغيّر تلقائيًا مع الطلبات.
      </p>

      {blocked && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          <TriangleAlert className="size-4 shrink-0 text-burgundy" aria-hidden />
          <span className="flex-1 leading-6">{blocked} لا يمكن تعديل المخزون قبل ترحيل الكتالوج.</span>
          <Link to="/admin/migration" className="font-medium text-burgundy underline-offset-4 hover:underline">
            فتح النسخ الاحتياطي والترحيل
          </Link>
        </div>
      )}

      {load.status === 'loading' && <LoadingState label="جارٍ تحميل المخزون…" />}

      {load.status === 'forbidden' && (
        <p role="alert" className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          ليست لديك صلاحية عرض المخزون — سجّل الدخول بحساب مسؤول.
        </p>
      )}
      {load.status === 'unconfigured' && (
        <p role="alert" className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          الاتصال بقاعدة البيانات غير مُعدّ في هذا الإصدار — لا يمكن عرض المخزون.
        </p>
      )}
      {load.status === 'schema_missing' && (
        <div role="alert" className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm leading-6 text-espresso">
          جداول المخزون غير موجودة في قاعدة البيانات: الترحيل <span dir="ltr">0009_inventory.sql</span> لم يُطبَّق بعد (يتطلب
          الترحيلات 0001 و0003 و0006 مع ترحيل الكتالوج، و0008). لا تُعرض أرقام مخزون ولا يمكن تسجيل أي حركة. راجع{' '}
          <span dir="ltr">docs/INVENTORY_SETUP.md</span>.
        </div>
      )}
      {load.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          <span className="flex-1 leading-6">تعذّر تحميل المخزون — {load.message}</span>
          <button type="button" onClick={reload} className="rounded border border-espresso/25 px-4 py-1.5 text-xs font-medium text-espresso hover:border-espresso">
            إعادة المحاولة
          </button>
        </div>
      )}

      {ready && (
        <>
          {message && (
            <p role="status" className="mb-4 rounded border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-espresso">
              {message}
            </p>
          )}
          {wholesale === null && (
            <p role="note" className="mb-4 text-xs text-espresso/60">
              تعذّر تحميل أسعار الجملة (قد يكون الترحيل 0007 غير مطبَّق) — تظهر «—» مكانها.
            </p>
          )}

          {counts.out + counts.negative + counts.low > 0 && (
            <p role="alert" className="mb-4 flex items-start gap-2 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-burgundy" aria-hidden />
              <span>
                تنبيهات المخزون:{' '}
                {[
                  counts.negative > 0 && `${counts.negative} بمخزون سالب`,
                  counts.out > 0 && `${counts.out} نفدت كميته`,
                  counts.low > 0 && `${counts.low} منخفض`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                .
              </span>
            </p>
          )}

          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            {tile('negative', 'مخزون سالب', counts.negative, 'text-burgundy')}
            {tile('out', 'نفدت الكمية', counts.out, 'text-burgundy')}
            {tile('low', 'منخفض', counts.low, 'text-espresso')}
            {tile('uninitialized', 'غير مُهيَّأ', counts.uninitialized, 'text-espresso')}
            {tile('conflict', 'تعارض مع المتجر', counts.conflict, 'text-burgundy')}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="ابحث باسم المنتج أو SKU"
                aria-label="البحث في المخزون"
                className="w-full border border-taupe bg-white py-2 pe-3 ps-10 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
              />
            </label>
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as FilterKey);
                setPage(0);
              }}
              aria-label="التصفية حسب حالة المخزون"
              className={selectCls}
            >
              <option value="all">كل الحالات</option>
              <option value="ok">{STOCK_STATUS_LABELS_AR.ok}</option>
              <option value="low">{STOCK_STATUS_LABELS_AR.low}</option>
              <option value="out">{STOCK_STATUS_LABELS_AR.out}</option>
              <option value="negative">{STOCK_STATUS_LABELS_AR.negative}</option>
              <option value="uninitialized">{STOCK_STATUS_LABELS_AR.uninitialized}</option>
              <option value="conflict">تعارض مع المتجر</option>
            </select>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(0);
              }}
              aria-label="التصفية حسب التصنيف"
              className={selectCls}
            >
              <option value="all">كل التصنيفات</option>
              {catalog.categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name.ar}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="ترتيب المخزون" className={selectCls}>
              <option value="severity">الأكثر إلحاحًا أولًا</option>
              <option value="name">الاسم</option>
              <option value="stock-asc">الأقل كمية</option>
              <option value="stock-desc">الأكثر كمية</option>
              <option value="price-desc">الأعلى سعرًا</option>
            </select>
            {hasFilters && (
              <button type="button" onClick={clear} className="text-xs font-medium text-burgundy underline-offset-4 hover:underline">
                مسح
              </button>
            )}
          </div>

          <p className="mt-4 text-xs text-espresso/55">
            {filtered.length} من {rows.length} منتج
          </p>

          {filtered.length === 0 ? (
            <div className="mt-5 rounded border border-dashed border-taupe bg-white py-14 text-center text-sm text-espresso/60">
              {rows.length === 0 ? 'لا توجد منتجات في الكتالوج.' : 'لا توجد منتجات تطابق البحث أو عوامل التصفية.'}
            </div>
          ) : (
            <>
              {/* desktop table */}
              <div className="mt-5 hidden overflow-x-auto rounded border border-taupe/70 bg-white md:block">
                <table className="w-full min-w-[960px] text-sm">
                  <thead>
                    <tr className="border-b border-taupe/60 text-xs tracking-wide text-espresso/50">
                      <th className="px-3 py-3 text-start font-medium"><span className="sr-only">الصورة</span></th>
                      <th className="px-3 py-3 text-start font-medium">المنتج</th>
                      <th className="px-3 py-3 text-start font-medium">سعر التجزئة</th>
                      <th className="px-3 py-3 text-start font-medium">
                        <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden /> سعر الجملة (للأدمن)</span>
                      </th>
                      <th className="px-3 py-3 text-start font-medium">الكمية</th>
                      <th className="px-3 py-3 text-start font-medium">الحد الأدنى</th>
                      <th className="px-3 py-3 text-start font-medium">الحالة</th>
                      <th className="px-3 py-3 text-start font-medium">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-taupe/50">
                    {visible.map((r) => (
                      <tr key={r.key} className="align-top transition hover:bg-porcelain/50">
                        <td className="px-3 py-3">
                          <AssetImage src={r.image} alt="" className="size-12 object-cover" />
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-espresso">{r.name}</p>
                          <p className="mt-0.5 font-mono text-xs text-espresso/55" dir="ltr">{r.sku || '—'}</p>
                          <p className="mt-0.5 text-xs text-espresso/50">{r.categoryName}</p>
                        </td>
                        <td className="px-3 py-3 text-espresso/80">{r.price === null ? '—' : formatPrice(r.price, 'ar')}</td>
                        <td className="px-3 py-3 text-espresso/80">{wholesaleCell(r)}</td>
                        <td className="px-3 py-3 font-semibold text-espresso" data-testid={`onhand-${r.key}`}>
                          {r.level === null ? '—' : r.level.onHand}
                        </td>
                        <td className="px-3 py-3 text-espresso/80">{r.level === null ? '—' : r.level.lowThreshold}</td>
                        <td className="px-3 py-3">
                          <StatusBadge status={r.status} />
                          {r.conflict && <ConflictNote conflict={r.conflict} storefront={r.storefront} />}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {actions(r)}
                            <Link
                              to={`/admin/inventory/movements?product=${encodeURIComponent(r.productId)}`}
                              aria-label={`حركات ${r.name}`}
                              className="rounded border border-taupe px-2.5 py-1 text-xs font-medium text-espresso/70 hover:border-burgundy hover:text-burgundy"
                            >
                              الحركات
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* mobile cards */}
              <ul className="mt-5 space-y-3 md:hidden">
                {visible.map((r) => (
                  <li key={r.key} className="rounded border border-taupe/70 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <AssetImage src={r.image} alt="" className="size-14 shrink-0 object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-espresso">{r.name}</p>
                        <p className="font-mono text-xs text-espresso/55" dir="ltr">{r.sku || '—'}</p>
                        <p className="text-xs text-espresso/50">{r.categoryName}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <dt className="text-espresso/55">الكمية</dt>
                      <dd className="font-semibold text-espresso">{r.level === null ? '—' : r.level.onHand}</dd>
                      <dt className="text-espresso/55">الحد الأدنى</dt>
                      <dd className="text-espresso/80">{r.level === null ? '—' : r.level.lowThreshold}</dd>
                      <dt className="text-espresso/55">سعر التجزئة</dt>
                      <dd className="text-espresso/80">{r.price === null ? '—' : formatPrice(r.price, 'ar')}</dd>
                      <dt className="text-espresso/55">سعر الجملة (للأدمن)</dt>
                      <dd className="text-espresso/80">{wholesaleCell(r)}</dd>
                    </dl>
                    {r.conflict && <ConflictNote conflict={r.conflict} storefront={r.storefront} />}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {actions(r)}
                      <Link
                        to={`/admin/inventory/movements?product=${encodeURIComponent(r.productId)}`}
                        className="rounded border border-taupe px-2.5 py-1 text-xs font-medium text-espresso/70"
                      >
                        الحركات
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>

              <nav aria-label="التنقل بين الصفحات" className="mt-5 flex items-center justify-between gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                  className="inline-flex items-center gap-1 rounded border border-espresso/25 px-3 py-1.5 text-espresso disabled:opacity-40"
                >
                  <ChevronRight className="size-4" aria-hidden /> السابق
                </button>
                <span className="text-xs text-espresso/60">
                  صفحة {safePage + 1} من {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                  className="inline-flex items-center gap-1 rounded border border-espresso/25 px-3 py-1.5 text-espresso disabled:opacity-40"
                >
                  التالي <ChevronLeft className="size-4" aria-hidden />
                </button>
              </nav>
            </>
          )}
        </>
      )}

      {dialog && dialogRow && (
        <InventoryActionDialog
          action={dialog.action}
          productId={dialogRow.productId}
          productName={dialogRow.name}
          sku={dialogRow.sku}
          onHand={dialogRow.level?.onHand ?? null}
          threshold={dialogRow.level?.lowThreshold ?? 0}
          orders={returnOrders}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setMessage(m);
            reload();
          }}
        />
      )}
    </div>
  );
}
