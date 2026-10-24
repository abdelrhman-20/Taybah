import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Download, TriangleAlert, Upload } from 'lucide-react';
import { getDocsState, subscribeDocs, type DocKind } from '../../storefront/catalog/catalogDocs';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useSaveAction } from '../hooks/useSaveAction';
import {
  createBackupZip,
  parseBackupZip,
  parseLegacy,
  readLegacyFromBrowser,
  type LegacySource,
  type ParsedLegacy,
} from './legacyBundle';
import { SkuResolution } from './SkuResolution';
import {
  buildPlan,
  isSkuConflict,
  finalizeMigration,
  homeLocalRefs,
  importDocs,
  rewriteHomepageRefs,
  rollbackMigrationFlag,
  uploadImages,
  verifyMigration,
  type HomeRewriteResult,
  type ImportReport,
  type MigrationPlan,
  type SkuOverrides,
  type UploadResult,
  type VerifyReport,
} from './migrationEngine';

const KIND_LABEL: Record<DocKind, string> = {
  product: 'المنتجات',
  category: 'التصنيفات',
  collection: 'المجموعات',
  attribute: 'السمات',
  nav: 'قوائم التنقل',
};

const KEY_LABEL: Record<string, string> = {
  catalog: 'الكتالوج (المنتجات والتصنيفات والمجموعات)',
  attributes: 'السمات',
  navigation: 'التنقل',
  homepage: 'الصفحة الرئيسية',
};

const card = 'rounded border border-taupe/70 bg-white p-5';
const primaryBtn =
  'inline-flex items-center gap-2 rounded bg-burgundy px-5 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy';
const ghostBtn =
  'inline-flex items-center gap-2 rounded border border-espresso/25 px-5 py-2 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy';

function download(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className={card} aria-labelledby={`mg-${n}`}>
      <h3 id={`mg-${n}`} className="font-display text-lg text-espresso">
        <span className="me-2 inline-flex size-6 items-center justify-center rounded-full bg-burgundy text-xs text-white">
          {n}
        </span>
        {title}
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-7 text-espresso/75">{children}</div>
    </section>
  );
}

export function AdminMigrationPage() {
  const docs = useSyncExternalStore(subscribeDocs, getDocsState);
  const fileInput = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<LegacySource | null>(null);
  const [parsed, setParsed] = useState<ParsedLegacy | null>(null);
  const [fromBackup, setFromBackup] = useState(false);
  const [backupSaved, setBackupSaved] = useState(false);
  const [dry, setDry] = useState<ImportReport | null>(null);
  const [uploads, setUploads] = useState<UploadResult[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [homeResult, setHomeResult] = useState<HomeRewriteResult[] | null>(null);
  const [confirm, setConfirm] = useState<'finalize' | 'rollback' | null>(null);

  const read = useSaveAction();
  const backup = useSaveAction();
  const dryRun = useSaveAction();
  const run = useSaveAction();
  const home = useSaveAction();
  const cutover = useSaveAction();

  // SKU replacements typed by the admin (applied to the imported copy only) and
  // the SKU conflicts the database has reported so far (kept so the rows the
  // admin is working on do not vanish while typing).
  const [skuOverrides, setSkuOverrides] = useState<SkuOverrides>({});
  const [skuConflicts, setSkuConflicts] = useState<
    Array<{ id: string; reason: ImportReport['conflicts'][number]['reason']; sku?: string }>
  >([]);

  // `basePlan` has no overrides (defines which SKUs need a value); `plan` is
  // what is actually imported.
  const basePlan: MigrationPlan | null = useMemo(
    () => (source && parsed && parsed.errors.length === 0 ? buildPlan(parsed, source) : null),
    [source, parsed],
  );
  const plan: MigrationPlan | null = useMemo(
    () =>
      source && parsed && parsed.errors.length === 0 ? buildPlan(parsed, source, skuOverrides) : null,
    [source, parsed, skuOverrides],
  );

  const rememberSkuConflicts = (c: ImportReport['conflicts']) =>
    setSkuConflicts((prev) => {
      const next = [...prev];
      for (const x of c) {
        if (isSkuConflict(x.reason) && !next.some((y) => y.id === x.id && y.sku === x.sku)) {
          next.push({ id: x.id, reason: x.reason, sku: x.sku });
        }
      }
      return next;
    });

  const changeSku = (key: string, value: string) => {
    setSkuOverrides((o) => {
      const next = { ...o };
      if (value.trim() === '') delete next[key];
      else next[key] = value;
      return next;
    });
    // Different data => the earlier dry run / upload / import no longer applies.
    setDry(null);
    setUploads(null);
    setReport(null);
    setVerify(null);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of docs.docs) c[d.kind] = (c[d.kind] ?? 0) + 1;
    return c;
  }, [docs.docs]);

  const reset = () => {
    setDry(null);
    setUploads(null);
    setReport(null);
    setVerify(null);
    setHomeResult(null);
    setProgress(null);
  };

  const loadBrowser = async () => {
    const r = await read.run(async () => {
      const s = await readLegacyFromBrowser();
      return { s, p: parseLegacy(s.bundle) };
    });
    if (!r.ok) return;
    reset();
    setSkuOverrides({});
    setSkuConflicts([]);
    setSource(r.value.s);
    setParsed(r.value.p);
    setFromBackup(false);
    setBackupSaved(false);
  };

  const loadBackup = async (file: File | undefined) => {
    if (!file) return;
    const r = await read.run(async () => {
      const s = parseBackupZip(new Uint8Array(await file.arrayBuffer()));
      return { s, p: parseLegacy(s.bundle) };
    });
    if (fileInput.current) fileInput.current.value = '';
    if (!r.ok) return;
    reset();
    setSkuOverrides({});
    setSkuConflicts([]);
    setSource(r.value.s);
    setParsed(r.value.p);
    setFromBackup(true);
    setBackupSaved(true); // the source IS a backup
  };

  const saveBackup = async () => {
    if (!source) return;
    const r = await backup.run(async () => {
      const bytes = await createBackupZip(source);
      download(bytes, `taybah-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`);
    });
    if (r.ok) setBackupSaved(true);
  };

  const doDryRun = async () => {
    if (!plan) return;
    const r = await dryRun.run(() => importDocs(plan.docs, true));
    if (r.ok) {
      setDry(r.value);
      rememberSkuConflicts(r.value.conflicts);
    }
  };

  const execute = async () => {
    if (!plan || !source) return;
    const r = await run.run(async () => {
      setProgress('رفع الصور…');
      const up = await uploadImages(plan.images, source.blobs, (d, t) =>
        setProgress(`رفع الصور ${d}/${t}…`),
      );
      setUploads(up);
      // Import nothing if any image failed: records must never point at
      // images that are not safely stored. Re-running resumes.
      if (up.some((u) => u.status === 'failed')) return null;
      setProgress('استيراد السجلات…');
      const rep = await importDocs(plan.docs, false);
      setReport(rep);
      rememberSkuConflicts(rep.conflicts);
      setProgress('التحقق من الحفظ…');
      const v = await verifyMigration(plan, up);
      setVerify(v);
      return v;
    });
    setProgress(null);
    return r;
  };

  const rewriteHome = async () => {
    if (!plan) return;
    const map = new Map(plan.images.map((i) => [i.localRef, i.ref]));
    const r = await home.run(() => rewriteHomepageRefs(map));
    if (r.ok) setHomeResult(r.value);
  };

  const runCutover = async (kind: 'finalize' | 'rollback') => {
    const r = await cutover.run(() => (kind === 'finalize' ? finalizeMigration() : rollbackMigrationFlag()));
    if (r.ok) setConfirm(null);
  };

  const uploadFailures = uploads?.filter((u) => u.status === 'failed') ?? [];
  // Unresolved duplicate SKUs (in the data, or reported by the database) block
  // the run: the database would refuse those products anyway.
  const skuBlocked = Boolean(
    plan && (plan.skuProblems.length > 0 || dry?.conflicts.some((c) => isSkuConflict(c.reason))),
  );
  const canExecute = Boolean(plan && backupSaved && dry && !skuBlocked && !run.busy);
  const canFinalize = Boolean(verify?.ok && report && report.conflicts.length === 0 && !docs.initialized);
  const localHomeRefs = homeLocalRefs();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="النسخ الاحتياطي والترحيل"
        description="نقل الكتالوج (المنتجات والتصنيفات والمجموعات والسمات والتنقل) والصور من هذا المتصفح إلى قاعدة البيانات. لا يُحذف أو يُستبدل أي شيء تلقائيًا."
      />

      <section className={card}>
        <div className="flex flex-wrap items-center gap-3">
          {docs.initialized ? (
            <CheckCircle2 className="size-5 text-burgundy" aria-hidden />
          ) : (
            <TriangleAlert className="size-5 text-gold" aria-hidden />
          )}
          <p className="flex-1 text-sm font-medium text-espresso">
            {docs.initialized
              ? 'الكتالوج مُرحَّل ومُفعَّل — المتجر والإدارة يقرآن من قاعدة البيانات.'
              : 'الكتالوج غير مُفعَّل بعد — المتجر يعرض الكتالوج المدمج وتعديلات الكتالوج معطّلة.'}
          </p>
          {docs.initialized && (
            <button type="button" className={ghostBtn} onClick={() => setConfirm('rollback')}>
              الرجوع إلى الكتالوج المدمج
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-espresso/55">
          المخزّن في قاعدة البيانات الآن:{' '}
          {(Object.keys(KIND_LABEL) as DocKind[])
            .map((k) => `${KIND_LABEL[k]} ${counts[k] ?? 0}`)
            .join(' · ')}
        </p>
        {cutover.error && (
          <p role="alert" className="mt-2 text-xs font-medium text-burgundy">
            {cutover.error}
          </p>
        )}
      </section>

      <Step n={1} title="اختر مصدر البيانات">
        <p>
          إن كانت بياناتك التي أدخلتها موجودة في هذا المتصفح، اقرأها مباشرة. وإن كانت في متصفح أو جهاز آخر
          فصدّر نسخة احتياطية من هناك (الخطوة 2) ثم ارفعها هنا.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primaryBtn} disabled={read.busy} onClick={loadBrowser}>
            قراءة بيانات هذا المتصفح
          </button>
          <button type="button" className={ghostBtn} disabled={read.busy} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" aria-hidden /> رفع نسخة احتياطية (.zip)
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            onChange={(e) => void loadBackup(e.target.files?.[0])}
          />
        </div>
        {read.error && (
          <p role="alert" className="text-xs font-medium text-burgundy">
            {read.error}
          </p>
        )}
        {parsed && source && (
          <div className="rounded border border-taupe/60 bg-porcelain/50 p-3 text-xs leading-6">
            <p className="font-medium text-espresso">
              المصدر: {fromBackup ? 'نسخة احتياطية مرفوعة' : 'هذا المتصفح'} — تاريخ القراءة{' '}
              {new Date(source.bundle.createdAt).toLocaleString('ar-EG')}
            </p>
            {parsed.errors.length === 0 ? (
              <p>
                {parsed.products.length} منتجًا · {parsed.categories.length} تصنيفًا ·{' '}
                {parsed.collections.length} مجموعة · {parsed.attributes.length} سمة · قائمتا تنقل ·{' '}
                {source.bundle.images.length} صورة محفوظة محليًا
              </p>
            ) : (
              parsed.errors.map((e) => (
                <p key={e} role="alert" className="font-medium text-burgundy">
                  {e} لن يتم الترحيل من هذا المصدر.
                </p>
              ))
            )}
            {parsed.usedDefaults.length > 0 && (
              <p className="text-espresso/70">
                لم يُحفظ في هذا المصدر أي تعديل على: {parsed.usedDefaults.map((k) => KEY_LABEL[k]).join('، ')} —
                سيُستورد المحتوى المدمج الذي يراه الزوار حاليًا.
              </p>
            )}
          </div>
        )}
      </Step>

      <Step n={2} title="نزّل نسخة احتياطية (إلزامي قبل التنفيذ)">
        <p>
          ملف ZIP يحوي بيانات المتصفح كما هي وكل الصور الأصلية. احتفظ به في مكان آمن — هو طريق الاستعادة إن
          حدث أي خطأ.
        </p>
        <button
          type="button"
          className={primaryBtn}
          disabled={!source || backup.busy || fromBackup}
          onClick={saveBackup}
        >
          <Download className="size-4" aria-hidden />{' '}
          {fromBackup ? 'المصدر نفسه نسخة احتياطية' : backup.busy ? 'جارٍ التجهيز…' : 'تنزيل النسخة الاحتياطية'}
        </button>
        {backupSaved && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-espresso">
            <CheckCircle2 className="size-4 text-burgundy" aria-hidden /> تم تجهيز النسخة الاحتياطية.
          </p>
        )}
        {backup.error && (
          <p role="alert" className="text-xs font-medium text-burgundy">
            {backup.error}
          </p>
        )}
      </Step>

      <Step n={3} title="فحص تجريبي (لا يغيّر شيئًا)">
        <p>يقارن سجلاتك بما هو مخزّن في قاعدة البيانات ويبيّن ما سيُضاف وما هو مطابق وما فيه تعارض.</p>
        <button type="button" className={ghostBtn} disabled={!plan || dryRun.busy} onClick={doDryRun}>
          {dryRun.busy ? 'جارٍ الفحص…' : 'تشغيل الفحص التجريبي'}
        </button>
        {dryRun.error && (
          <p role="alert" className="text-xs font-medium text-burgundy">
            {dryRun.error}
          </p>
        )}
        {basePlan && plan && (
          <SkuResolution
            base={basePlan}
            effective={plan}
            serverConflicts={skuConflicts}
            overrides={skuOverrides}
            onChange={changeSku}
          />
        )}
        {dry && plan && (
          <div className="rounded border border-taupe/60 bg-porcelain/50 p-3 text-xs leading-6">
            <p>سيُضاف: {dry.inserted.length} · مطابق بالفعل: {dry.unchanged.length} · تعارض: {dry.conflicts.length}</p>
            <p>الصور المراد رفعها: {plan.images.length}</p>
            {plan.missingImageRefs.length > 0 && (
              <p className="font-medium text-burgundy">
                {plan.missingImageRefs.length} صورة مُشار إليها في السجلات ولا توجد بياناتها في المصدر — ستبقى
                مراجعها كما هي ولن تظهر.
              </p>
            )}
            <ConflictList report={dry} />
          </div>
        )}
      </Step>

      <Step n={4} title="تنفيذ الترحيل">
        <p>
          يرفع الصور إلى التخزين، ثم يستورد السجلات (بدون استبدال أي سجل موجود)، ثم يعيد قراءة قاعدة البيانات
          للتحقق. يمكن تكراره بأمان إن توقف في المنتصف.
        </p>
        <button type="button" className={primaryBtn} disabled={!canExecute} onClick={execute}>
          {run.busy ? progress ?? 'جارٍ التنفيذ…' : 'بدء الترحيل'}
        </button>
        {skuBlocked && (
          <p className="text-xs font-medium text-burgundy">
            حلّ تكرارات رمز SKU أعلاه ثم أعد تشغيل الفحص التجريبي.
          </p>
        )}
        {!backupSaved && source && <p className="text-xs text-burgundy">نزّل النسخة الاحتياطية أولًا.</p>}
        {backupSaved && !dry && <p className="text-xs text-espresso/60">شغّل الفحص التجريبي أولًا.</p>}
        {run.error && (
          <p role="alert" className="text-xs font-medium text-burgundy">
            {run.error}
          </p>
        )}
        {uploadFailures.length > 0 && !run.busy && (
          <p role="alert" className="text-xs font-medium text-burgundy">
            تعذّر رفع بعض الصور — لم يُستورد أي سجل. أعد المحاولة (الصور المرفوعة تُتخطى تلقائيًا).
          </p>
        )}
        {uploads && (
          <p className="text-xs">
            الصور: {uploads.filter((u) => u.status === 'uploaded').length} مرفوعة ·{' '}
            {uploads.filter((u) => u.status === 'already_present').length} موجودة مسبقًا ·{' '}
            {uploadFailures.length} فشلت
            {uploadFailures.length > 0 && ` (${uploadFailures.map((u) => u.name).join('، ')})`}
          </p>
        )}
        {report && (
          <div className="rounded border border-taupe/60 bg-porcelain/50 p-3 text-xs leading-6">
            <p>أُضيف: {report.inserted.length} · مطابق: {report.unchanged.length} · تعارض: {report.conflicts.length}</p>
            <ConflictList report={report} />
          </div>
        )}
        {verify && (
          <p
            role="status"
            className={`text-xs font-medium ${verify.ok ? 'text-espresso' : 'text-burgundy'}`}
          >
            {verify.ok
              ? `تم التحقق: ${verify.checked} سجل مطابق لقاعدة البيانات وكل الصور موجودة.`
              : `فشل التحقق: ${verify.mismatches.length} سجل مختلف أو ناقص، ${verify.missingObjects.length} صورة ناقصة.`}
          </p>
        )}
      </Step>

      <Step n={5} title="صور الصفحة الرئيسية (إن لزم)">
        <p>
          الصفحة الرئيسية محفوظة في قاعدة البيانات بالفعل، لكن قد تشير بعض أقسامها إلى صور محلية. هذه الخطوة تحدّث
          المراجع إلى الصور المرفوعة (بعد التحقق من رفعها).
        </p>
        <p className="text-xs">مراجع محلية متبقية في الصفحة الرئيسية: {localHomeRefs.length}</p>
        <button
          type="button"
          className={ghostBtn}
          disabled={!plan || !uploads || uploadFailures.length > 0 || localHomeRefs.length === 0 || home.busy}
          onClick={rewriteHome}
        >
          {home.busy ? 'جارٍ التحديث…' : 'تحديث صور الصفحة الرئيسية'}
        </button>
        {home.error && (
          <p role="alert" className="text-xs font-medium text-burgundy">
            {home.error}
          </p>
        )}
        {homeResult && (
          <p className="text-xs">
            {homeResult.filter((r) => r.status === 'rewritten').length} قسم حُدّث ·{' '}
            {homeResult.filter((r) => r.status === 'failed').length} فشل
          </p>
        )}
      </Step>

      <Step n={6} title="اعتماد الترحيل">
        <p>
          بعد نجاح التحقق وعدم وجود تعارضات: فعّل قاعدة البيانات مصدرًا للمتجر والإدارة. يمكنك الرجوع إلى الكتالوج
          المدمج في أي وقت من أعلى الصفحة (لا يحذف أي بيانات).
        </p>
        <button type="button" className={primaryBtn} disabled={!canFinalize || cutover.busy} onClick={() => setConfirm('finalize')}>
          اعتماد وتفعيل
        </button>
        {docs.initialized && <p className="text-xs">مُفعَّل بالفعل.</p>}
      </Step>

      <p className="text-xs leading-6 text-espresso/55">
        ملاحظة: بيانات هذا المتصفح (localStorage / IndexedDB) لا تُمسح أبدًا من هنا. بعد التأكد من سلامة كل شيء
        في متصفح آخر ونافذة خاصة، يمكنك تنظيفها يدويًا إن أردت.
      </p>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === 'rollback'}
        title={confirm === 'finalize' ? 'اعتماد الترحيل' : 'الرجوع إلى الكتالوج المدمج'}
        body={
          confirm === 'finalize'
            ? 'سيقرأ المتجر والإدارة الكتالوج من قاعدة البيانات من الآن، وتصبح تعديلات الكتالوج مفعّلة. متابعة؟'
            : 'سيعود المتجر لعرض الكتالوج المدمج وتتعطّل تعديلات الكتالوج. لا تُحذف أي بيانات من قاعدة البيانات. متابعة؟'
        }
        confirmLabel={cutover.busy ? 'جارٍ التنفيذ…' : confirm === 'finalize' ? 'اعتماد وتفعيل' : 'رجوع'}
        confirmDisabled={cutover.busy}
        error={cutover.error}
        onConfirm={() => confirm && void runCutover(confirm)}
        onCancel={() => {
          cutover.clearError();
          setConfirm(null);
        }}
      />
    </div>
  );
}

const CONFLICT_AR: Record<ImportReport['conflicts'][number]['reason'], string> = {
  different_data: 'يوجد سجل مختلف بنفس المعرّف',
  slug_taken: 'الـ slug مستخدم في سجل آخر',
  sku_taken: 'رمز SKU مستخدم في منتج آخر',
  sku_duplicate_in_product: 'رمز SKU مكرر داخل المنتج نفسه',
};

function ConflictList({ report }: { report: ImportReport }) {
  if (report.conflicts.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="font-medium text-burgundy">
        تعارضات (لن تُستبدل — تبقى نسخة قاعدة البيانات، ونسختك محفوظة في الملف الاحتياطي):
      </p>
      <ul className="mt-1 list-disc ps-5">
        {report.conflicts.slice(0, 50).map((c) => (
          <li key={`${c.kind}:${c.id}`} dir="ltr" className="text-start">
            {c.kind}/{c.id} —{' '}
            {CONFLICT_AR[c.reason]}
            {c.sku ? ` (${c.sku})` : ''}
          </li>
        ))}
      </ul>
      {report.conflicts.length > 50 && <p>… و{report.conflicts.length - 50} أخرى</p>}
    </div>
  );
}
