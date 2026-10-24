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

class FakeBackend {
  role: Role = 'anon';
  tables: Record<string, Row[]> = {};
  objects = new Map<string, StoredObject>();
  faults: Fault[] = [];
  gates: Array<{ op: string; promise: Promise<void>; release: () => void }> = [];
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
    this.tables = {
      catalog_docs: [],
      app_settings: [],
      home_sections: [],
      orders: [],
      order_email_outbox: [],
    };
    this.objects = new Map();
    this.faults = [];
    this.gates = [];
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

  // ---- RPCs -------------------------------------------------------------------
  rpc(name: string, args: Row): { data: unknown; error: RpcError | null } {
    const fail = (code: string, message: string, details?: string) => ({
      data: null,
      error: { code, message, details: details ?? null },
    });
    if (name === 'is_admin') return { data: this.role === 'admin', error: null };
    const adminOnly = [
      'catalog_write',
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

  private catalogWrite(ops: Row[]): { data: unknown; error: RpcError | null } {
    const err = (code: string, message: string, details?: string) => ({
      data: null,
      error: { code, message, details: details ?? null },
    });
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > 500) return err('22023', 'invalid_ops');
    const draft = clone(this.tables.catalog_docs);
    const results: Row[] = [];
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
    this.tables.catalog_docs = draft; // commit
    return { data: results, error: null };
  }

  private catalogImport(docs: Row[], dryRun: boolean): { data: unknown; error: RpcError | null } {
    const inserted: Row[] = [];
    const unchanged: Row[] = [];
    const conflicts: Row[] = [];
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
      } else {
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
    if (this.table === 'catalog_docs' || this.table === 'app_settings') {
      return denied('permission denied for table ' + this.table);
    }

    if (this.mode === 'insert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      if (this.table === 'orders') {
        if (list.some((r) => r.status !== 'pending')) return denied();
      } else if (!canWrite) return denied();
      for (const r of list) rows.push(jsonb(clone(r)));
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
    const fault = backend.begin(`rpc:${name}`);
    if (fault) return { data: fault.hasData ? fault.data : null, error: fault.error };
    const result = backend.rpc(name, args);
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
    async signOut() {
      backend.signIn('anon');
      return { error: null };
    },
  },
};
