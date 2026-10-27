// TEST-ONLY in-memory stand-in for the real Supabase client
// (src/lib/supabase/client.ts), swapped in by vitest.setup.ts so no test ever
// touches the network.
//
// IMPORTANT — this is a MOCK. It re-implements, in JavaScript, the behavior of
// this project's migrations that the app code depends on: revision-checked
// catalog_write / catalog_import RPCs with their SQLSTATE codes, RLS-style
// visibility per role (anon / user / admin), "denied update matches zero rows"
// semantics, jsonb key normalization, and Storage upload/list/remove. The real
// SQL is verified separately against a Postgres engine in
// supabase/tests/migrations.test.ts. Passing tests here prove the CLIENT code
// handles those behaviors correctly — NOT that production Supabase is wired up.

export const supabaseConfigured = true;

export type Role = 'anon' | 'user' | 'admin';
type Row = Record<string, unknown>;
interface RpcError {
  code: string;
  message: string;
  details?: string | null;
}

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const USER_ID = '00000000-0000-0000-0000-0000000000b2';

// Postgres jsonb stores objects with normalized key order; mimic it so code
// that compares what it sent with what it read back must ignore order.
function jsonb<T>(v: T): T {
  if (Array.isArray(v)) return v.map(jsonb) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Row).sort().reverse()) {
      const x = (v as Row)[k];
      if (x !== undefined) out[k] = jsonb(x);
    }
    return out as T;
  }
  return v;
}

const clone = <T>(v: T): T => structuredClone(v);

interface Fault {
  op: string;
  error: unknown;
  // when set, the call "succeeds" with exactly this data (and no error)
  data?: unknown;
  times: number;
  // true: throw/reject the promise itself (network failure) instead of
  // resolving {error}
  reject: boolean;
}

interface StoredObject {
  size: number;
  type: string;
  createdAt: string;
}

// SKU registry rule, mirroring catalog_normalize_sku / catalog_product_skus in
// migration 0006: trim + lowercase, product SKU + every variant SKU, blanks ignored.
function normSku(v: unknown): string | null {
  const s = String(v ?? '').replace(/^\s+|\s+$/g, '').toLowerCase();
  return s === '' ? null : s;
}

function productSkus(data: unknown): Array<{ sku: string; variantId: string | null }> {
  const d = (data ?? {}) as { sku?: unknown; variants?: unknown };
  const out: Array<{ sku: string; variantId: string | null }> = [];
  const own = normSku(d.sku);
  if (own) out.push({ sku: own, variantId: null });
  if (Array.isArray(d.variants)) {
    for (const v of d.variants) {
      if (v && typeof v === 'object') {
        const sku = normSku((v as { sku?: unknown }).sku);
        if (sku) out.push({ sku, variantId: String((v as { id?: unknown }).id ?? '') });
      }
    }
  }
  return out;
}

class FakeBackend {
  role: Role = 'anon';
  // true = behave like a database where migration 0008 is not applied yet
  // (orders has no source / note columns).
  legacyOrdersSchema = false;
  // every RPC the client made (name + arguments), for assertions
  rpcLog: Array<{ name: string; args: Row }> = [];
  movementSeq = 0;
  // MOCK of migration 0010 (stock deduction from orders): OFF by default, so every existing
  // order test keeps today's behaviour. A test switches it on to model a database that has
  // 0010 applied. The real SQL is verified in supabase/tests/inventory.orders.test.ts.
  inventoryOrders = false;
  overrideActive = false;
  overrideAttempts = new Map<string, { order_id: string; op: string; reason: string; short: string }>();
  // Fixtures for the reconciliation RPCs of 0009 (blockers / preflight rows are supplied by
  // the test; the decision and import calls act on them). The SQL itself is proven in
  // supabase/tests/inventory*.test.ts.
  reconBlockers: Row[] = [];
  reconRows: Row[] = [];
  tables: Record<string, Row[]> = {};
  objects = new Map<string, StoredObject>();
  faults: Fault[] = [];
  gates: Array<{ op: string; promise: Promise<void>; release: () => void }> = [];
  lostResponses: Array<{ op: string; times: number }> = [];
  log: string[] = [];
  authListeners = new Set<(event: string, session: unknown) => void>();
  private objectClock = 0;

  // Monotonic fake timestamps so list ordering is deterministic.
  nextObjectTime(): string {
    this.objectClock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + this.objectClock * 1000).toISOString();
  }

  constructor() {
    this.reset();
  }

  reset() {
    this.role = 'anon';
    this.legacyOrdersSchema = false;
    this.rpcLog = [];
    this.movementSeq = 0;
    this.inventoryOrders = false;
    this.overrideActive = false;
    this.overrideAttempts = new Map();
    this.reconBlockers = [];
    this.reconRows = [];
    this.tables = {
      catalog_docs: [],
      app_settings: [],
      home_sections: [],
      orders: [],
      order_email_outbox: [],
      product_internal_pricing: [],
      // inventory (migration 0009) — admin-only, written only by the RPCs below
      stock_levels: [],
      stock_movements: [],
    };
    this.objects = new Map();
    this.faults = [];
    this.gates = [];
    this.lostResponses = [];
    this.log = [];
    this.authListeners.clear();
    this.objectClock = 0;
  }

  get userId(): string | null {
    return this.role === 'admin' ? ADMIN_ID : this.role === 'user' ? USER_ID : null;
  }

  session() {
    return this.userId ? { user: { id: this.userId } } : null;
  }

  signIn(role: Role) {
    this.role = role;
    this.authListeners.forEach((l) => l(role === 'anon' ? 'SIGNED_OUT' : 'SIGNED_IN', this.session()));
  }

  // ---- fault / gate controls -------------------------------------------------
  // op examples: 'rpc:catalog_write', 'from:orders:update', 'storage:upload'
  failNext(op: string, error: unknown, opts: { times?: number; reject?: boolean } = {}) {
    this.faults.push({ op, error, times: opts.times ?? 1, reject: opts.reject ?? false });
  }

  // The next matching call is EXECUTED (the server applies it) but the client
  // never gets the answer — it rejects with a network error. Models the
  // dangerous case: "did my write happen?" is unknowable from the client.
  loseResponseNext(op: string, times = 1) {
    this.lostResponses.push({ op, times });
  }

  takeLostResponse(op: string): boolean {
    const f = this.lostResponses.find((x) => x.op === op && x.times > 0);
    if (!f) return false;
    f.times -= 1;
    return true;
  }

  // The next matching call resolves with this exact payload and no error,
  // WITHOUT executing — e.g. respondNext('from:orders:update', []) models an
  // RLS-filtered update that silently matched zero rows.
  respondNext(op: string, data: unknown, times = 1) {
    this.faults.push({ op, error: null, data, times, reject: false });
  }

  // Holds the next matching call until release() — for race-condition tests.
  hold(op: string) {
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    const gate = { op, promise, release };
    this.gates.push(gate);
    return { release: () => release() };
  }

  // Phase 1 (synchronous, BEFORE the operation runs): record the call and
  // apply any injected fault, so a failed request never mutates anything.
  begin(op: string): { error: unknown; data?: unknown; hasData?: boolean } | null {
    this.log.push(op);
    const fi = this.faults.findIndex((f) => f.op === op && f.times > 0);
    if (fi >= 0) {
      const f = this.faults[fi];
      f.times -= 1;
      if (f.reject) throw f.error;
      return { error: f.error, data: f.data, hasData: 'data' in f && f.data !== undefined };
    }
    return null;
  }

  // Phase 2 (AFTER the operation ran): a held request has already been
  // applied/answered server-side; the client just receives the response late.
  async settle(op: string): Promise<void> {
    const gi = this.gates.findIndex((g) => g.op === op);
    if (gi >= 0) {
      const [g] = this.gates.splice(gi, 1);
      await g.promise;
    }
  }

  calls(op: string): number {
    return this.log.filter((l) => l === op).length;
  }

  // ---- seeding helpers ---------------------------------------------------------
  putDoc(kind: string, id: string, data: unknown, extra: Partial<Row> = {}) {
    this.tables.catalog_docs.push({
      kind,
      id,
      slug: null,
      visible: true,
      sort_order: 0,
      revision: 1,
      data: jsonb(data),
      ...extra,
    });
  }

  setInitialized(on = true) {
    this.tables.app_settings = on ? [{ key: 'catalog_initialized', value: { at: 'now' } }] : [];
  }

  // ---- RLS-ish visibility -------------------------------------------------------
  visible(table: string, row: Row): boolean {
    const admin = this.role === 'admin';
    switch (table) {
      case 'catalog_docs':
        return row.visible === true || admin;
      case 'app_settings':
        return row.key === 'catalog_initialized' || admin;
      case 'home_sections':
        return row.enabled === true || admin;
      case 'orders':
      case 'order_email_outbox':
        return admin;
      default:
        return admin;
    }
  }

  // Mirrors validate_in_store_order() + the admin insert policy (migration
  // 0008): admin only, status 'sold', delivery 'in_store', every line an
  // existing product/variant at its CURRENT retail price, totals = sum of lines.
  inStoreInsertError(r: Row): { code: string; message: string; details?: string } | null {
    const invalid = (details: string) => ({ code: '22023', message: 'invalid_in_store_order', details });
    if (this.role !== 'admin' || r.status !== 'sold') {
      return { code: '42501', message: 'new row violates row-level security policy' };
    }
    if ((r.delivery as { method?: string } | undefined)?.method !== 'in_store') return invalid('delivery must be in_store');
    const lines = r.lines as Row[];
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) return invalid('lines must hold 1-100 items');
    if (/wholesale/i.test(JSON.stringify(lines))) return invalid('wholesale data not allowed');
    let sum = 0;
    for (const l of lines) {
      const qty = l.qty as number;
      const price = l.price as number;
      if (!Number.isInteger(qty) || qty < 1 || qty > 999 || typeof price !== 'number') return invalid('bad quantity');
      const doc = this.tables.catalog_docs.find((d) => d.kind === 'product' && d.id === l.productId);
      if (!doc) return invalid('unknown product');
      const data = doc.data as { price: number; variants?: Array<{ id: string; price: number | null }> };
      let expected = data.price;
      if (l.variantId) {
        const v = (data.variants ?? []).find((x) => x.id === l.variantId);
        if (!v) return invalid('unknown variant');
        if (typeof v.price === 'number') expected = v.price;
      }
      if (price !== expected) return invalid('price_mismatch');
      sum += price * qty;
    }
    if (r.subtotal !== sum || r.total !== sum) return invalid('total_mismatch');
    return null;
  }

  // ---- RPCs -------------------------------------------------------------------
  rpc(name: string, args: Row): { data: unknown; error: RpcError | null } {
    const fail = (code: string, message: string, details?: string) => ({
      data: null,
      error: { code, message, details: details ?? null },
    });
    if (name === 'is_admin') return { data: this.role === 'admin', error: null };
    const inventoryRpcs = [
      'inventory_set_opening',
      'inventory_adjust',
      'inventory_receive',
      'inventory_record_return',
      'inventory_set_threshold',
    ];
    if (inventoryRpcs.includes(name)) {
      if (this.role !== 'admin') return fail('42501', 'forbidden');
      return this.inventoryRpc(name, args);
    }
    if (['inventory_activation_blockers', 'inventory_preflight_report', 'inventory_decide_order', 'inventory_import_opening'].includes(name)) {
      if (this.role !== 'admin') return fail('42501', 'forbidden');
      return this.reconRpc(name, args);
    }
    if (name === 'inventory_deliver_order_override' || name === 'inventory_create_in_store_order_override') {
      if (!this.inventoryOrders) return fail('42883', `function ${name} does not exist`); // 0010 not applied
      if (this.role !== 'admin') return fail('42501', 'forbidden');
      return this.overrideRpc(name, args);
    }
    const adminOnly = [
      'catalog_write',
      'catalog_write_product',
      'catalog_import',
      'catalog_mark_initialized',
      'catalog_unmark_initialized',
      'retry_order_email',
    ];
    if (adminOnly.includes(name) && this.role !== 'admin') return fail('42501', 'forbidden');

    if (name === 'catalog_mark_initialized') {
      this.setInitialized(true);
      return { data: null, error: null };
    }
    if (name === 'catalog_unmark_initialized') {
      this.setInitialized(false);
      return { data: null, error: null };
    }
    if (name === 'catalog_write') return this.catalogWrite(args.p_ops as Row[]);
    if (name === 'catalog_write_product') return this.catalogWriteProduct(args.p_ops as Row[], args.p_wholesale as Row | null);
    if (name === 'catalog_import') return this.catalogImport(args.p_docs as Row[], args.p_dry_run !== false);
    if (name === 'retry_order_email') {
      const r = this.tables.order_email_outbox.find((o) => o.id === args.p_id && o.state === 'failed');
      if (r) {
        r.state = 'pending';
        r.attempts = 0;
        r.last_error = null;
      }
      return { data: null, error: null };
    }
    return fail('42883', `function ${name} does not exist`);
  }

  // ---- MOCK of migration 0010 -------------------------------------------------------
  private orderPlan(order: Row) {
    const levels = this.tables.stock_levels;
    const moves = this.tables.stock_movements;
    const agg = new Map<string, number>();
    for (const l of (order.lines as Row[]) ?? []) {
      const id = String(l.productId);
      agg.set(id, (agg.get(id) ?? 0) + Number(l.qty));
    }
    const ids = [...agg.keys()].sort();
    const missing = ids.filter((id) => !levels.some((l) => l.product_id === id));
    const todo = ids.filter((id) => !moves.some((m) => m.idempotency_key === `sale:${order.id}:${id}`));
    const short = todo.flatMap((id) => {
      const on = levels.find((l) => l.product_id === id)?.on_hand as number | undefined;
      const req = agg.get(id)!;
      return on !== undefined && on < req ? [{ product_id: id, requested: req, available: on, shortfall: req - on }] : [];
    });
    return { agg, missing, todo, short };
  }

  // The deduction of the order triggers (IS001 / IS002), applied atomically or not at all.
  orderStock(order: Row, op: 'deliver_order' | 'create_in_store_order', overridden: boolean): { code: string; message: string; details: string } | null {
    const { agg, missing, todo, short } = this.orderPlan(order);
    if (missing.length > 0) return { code: 'IS001', message: 'stock_not_initialized', details: missing.join(',') };
    if (short.length > 0 && !overridden) return { code: 'IS002', message: 'insufficient_stock', details: JSON.stringify(short) };
    for (const id of todo) {
      const l = this.tables.stock_levels.find((x) => x.product_id === id)!;
      const before = l.on_hand as number;
      const q = agg.get(id)!;
      const sf = short.find((x) => x.product_id === id);
      l.on_hand = before - q;
      this.movementSeq += 1;
      this.tables.stock_movements.push({
        id: `mv-${this.movementSeq}`,
        seq: this.movementSeq,
        product_id: id,
        product_name: l.product_name ?? null,
        product_sku: l.product_sku ?? null,
        kind: 'sale',
        quantity: q,
        qty_delta: -q,
        qty_before: before,
        qty_after: before - q,
        reason: `${op === 'deliver_order' ? 'تسليم الطلب ' : 'بيع من المتجر '}${order.ref}`,
        reference: null,
        order_id: order.id,
        idempotency_key: `sale:${order.id}:${id}`,
        override: overridden && !!sf,
        shortfall: overridden && sf ? sf.shortfall : 0,
        override_grant_id: null,
        actor: ADMIN_ID,
        actor_email: 'admin@example.test',
        created_at: new Date(Date.UTC(2026, 0, 1) + this.movementSeq * 60_000).toISOString(),
      });
    }
    return null;
  }

  private reconRpc(name: string, args: Row): { data: unknown; error: RpcError | null } {
    const invalid = (d: string) => ({ data: null, error: { code: '22023', message: 'inventory_invalid', details: d } });
    if (name === 'inventory_activation_blockers') return { data: clone(this.reconBlockers), error: null };
    if (name === 'inventory_preflight_report') return { data: clone(this.reconRows), error: null };
    if (name === 'inventory_decide_order') {
      const rows = this.reconRows.filter((r) => r.order_id === args.p_order_id);
      if (rows.length === 0) return invalid('unknown order');
      if (String(args.p_reason ?? '').trim().length < 5) return invalid('a reason of at least 5 characters is required');
      if (args.p_decision !== 'deduct_on_delivery' && args.p_decision !== 'already_accounted') return invalid('decision must be deduct_on_delivery or already_accounted');
      if (rows[0].lines_hash !== args.p_lines_hash) return invalid('lines_changed: the order lines are not the ones the decision was based on');
      if (rows[0].status === 'delivered' && args.p_decision !== 'already_accounted') return invalid('an already delivered order can only be recorded as already_accounted');
      const same = rows[0].decision === args.p_decision;
      for (const r of rows) {
        r.decision = args.p_decision;
        r.decision_matches_lines = true;
        r.decision_status_changed = false;
      }
      return { data: { status: same ? 'unchanged' : 'recorded', decision_id: 'dec-1', decision: args.p_decision }, error: null };
    }
    // inventory_import_opening
    const input = (args.p_rows as Row[]) ?? [];
    const dry = args.p_dry_run !== false;
    const seen = new Set<string>();
    const out = input.map((e) => {
      const id = typeof e.product_id === 'string' ? e.product_id : null;
      let status = 'would_create';
      if (id === null || !Number.isInteger(e.quantity) || (e.quantity as number) < 0) status = 'invalid';
      else if (seen.has(id)) status = 'duplicate_in_batch';
      else if (!this.tables.catalog_docs.some((d) => d.kind === 'product' && d.id === id)) status = 'unknown_product';
      else if (this.tables.stock_levels.some((l) => l.product_id === id)) status = 'already_initialized';
      if (id) seen.add(id);
      return { product_id: id, quantity: e.quantity, status };
    });
    const rejected = out.filter((r) => !['would_create', 'already_initialized'].includes(r.status)).length;
    const toCreate = out.filter((r) => r.status === 'would_create');
    if (!dry) {
      if (rejected > 0) return invalid('the batch has rejected rows; nothing was written');
      for (const r of toCreate) {
        this.movementSeq += 1;
        this.tables.stock_levels.push({ product_id: r.product_id, on_hand: r.quantity, low_threshold: null, product_name: null, product_sku: null });
        this.tables.stock_movements.push({ id: `mv-${this.movementSeq}`, seq: this.movementSeq, product_id: r.product_id, kind: 'opening', quantity: r.quantity, qty_delta: r.quantity, qty_before: 0, qty_after: r.quantity });
      }
    }
    const uninit = this.tables.catalog_docs.filter((d) => d.kind === 'product' && !seen.has(d.id as string) && !this.tables.stock_levels.some((l) => l.product_id === d.id));
    return {
      data: {
        dry_run: dry,
        created: toCreate.length,
        skipped: out.filter((r) => r.status === 'already_initialized').length,
        rejected,
        rows: out,
        catalog_products_not_in_batch_and_uninitialized: uninit.length,
        catalog_products_not_in_batch_sample: uninit.slice(0, 10).map((d) => d.id),
      },
      error: null,
    };
  }

  private overrideRpc(name: string, args: Row): { data: unknown; error: RpcError | null } {
    const fail = (code: string, message: string, details?: string) => ({ data: null, error: { code, message, details: details ?? null } });
    const invalid = (d: string) => fail('22023', 'inventory_invalid', d);
    const reason = typeof args.p_reason === 'string' ? args.p_reason.trim() : '';
    if (reason.length < 5) return invalid('a reason of at least 5 characters is required');
    const key = args.p_attempt_key as string | null;
    if (!key) return invalid('attempt key is required');
    const isDeliver = name === 'inventory_deliver_order_override';
    const op = isDeliver ? 'deliver_order' : 'create_in_store_order';
    const confirmed = JSON.stringify(
      [...((args.p_confirmed_shortfall as Row[]) ?? [])]
        .map((e) => ({ product_id: e.product_id, requested: e.requested, available: e.available, shortfall: e.shortfall }))
        .sort((a, b) => String(a.product_id).localeCompare(String(b.product_id))),
    );
    const payload = args.p_order as Row | undefined;
    const orderId = (isDeliver ? args.p_order_id : payload?.id) as string;
    const result = (status: string) => ({
      data: {
        status,
        order_id: orderId,
        deductions: this.tables.stock_movements
          .filter((m) => m.order_id === orderId && m.kind === 'sale')
          .map((m) => ({ product_id: m.product_id, quantity: m.quantity, qty_before: m.qty_before, qty_after: m.qty_after, override: m.override, shortfall: m.shortfall })),
      },
      error: null,
    });

    const seen = this.overrideAttempts.get(key);
    if (seen) {
      const diff = [seen.order_id !== orderId && 'order', seen.op !== op && 'operation', seen.reason !== reason && 'reason', seen.short !== confirmed && 'confirmed_shortfall'].filter(Boolean);
      if (diff.length > 0) {
        return fail('IS005', 'idempotency_key_reuse', `idempotency key already used for a different request (differs: ${diff.join(', ')})`);
      }
      return result('replayed');
    }

    let order: Row | undefined;
    if (isDeliver) {
      order = this.tables.orders.find((o) => o.id === orderId);
      if (!order) return invalid('unknown order');
      if (order.source === 'in_store') return invalid('only online orders are delivered');
      if (order.status === 'delivered') return result('unchanged');
      if (order.status !== args.p_expected_status) return fail('CF001', 'order_status_changed', `order ${order.ref}`);
    } else {
      if (this.tables.orders.some((o) => o.id === orderId)) return invalid('an order with this id already exists');
      const row: Row = {
        created_at: new Date().toISOString(),
        note: null,
        ...(payload as Row),
        status: 'sold',
        source: 'in_store',
      };
      const bad = this.inStoreInsertError(row);
      if (bad) return { data: null, error: { code: bad.code, message: bad.message, details: bad.details ?? null } };
      order = row;
    }
    const plan = this.orderPlan(order);
    if (plan.missing.length > 0) return fail('IS001', 'stock_not_initialized', plan.missing.join(','));
    if (plan.short.length === 0) return invalid('no shortage: proceed normally');
    if (JSON.stringify(plan.short) !== confirmed) return fail('IS007', 'shortfall_changed', JSON.stringify(plan.short));

    this.overrideActive = true;
    try {
      const err = this.orderStock(order, op, true);
      if (err) return fail(err.code, err.message, err.details);
    } finally {
      this.overrideActive = false;
    }
    if (isDeliver) order.status = 'delivered';
    else this.tables.orders.push(jsonb(clone(order)));
    this.overrideAttempts.set(key, { order_id: orderId, op, reason, short: confirmed });
    return result(isDeliver ? 'delivered' : 'created');
  }

  // MOCK of the inventory RPCs of migration 0009 — only what the admin UI calls.
  // Same validation, error codes (22023 / IS001 / IS005), ledger fields and
  // idempotency rules as the SQL; the real SQL (constraints, locks, RLS) is verified
  // against Postgres in supabase/tests/inventory*.test.ts. It proves the CLIENT
  // handles those behaviours, NOT that a database has migration 0009 applied.
  private inventoryRpc(name: string, args: Row): { data: unknown; error: RpcError | null } {
    const ok = (data: unknown) => ({ data, error: null });
    const fail = (code: string, message: string, details?: string) => ({
      data: null,
      error: { code, message, details: details ?? null },
    });
    const invalid = (details: string) => fail('22023', 'inventory_invalid', details);
    const levels = this.tables.stock_levels;
    const moves = this.tables.stock_movements;
    if (!levels || !moves) return fail('42883', `function ${name} does not exist`);

    const pid = args.p_product_id as string;
    const reason = typeof args.p_reason === 'string' ? args.p_reason.trim() : '';
    const int = (v: unknown, lo: number, hi: number) =>
      typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
    const reasonErr = () =>
      reason.length < 3 ? invalid('a reason of at least 3 characters is required') : null;
    const key = (args.p_idempotency_key ?? null) as string | null;
    const keyErr = () =>
      key !== null && !/^[A-Za-z0-9._-]{1,128}$/.test(key)
        ? invalid('idempotency key must be 1-128 ASCII characters from A-Z a-z 0-9 . _ -')
        : null;
    const doc = this.tables.catalog_docs.find((d) => d.kind === 'product' && d.id === pid);
    const level = levels.find((l) => l.product_id === pid);
    const notInit = () => fail('IS001', 'stock_not_initialized', pid);

    const refreshSnapshot = (l: Row) => {
      const data = doc?.data as { sku?: string; name?: { ar?: string } } | undefined;
      if (data?.name?.ar?.trim()) l.product_name = data.name.ar.trim();
      if (data?.sku?.trim()) l.product_sku = data.sku.trim();
    };
    const write = (
      l: Row,
      kind: string,
      quantity: number,
      delta: number,
      extra: { reference?: string | null; order_id?: string | null; key?: string | null } = {},
    ) => {
      refreshSnapshot(l);
      const before = l.on_hand as number;
      l.on_hand = before + delta;
      this.movementSeq += 1;
      const row: Row = {
        id: `mv-${this.movementSeq}`,
        seq: this.movementSeq,
        product_id: pid,
        product_name: l.product_name ?? null,
        product_sku: l.product_sku ?? null,
        kind,
        quantity,
        qty_delta: delta,
        qty_before: before,
        qty_after: before + delta,
        reason,
        reference: extra.reference ?? null,
        order_id: extra.order_id ?? null,
        idempotency_key: extra.key ?? null,
        override: false,
        shortfall: 0,
        override_grant_id: null,
        actor: ADMIN_ID,
        actor_email: 'admin@example.test',
        created_at: new Date(Date.UTC(2026, 0, 1) + this.movementSeq * 60_000).toISOString(),
      };
      moves.push(row);
      return row;
    };
    const result = (m: Row, replayed = false) => ({
      status: replayed ? 'replayed' : 'recorded',
      movement_id: m.id,
      product_id: m.product_id,
      kind: m.kind,
      quantity: m.quantity,
      qty_delta: m.qty_delta,
      qty_before: m.qty_before,
      qty_after: m.qty_after,
    });
    // a reused key is accepted only for the identical request
    const replay = (compare: (m: Row) => string[]) => {
      if (key === null) return null;
      const m = moves.find((x) => x.idempotency_key === key);
      if (!m) return null;
      const diff = compare(m);
      if (diff.length > 0) {
        return fail(
          'IS005',
          'idempotency_key_reuse',
          `idempotency key already used for a different request (differs: ${diff.join(', ')})`,
        );
      }
      return ok(result(m, true));
    };
    const differs = (pairs: Array<[string, boolean]>) => pairs.filter(([, d]) => d).map(([n]) => n);

    if (name === 'inventory_set_opening') {
      const r = reasonErr();
      if (r) return r;
      if (!int(args.p_quantity, 0, 10_000_000)) return invalid('quantity must be a whole number between 0 and 10000000');
      if (!doc) return invalid('unknown product');
      if (level) {
        return ok({ status: 'exists', product_id: pid, on_hand: level.on_hand, requested: args.p_quantity });
      }
      const data = doc.data as { sku?: string; name?: { ar?: string } };
      const l: Row = {
        product_id: pid,
        on_hand: 0,
        low_threshold: 0,
        product_name: data.name?.ar ?? null,
        product_sku: data.sku ?? null,
      };
      levels.push(l);
      const m = write(l, 'opening', args.p_quantity as number, args.p_quantity as number, { key: `opening:${pid}` });
      return ok({ status: 'created', product_id: pid, on_hand: m.qty_after, requested: args.p_quantity });
    }

    if (name === 'inventory_set_threshold') {
      if (!int(args.p_threshold, 0, 10_000_000)) return invalid('threshold must be a whole number >= 0');
      if (!level) return notInit();
      level.low_threshold = args.p_threshold;
      return ok({ status: 'updated', product_id: pid, low_threshold: args.p_threshold });
    }

    // the remaining operations: reason, key, then the balance row
    const r1 = reasonErr() ?? keyErr();
    if (r1) return r1;

    if (name === 'inventory_adjust') {
      if (!int(args.p_counted, 0, 100_000_000)) return invalid('counted quantity must be a whole number >= 0');
      if (!level) return notInit();
      const rp = replay((m) =>
        differs([
          ['product', m.product_id !== pid],
          ['operation', m.kind !== 'adjustment'],
          ['counted', m.qty_after !== args.p_counted],
          ['reason', m.reason !== reason],
        ]),
      );
      if (rp) return rp;
      const delta = (args.p_counted as number) - (level.on_hand as number);
      if (delta === 0) return ok({ status: 'unchanged', product_id: pid, on_hand: level.on_hand });
      return ok(result(write(level, 'adjustment', Math.abs(delta), delta, { key })));
    }

    if (name === 'inventory_receive') {
      if (!int(args.p_quantity, 1, 10_000_000)) return invalid('quantity must be a whole number between 1 and 10000000');
      const ref = typeof args.p_reference === 'string' ? args.p_reference : null;
      if (ref !== null && ref.length > 200) return invalid('reference is too long');
      if (!level) return notInit();
      const rp = replay((m) =>
        differs([
          ['product', m.product_id !== pid],
          ['operation', m.kind !== 'receipt'],
          ['quantity', m.quantity !== args.p_quantity],
          ['reference', (m.reference ?? null) !== (ref?.trim() ? ref.trim() : null)],
          ['reason', m.reason !== reason],
        ]),
      );
      if (rp) return rp;
      if ((level.on_hand as number) + (args.p_quantity as number) > 100_000_000) return invalid('resulting quantity is out of range');
      return ok(result(write(level, 'receipt', args.p_quantity as number, args.p_quantity as number, { reference: ref?.trim() ? ref.trim() : null, key })));
    }

    if (name === 'inventory_record_return') {
      if (args.p_resellable === null || args.p_resellable === undefined) {
        return invalid('choose whether the returned item is resaleable or damaged');
      }
      if (!int(args.p_quantity, 1, 10_000_000)) return invalid('quantity must be a whole number between 1 and 10000000');
      if (!level) return notInit();
      const orderId = (args.p_order_id ?? null) as string | null;
      const rp = replay((m) =>
        differs([
          ['product', m.product_id !== pid],
          ['operation', m.kind !== 'return_restock' && m.kind !== 'return_damaged'],
          ['classification', (m.kind === 'return_restock') !== (args.p_resellable === true) && (m.kind === 'return_restock' || m.kind === 'return_damaged')],
          ['quantity', m.quantity !== args.p_quantity],
          ['order', (m.order_id ?? null) !== orderId],
          ['reason', m.reason !== reason],
        ]),
      );
      if (rp) return rp;
      if (orderId !== null) {
        const order = this.tables.orders.find((o) => o.id === orderId);
        if (!order) return invalid('unknown order');
        const sold = ((order.lines as Row[]) ?? [])
          .filter((l) => l.productId === pid)
          .reduce((n, l) => n + (Number(l.qty) || 0), 0);
        if (sold === 0) return invalid('the product is not part of that order');
        const returned = moves
          .filter((m) => m.order_id === orderId && m.product_id === pid && (m.kind === 'return_restock' || m.kind === 'return_damaged'))
          .reduce((n, m) => n + (m.quantity as number), 0);
        if (returned + (args.p_quantity as number) > sold) {
          return invalid(`return exceeds the sold quantity (${sold} sold, ${returned} already returned)`);
        }
      }
      const q = args.p_quantity as number;
      if (args.p_resellable === true) {
        if ((level.on_hand as number) + q > 100_000_000) return invalid('resulting quantity is out of range');
        return ok(result(write(level, 'return_restock', q, q, { order_id: orderId, key })));
      }
      return ok(result(write(level, 'return_damaged', q, 0, { order_id: orderId, key })));
    }

    return fail('42883', `function ${name} does not exist`);
  }

  // Mirrors catalog_write_product (migration 0007): catalog_write + the
  // wholesale upsert are all-or-nothing.
  private catalogWriteProduct(ops: Row[], wholesale: Row | null): { data: unknown; error: RpcError | null } {
    const snapshot = clone(this.tables.catalog_docs);
    const pricing = clone(this.tables.product_internal_pricing);
    const res = this.catalogWrite(ops);
    if (res.error || wholesale === null || wholesale === undefined) return res;
    const bad = (details: string) => {
      this.tables.catalog_docs = snapshot;
      this.tables.product_internal_pricing = pricing;
      return { data: null, error: { code: '22023', message: 'invalid_ops', details } };
    };
    const pid = wholesale.product_id as string | undefined;
    if (!pid || !ops.some((o) => o.op === 'put' && o.kind === 'product' && o.id === pid)) {
      return bad('wholesale product_id must be a product written in the same batch');
    }
    const price = wholesale.price;
    const rows = this.tables.product_internal_pricing;
    if (price === null || price === undefined) {
      this.tables.product_internal_pricing = rows.filter((r) => r.product_id !== pid);
    } else if (typeof price !== 'number' || price < 0) {
      return bad('wholesale price must be a number >= 0');
    } else {
      const i = rows.findIndex((r) => r.product_id === pid);
      if (i >= 0) rows[i] = { ...rows[i], wholesale_price: price };
      else rows.push({ product_id: pid, wholesale_price: price });
    }
    return res;
  }

  private catalogWrite(ops: Row[]): { data: unknown; error: RpcError | null } {
    const err = (code: string, message: string, details?: string) => ({
      data: null,
      error: { code, message, details: details ?? null },
    });
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > 500) return err('22023', 'invalid_ops');
    const draft = clone(this.tables.catalog_docs);
    const results: Row[] = [];
    const putProducts: string[] = [];
    for (const op of ops) {
      const kind = op.kind as string;
      const id = op.id as string;
      const expected = (op.expected_revision as number | null | undefined) ?? null;
      const idx = draft.findIndex((d) => d.kind === kind && d.id === id);
      const where = `${kind}/${id}`;
      if (op.op === 'put') {
        if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data)) return err('22023', 'invalid_ops');
        const slug = (op.slug as string | null) || null;
        const slugTaken = (own: number) =>
          slug !== null && draft.some((d, i) => i !== own && d.kind === kind && d.slug === slug);
        if (expected === null) {
          if (idx >= 0) return err('CF003', 'already_exists', where);
          if (slugTaken(-1)) return err('CF004', 'duplicate_slug', `${kind}/${slug}`);
          draft.push({
            kind,
            id,
            slug,
            visible: (op.visible as boolean | undefined) ?? true,
            sort_order: (op.sort_order as number | undefined) ?? 0,
            revision: 1,
            data: jsonb(op.data),
          });
          results.push({ kind, id, revision: 1, deleted: false });
        } else {
          if (idx < 0) return err('CF002', 'not_found', where);
          if (draft[idx].revision !== expected) return err('CF001', 'revision_conflict', where);
          if (slugTaken(idx)) return err('CF004', 'duplicate_slug', `${kind}/${slug}`);
          const rev = (draft[idx].revision as number) + 1;
          draft[idx] = {
            ...draft[idx],
            slug,
            visible: (op.visible as boolean | undefined) ?? true,
            sort_order: (op.sort_order as number | undefined) ?? 0,
            data: jsonb(op.data),
            revision: rev,
          };
          results.push({ kind, id, revision: rev, deleted: false });
        }
        if (kind === 'product') putProducts.push(id);
      } else if (op.op === 'delete') {
        if (idx >= 0) {
          if (expected !== null && draft[idx].revision !== expected) return err('CF001', 'revision_conflict', where);
          draft.splice(idx, 1);
          results.push({ kind, id, revision: null, deleted: true });
        } else {
          results.push({ kind, id, revision: null, deleted: false });
        }
      } else {
        return err('22023', 'invalid_ops');
      }
    }
    // SKU registry: derived from the documents AFTER the whole batch applied
    // (so SKU swaps work); any clash rejects the entire batch.
    if (putProducts.length > 0) {
      const owner = new Map<string, string>();
      for (const d of draft) {
        if (d.kind !== 'product' || putProducts.includes(d.id as string)) continue;
        for (const { sku } of productSkus(d.data)) owner.set(sku, d.id as string);
      }
      for (const id of putProducts) {
        const d = draft.find((x) => x.kind === 'product' && x.id === id);
        if (!d) continue;
        for (const { sku } of productSkus(d.data)) {
          if (owner.has(sku)) {
            return err('CF005', 'duplicate_sku', `Key (sku)=(${sku}) already exists.`);
          }
          owner.set(sku, id);
        }
      }
    }
    this.tables.catalog_docs = draft; // commit
    // product_internal_pricing cascades from its product document
    this.tables.product_internal_pricing = (this.tables.product_internal_pricing ?? []).filter((p) =>
      draft.some((d) => d.kind === 'product' && d.id === p.product_id),
    );
    return { data: results, error: null };
  }

  private skuProblem(
    data: unknown,
    id: string,
    stored: (sku: string, exceptId: string) => Row | undefined,
    batch: Map<string, string>,
  ): { reason: 'sku_taken' | 'sku_duplicate_in_product'; sku: string } | null {
    const skus = productSkus(data).map((x) => x.sku);
    const dup = skus.find((s, i) => skus.indexOf(s) !== i);
    if (dup) return { reason: 'sku_duplicate_in_product', sku: dup };
    for (const sku of skus) {
      if (stored(sku, id) || (batch.has(sku) && batch.get(sku) !== id)) return { reason: 'sku_taken', sku };
    }
    return null;
  }

  private catalogImport(docs: Row[], dryRun: boolean): { data: unknown; error: RpcError | null } {
    const inserted: Row[] = [];
    const unchanged: Row[] = [];
    const conflicts: Row[] = [];
    const batch = new Map<string, string>(); // sku -> id claimed earlier in THIS call
    const stored = (sku: string, exceptId: string) =>
      this.tables.catalog_docs.find(
        (r) => r.kind === 'product' && r.id !== exceptId && productSkus(r.data).some((x) => x.sku === sku),
      );
    for (const d of docs) {
      const kind = d.kind as string;
      const id = d.id as string;
      const slug = (d.slug as string | null) || null;
      const ex = this.tables.catalog_docs.find((r) => r.kind === kind && r.id === id);
      const same =
        ex &&
        JSON.stringify(jsonb(ex.data)) === JSON.stringify(jsonb(d.data)) &&
        (ex.slug ?? null) === slug &&
        ex.visible === ((d.visible as boolean | undefined) ?? true);
      if (ex) {
        if (same) unchanged.push({ kind, id });
        else conflicts.push({ kind, id, reason: 'different_data' });
      } else if (slug !== null && this.tables.catalog_docs.some((r) => r.kind === kind && r.slug === slug)) {
        conflicts.push({ kind, id, reason: 'slug_taken' });
      } else if (kind === 'product' && this.skuProblem(d.data, id, stored, batch)) {
        const p = this.skuProblem(d.data, id, stored, batch)!;
        conflicts.push({ kind, id, reason: p.reason, sku: p.sku });
      } else {
        if (kind === 'product') for (const { sku } of productSkus(d.data)) batch.set(sku, id);
        if (!dryRun) {
          this.tables.catalog_docs.push({
            kind,
            id,
            slug,
            visible: (d.visible as boolean | undefined) ?? true,
            sort_order: (d.sort_order as number | undefined) ?? 0,
            revision: 1,
            data: jsonb(d.data),
          });
        }
        inserted.push({ kind, id });
      }
    }
    return { data: { dry_run: dryRun, inserted, unchanged, conflicts }, error: null };
  }
}

export const backend = new FakeBackend();

// ---- query builder -----------------------------------------------------------------

type Mode = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private mode: Mode = 'select';
  private cols: string | undefined;
  private returning = true;
  private payload: Row | Row[] | null = null;
  private onConflict = 'id';
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: Array<{ col: string; asc: boolean }> = [];
  private rangeSel: [number, number] | null = null;
  private single: 'maybe' | 'one' | null = null;

  constructor(private table: string) {}

  select(cols?: string) {
    if (this.mode === 'select') this.cols = cols;
    else {
      this.returning = true;
      this.cols = cols;
    }
    return this;
  }
  insert(v: Row | Row[]) {
    this.mode = 'insert';
    this.payload = v;
    this.returning = false;
    return this;
  }
  update(v: Row) {
    this.mode = 'update';
    this.payload = v;
    this.returning = false;
    return this;
  }
  upsert(v: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = 'upsert';
    this.payload = v;
    this.onConflict = opts?.onConflict ?? 'id';
    this.returning = false;
    return this;
  }
  delete() {
    this.mode = 'delete';
    this.returning = false;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push((r) => (r[col] as string | number) >= (val as string | number));
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push((r) => (r[col] as string | number) <= (val as string | number));
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  range(a: number, b: number) {
    this.rangeSel = [a, b];
    return this;
  }
  maybeSingle() {
    this.single = 'maybe';
    return this;
  }

  private project(rows: Row[]): Row[] {
    const cols = this.cols && this.cols !== '*' ? this.cols.split(',').map((c) => c.trim()) : null;
    return rows.map((r) => {
      const base = clone(r);
      if (!cols) return base;
      const out: Row = {};
      for (const c of cols) out[c] = base[c];
      return out;
    });
  }

  private async run(): Promise<{ data: unknown; error: unknown }> {
    const op = `from:${this.table}:${this.mode}`;
    const fault = backend.begin(op);
    if (fault) return { data: fault.hasData ? fault.data : null, error: fault.error };
    const result = this.exec();
    if (backend.takeLostResponse(op)) throw new TypeError('Failed to fetch');
    await backend.settle(op);
    return result;
  }

  private exec(): { data: unknown; error: unknown } {

    const rows = backend.tables[this.table];
    if (!rows) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.table}'` } };
    const denied = (message = 'new row violates row-level security policy') => ({
      data: null,
      error: { code: '42501', message },
    });
    const matches = (r: Row) => this.filters.every((f) => f(r));

    if (this.mode === 'select') {
      if (this.table === 'orders' && backend.legacyOrdersSchema && /(^|[\s,])(source|note)([\s,]|$)/.test(this.cols ?? '')) {
        return { data: null, error: { code: '42703', message: 'column orders.source does not exist' } };
      }
      // anon has no privileges on the internal pricing table at all
      if ((this.table === 'product_internal_pricing' || /^(stock_|inventory_)/.test(this.table)) && backend.role === 'anon') {
        return { data: null, error: { code: '42501', message: `permission denied for table ${this.table}` } };
      }
      let out = rows.filter((r) => backend.visible(this.table, r) && matches(r));
      for (const o of [...this.orderBy].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[o.col] as number | string;
          const y = b[o.col] as number | string;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      if (this.rangeSel) out = out.slice(this.rangeSel[0], this.rangeSel[1] + 1);
      const projected = this.project(out);
      if (this.single) return { data: projected[0] ?? null, error: null };
      return { data: projected, error: null };
    }

    // ---- writes ----
    const canWrite = backend.role === 'admin';
    if (this.table === 'catalog_docs' || this.table === 'app_settings' || this.table === 'product_internal_pricing') {
      return denied('permission denied for table ' + this.table);
    }
    // inventory tables are written only by the SECURITY DEFINER RPCs, never directly
    if (/^(stock_|inventory_)/.test(this.table)) {
      return denied('permission denied for table ' + this.table);
    }

    if (this.mode === 'insert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      if (this.table === 'orders') {
        if (backend.legacyOrdersSchema && list.some((r) => 'source' in r || 'note' in r)) {
          return { data: null, error: { code: '42703', message: 'column "source" of relation "orders" does not exist' } };
        }
        for (const r of list) {
          if (r.source === 'in_store') {
            const bad = backend.inStoreInsertError(r);
            if (bad) return { data: null, error: bad };
            if (backend.inventoryOrders && r.status === 'sold') {
              const stock = backend.orderStock(r, 'create_in_store_order', backend.overrideActive);
              if (stock) return { data: null, error: { code: stock.code, message: stock.message, details: stock.details } };
            }
          } else if (r.status !== 'pending' || (r.source !== undefined && r.source !== 'online')) {
            return denied();
          }
        }
        // Unique constraints, with the real constraint names in the message
        for (const r of list) {
          if (rows.some((x) => x.id === r.id)) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_pkey"' },
            };
          }
          if (rows.some((x) => x.ref === r.ref)) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_ref_key"' },
            };
          }
        }
      } else if (!canWrite) return denied();
      for (const r of list) {
        // column defaults of migration 0008
        rows.push(jsonb(clone(this.table === 'orders' && !backend.legacyOrdersSchema ? { source: 'online', note: null, ...r } : r)));
      }
      return { data: this.returning ? this.project(list) : null, error: null };
    }

    if (this.mode === 'upsert') {
      if (!canWrite) return denied();
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload as Row]).map((r) => jsonb(clone(r)));
      for (const r of list) {
        const i = rows.findIndex((x) => x[this.onConflict] === r[this.onConflict]);
        if (i >= 0) rows[i] = { ...rows[i], ...r };
        else rows.push(r);
      }
      return { data: this.returning ? this.project(list) : null, error: null };
    }

    if (this.mode === 'update') {
      // RLS: a row the role cannot see/update is simply not matched.
      const targets = rows.filter((r) => backend.visible(this.table, r) && canWrite && matches(r));
      if (backend.inventoryOrders && this.table === 'orders' && (this.payload as Row).status === 'delivered') {
        for (const t of targets) {
          if (t.source !== 'in_store' && t.status !== 'delivered') {
            const stock = backend.orderStock(t, 'deliver_order', backend.overrideActive);
            if (stock) return { data: null, error: { code: stock.code, message: stock.message, details: stock.details } };
          }
        }
      }
      for (const t of targets) Object.assign(t, jsonb(clone(this.payload as Row)));
      return { data: this.returning ? this.project(targets) : null, error: null };
    }

    // delete
    const keep: Row[] = [];
    const gone: Row[] = [];
    for (const r of rows) (backend.visible(this.table, r) && canWrite && matches(r) ? gone : keep).push(r);
    backend.tables[this.table] = keep;
    return { data: this.returning ? this.project(gone) : null, error: null };
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

// ---- storage -----------------------------------------------------------------------

const PUBLIC_BASE = 'https://fake.supabase.co/storage/v1/object/public';

function storageBucket(bucket: string) {
  return {
    async upload(path: string, blob: Blob, opts?: { upsert?: boolean; contentType?: string }) {
      const fault = backend.begin('storage:upload');
      if (fault) return { data: fault.hasData ? fault.data : null, error: fault.error };
      if (backend.role !== 'admin') {
        return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
      }
      if (backend.objects.has(path) && !opts?.upsert) {
        return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
      }
      backend.objects.set(path, {
        size: blob.size,
        type: opts?.contentType ?? blob.type,
        createdAt: backend.nextObjectTime(),
      });
      return { data: { path }, error: null };
    },
    async list(dir: string, opts?: { limit?: number; offset?: number; search?: string }) {
      const fault = backend.begin('storage:list');
      if (fault) return { data: fault.hasData ? fault.data : null, error: fault.error };
      const prefix = dir ? `${dir}/` : '';
      let items = [...backend.objects.entries()]
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([p, o]) => ({
          name: p.slice(prefix.length),
          id: `obj-${p}`,
          created_at: o.createdAt,
          metadata: { size: o.size, mimetype: o.type },
        }));
      if (opts?.search) items = items.filter((i) => i.name.includes(opts.search!));
      items.sort((a, b) => b.created_at.localeCompare(a.created_at));
      const off = opts?.offset ?? 0;
      return { data: items.slice(off, off + (opts?.limit ?? 100)), error: null };
    },
    async remove(paths: string[]) {
      const fault = backend.begin('storage:remove');
      if (fault) return { data: fault.hasData ? fault.data : null, error: fault.error };
      const removed: Array<{ name: string }> = [];
      // Storage RLS: a non-admin delete silently removes nothing.
      if (backend.role === 'admin') {
        for (const p of paths) if (backend.objects.delete(p)) removed.push({ name: p });
      }
      return { data: removed, error: null };
    },
    getPublicUrl(path: string) {
      return { data: { publicUrl: `${PUBLIC_BASE}/${bucket}/${path}` } };
    },
  };
}

// ---- the client ---------------------------------------------------------------------

export const supabase = {
  from(table: string) {
    return new Query(table);
  },
  async rpc(name: string, args: Row = {}) {
    // logged BEFORE any injected fault, so attempts that fail early are visible too
    backend.rpcLog.push({ name, args });
    const fault = backend.begin(`rpc:${name}`);
    if (fault) return { data: fault.hasData ? fault.data : null, error: fault.error };
    const result = backend.rpc(name, args);
    if (backend.takeLostResponse(`rpc:${name}`)) throw new TypeError('Failed to fetch');
    await backend.settle(`rpc:${name}`);
    return result;
  },
  storage: {
    from(bucket: string) {
      return storageBucket(bucket);
    },
  },
  auth: {
    async getSession() {
      return { data: { session: backend.session() }, error: null };
    },
    onAuthStateChange(cb: (event: string, session: unknown) => void) {
      backend.authListeners.add(cb);
      return { data: { subscription: { unsubscribe: () => backend.authListeners.delete(cb) } } };
    },
    async signInWithPassword() {
      const fault = backend.begin('auth:signIn');
      if (fault) return { data: null, error: fault.error };
      backend.signIn('admin');
      return { data: { session: backend.session() }, error: null };
    },
    async signOut() {
      backend.signIn('anon');
      return { error: null };
    },
  },
};
