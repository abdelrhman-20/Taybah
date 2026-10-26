import { supabase, supabaseConfigured } from '../../../lib/supabase/client';
import { PersistenceError, classifyError, withTimeout } from '../../../lib/persistence/errors';

// CATALOG DOCUMENT STORE — the single client-side gateway to
// public.catalog_docs (supabase/migrations/0006_catalog_documents.sql).
// Products, categories, collections, attributes and navigation are stored as
// one document per record whose `data` mirrors the TypeScript shape. This
// module owns: fetching, the per-record revision map, serialized
// revision-checked writes, and verified read-back. catalogStore /
// attributeStore / navStore derive their typed snapshots from it.
//
// Rules this module enforces for every caller:
//  • local state changes ONLY after the server confirmed the write AND a
//    read-back returned the same revision (never optimistic);
//  • writes are serialized and carry the revision they were based on, so a
//    stale draft cannot overwrite a newer record;
//  • a refresh that raced with a write is discarded and re-run.

export type DocKind = 'product' | 'category' | 'collection' | 'attribute' | 'nav';

export interface StoredDoc {
  kind: DocKind;
  id: string;
  slug: string | null;
  visible: boolean;
  sortOrder: number;
  revision: number;
  data: unknown;
}

export type DocsStatus = 'unconfigured' | 'loading' | 'error' | 'ready';

export interface DocsState {
  status: DocsStatus;
  error: string | null;
  // True once an admin completed + verified the catalog migration
  // (app_settings.catalog_initialized). Until then the storefront keeps
  // serving the built-in catalog and admin catalog edits are blocked.
  initialized: boolean;
  // True after at least one successful load — a later failed refresh then
  // keeps showing the last good data instead of blocking the app.
  everLoaded: boolean;
  // True when the catalog tables themselves do not exist yet (migration 0006
  // not applied to this Supabase project). That is a normal "not migrated"
  // state, NOT an outage: the storefront keeps serving the built-in catalog.
  schemaMissing: boolean;
  docs: StoredDoc[];
  // Bumped on every state change; used as the memo key by derived stores.
  version: number;
}

interface DocRow {
  kind: DocKind;
  id: string;
  slug: string | null;
  visible: boolean;
  sort_order: number;
  revision: number;
  data: unknown;
}

const COLUMNS = 'kind, id, slug, visible, sort_order, revision, data';
const PAGE = 1000;

function fromRow(r: DocRow): StoredDoc {
  return {
    kind: r.kind,
    id: r.id,
    slug: r.slug,
    visible: r.visible,
    sortOrder: r.sort_order,
    revision: r.revision,
    data: r.data,
  };
}

const keyOf = (kind: DocKind, id: string) => `${kind}\u0000${id}`;

let index = new Map<string, StoredDoc>();
let state: DocsState = {
  status: supabaseConfigured ? 'loading' : 'unconfigured',
  error: null,
  initialized: false,
  everLoaded: false,
  schemaMissing: false,
  docs: [],
  version: 0,
};
const listeners = new Set<() => void>();
let writeSeq = 0;
let refreshPromise: Promise<void> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function publish(patch: Partial<Omit<DocsState, 'docs' | 'version'>>, docs?: StoredDoc[]) {
  if (docs) {
    index = new Map(docs.map((d) => [keyOf(d.kind, d.id), d]));
  }
  state = {
    ...state,
    ...patch,
    docs: docs ?? state.docs,
    version: state.version + 1,
  };
  listeners.forEach((l) => l());
}

export function getDocsState(): DocsState {
  return state;
}

export function subscribeDocs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function docsOfKind(kind: DocKind): StoredDoc[] {
  return state.docs
    .filter((d) => d.kind === kind)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function getDoc(kind: DocKind, id: string): StoredDoc | undefined {
  return index.get(keyOf(kind, id));
}

// Revision a form should remember when it opens a record, and pass back as
// `expectedRevision` on save, so edits made on top of an outdated copy are
// rejected instead of silently overwriting newer data.
export function docRevision(kind: DocKind, id: string): number | null {
  return index.get(keyOf(kind, id))?.revision ?? null;
}

// ---- reading ---------------------------------------------------------------

async function fetchAllDocs(): Promise<StoredDoc[]> {
  const out: StoredDoc[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withTimeout(
      supabase
        .from('catalog_docs')
        .select(COLUMNS)
        .order('kind')
        .order('id')
        .range(from, from + PAGE - 1),
    );
    if (error) throw classifyError(error);
    const rows = (data ?? []) as DocRow[];
    out.push(...rows.map(fromRow));
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchInitialized(): Promise<boolean> {
  const { data, error } = await withTimeout(
    supabase.from('app_settings').select('key').eq('key', 'catalog_initialized').maybeSingle(),
  );
  if (error) throw classifyError(error);
  return Boolean(data);
}

// The ONLY error treated as "not migrated yet": the schema cache says one of
// OUR two tables does not exist (PostgREST PGRST205, or Postgres 42P01).
// Anything else — network failure, expired/invalid session, RLS denial, a
// different missing table, an unknown database error — stays a real error
// and is never silently converted into the built-in catalog.
export function isCatalogTableMissing(error: unknown): boolean {
  const err = classifyError(error);
  return err.code === 'schema_missing' && /catalog_docs|app_settings/.test(err.detail);
}

async function refreshOnce(): Promise<void> {
  const seq = writeSeq;
  try {
    const [initialized, docs] = await Promise.all([fetchInitialized(), fetchAllDocs()]);
    if (seq !== writeSeq) {
      // A write completed while this read was in flight: the snapshot may
      // predate it. Discard and read again rather than regress newer state.
      return refreshOnce();
    }
    publish(
      { status: 'ready', error: null, initialized, everLoaded: true, schemaMissing: false },
      docs,
    );
  } catch (e) {
    if (isCatalogTableMissing(e)) {
      // Migration 0006 has not been applied: serve the built-in catalog
      // (initialized=false) exactly like a project that is not yet migrated.
      console.warn('catalog tables not found — serving the built-in catalog until migration 0006 is applied');
      publish(
        { status: 'ready', error: null, initialized: false, everLoaded: true, schemaMissing: true },
        [],
      );
      return;
    }
    const err = classifyError(e);
    console.error('catalog sync failed:', err.code, err.detail);
    publish({ status: 'error', error: err.code });
  }
}

export function refreshDocs(): Promise<void> {
  if (!supabaseConfigured) return Promise.resolve();
  refreshPromise ??= refreshOnce().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

// Resolves once the first load attempt settled (success OR error).
export async function whenDocsSettled(): Promise<void> {
  if (!supabaseConfigured) return;
  if (state.status === 'loading') await refreshDocs();
}

if (supabaseConfigured) {
  void refreshDocs();
  // The first read usually precedes sign-in and only sees public rows;
  // re-read on sign-in/out so admins get drafts and hidden records.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void refreshDocs();
  });
}

// ---- writing ---------------------------------------------------------------

export interface DocPut {
  op: 'put';
  kind: DocKind;
  id: string;
  slug?: string | null;
  visible: boolean;
  sortOrder: number;
  data: unknown;
  // undefined: use the revision currently held; null: INSERT (must not
  // exist); number: update only if the server is still at that revision.
  expectedRevision?: number | null;
}

export interface DocDelete {
  op: 'delete';
  kind: DocKind;
  id: string;
  expectedRevision?: number;
}

export type DocOp = DocPut | DocDelete;

// Admin-only internal pricing that must be saved atomically with a product
// write (migration 0007). It is NEVER part of a document's `data`: the
// product's own `data` is world-readable, internal pricing is not.
// price null clears the stored value. `productId` must be a product `put` in
// the same batch.
export interface WriteExtras {
  wholesale?: { productId: string; price: number | null };
}

interface WriteResult {
  kind: DocKind;
  id: string;
  revision: number | null;
  deleted: boolean;
}

async function readBack(ops: DocOp[]): Promise<Map<string, StoredDoc>> {
  const ids = [...new Set(ops.map((o) => o.id))];
  const found = new Map<string, StoredDoc>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await withTimeout(
      supabase.from('catalog_docs').select(COLUMNS).in('id', ids.slice(i, i + 100)),
    );
    if (error) throw classifyError(error);
    for (const r of (data ?? []) as DocRow[]) found.set(keyOf(r.kind, r.id), fromRow(r));
  }
  return found;
}

async function doWrite(ops: DocOp[], extras: WriteExtras = {}): Promise<void> {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  if (!state.initialized) throw new PersistenceError('not_initialized');
  if (ops.length === 0) return;

  const payload = ops.map((op) => {
    const current = index.get(keyOf(op.kind, op.id));
    if (op.op === 'delete') {
      return {
        op: 'delete',
        kind: op.kind,
        id: op.id,
        expected_revision: op.expectedRevision ?? current?.revision ?? null,
      };
    }
    const expected =
      op.expectedRevision !== undefined ? op.expectedRevision : (current?.revision ?? null);
    return {
      op: 'put',
      kind: op.kind,
      id: op.id,
      expected_revision: expected,
      slug: op.slug ?? null,
      visible: op.visible,
      sort_order: op.sortOrder,
      data: op.data,
    };
  });

  let results: WriteResult[];
  try {
    // catalog_write_product wraps catalog_write + the wholesale upsert in one
    // transaction; it is used ONLY when internal pricing actually changed, so
    // every other write keeps its exact, original RPC.
    const { data, error } = await withTimeout(
      extras.wholesale
        ? supabase.rpc('catalog_write_product', {
            p_ops: payload,
            p_wholesale: { product_id: extras.wholesale.productId, price: extras.wholesale.price },
          })
        : supabase.rpc('catalog_write', { p_ops: payload }),
    );
    if (error) throw classifyError(error);
    results = (data ?? []) as WriteResult[];
  } catch (e) {
    const err = classifyError(e);
    if (
      err.code === 'conflict' ||
      err.code === 'not_found' ||
      err.code === 'exists' ||
      err.code === 'duplicate_slug' ||
      err.code === 'duplicate_sku' ||
      err.code === 'network'
    ) {
      // Catch local state up. For `network` this matters most: the write may
      // have been applied even though its response never arrived, and the
      // admin must then see what is actually saved. For a SKU/slug clash the
      // tab evidently did not know about the other record: refreshing lets the
      // form's own duplicate check see it on the next attempt.
      void refreshDocs();
    }
    throw err;
  }

  writeSeq += 1; // invalidate any in-flight refresh
  if (results.length !== ops.length) {
    void refreshDocs();
    throw new PersistenceError('verify_failed', 'result count mismatch');
  }

  // Read back what the database now holds; local state is built from THAT,
  // not from what we sent.
  let persisted: Map<string, StoredDoc>;
  try {
    persisted = await readBack(ops);
  } catch (e) {
    void refreshDocs();
    throw new PersistenceError('verify_failed', classifyError(e).detail);
  }

  const next = new Map(index);
  let verified = true;
  ops.forEach((op, i) => {
    const k = keyOf(op.kind, op.id);
    const row = persisted.get(k);
    if (op.op === 'delete') {
      if (row) verified = false;
      else next.delete(k);
    } else if (!row || row.revision !== results[i].revision) {
      verified = false;
    } else {
      next.set(k, row);
    }
  });
  publish({ error: null }, [...next.values()]);
  if (!verified) {
    void refreshDocs();
    throw new PersistenceError('verify_failed', 'read-back mismatch');
  }
}

// Serialized: concurrent callers run one after another, each computing its
// expected revisions from the state the previous write left behind.
export function writeDocs(ops: DocOp[], extras?: WriteExtras): Promise<void> {
  const run = writeChain.then(() => doWrite(ops, extras));
  writeChain = run.catch(() => undefined);
  return run;
}

// Throws the same errors a write would, WITHOUT writing — lets forms fail
// fast with the right message before doing slow work (e.g. image upload).
export function assertCanWrite(): void {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  if (!state.initialized) throw new PersistenceError('not_initialized');
}
