import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  isSafeNavUrl,
  removeNavItem,
  saveNavGroup,
  upsertNavItem,
  useNavigation,
  type NavGroup,
  type NavItemKind,
  type StorefrontNavItem,
} from '../../storefront/layout/navStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { generateId } from '../../shared/utils/id';

const inputCls =
  'w-full border border-taupe bg-white px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-xs font-semibold tracking-wide text-espresso';

const GROUPS: { key: NavGroup; title: string; desc: string }[] = [
  {
    key: 'main',
    title: 'القائمة الرئيسية',
    desc: 'تظهر في هيدر المتجر وقائمة الجوال وعمود «تسوق» في الفوتر — تدعم قائمة فرعية واحدة لكل رابط.',
  },
  {
    key: 'footer',
    title: 'روابط الفوتر',
    desc: 'عمود «المساعدة» أسفل المتجر — روابط صفحات الدعم، بلا قوائم فرعية.',
  },
];

interface Draft {
  group: NavGroup;
  parentId: string | null;
  id: string | null;
  label: string;
  kind: NavItemKind;
  path: string;
  visible: boolean;
}

export function AdminNavigationPage() {
  const nav = useNavigation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [del, setDel] = useState<{ group: NavGroup; parentId: string | null; id: string } | null>(
    null,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const parentOf = (group: NavGroup, parentId: string | null) =>
    parentId ? nav[group].find((i) => i.id === parentId) : undefined;

  const listFor = (group: NavGroup, parentId: string | null) =>
    parentId ? (parentOf(group, parentId)?.children ?? []) : nav[group];

  const saveList = (group: NavGroup, parentId: string | null, items: StorefrontNavItem[]) => {
    if (!parentId) {
      saveNavGroup(group, items);
      return;
    }
    const parent = parentOf(group, parentId);
    if (parent) upsertNavItem(group, { ...parent, children: items });
  };

  const move = (group: NavGroup, parentId: string | null, i: number, dir: -1 | 1) => {
    const list = listFor(group, parentId);
    const t = i + dir;
    if (t < 0 || t >= list.length) return;
    const next = [...list];
    [next[i], next[t]] = [next[t], next[i]];
    saveList(group, parentId, next);
  };

  const toggleVisible = (group: NavGroup, parentId: string | null, id: string) =>
    saveList(
      group,
      parentId,
      listFor(group, parentId).map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
    );

  const openAdd = (group: NavGroup, parentId: string | null) => {
    setErrors({});
    setDraft({ group, parentId, id: null, label: '', kind: 'internal', path: '', visible: true });
  };

  const openEdit = (group: NavGroup, parentId: string | null, item: StorefrontNavItem) => {
    setErrors({});
    setDraft({
      group,
      parentId,
      id: item.id,
      label: item.label,
      kind: item.kind,
      path: item.path,
      visible: item.visible,
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const errs: Record<string, string> = {};
    if (draft.label.trim().length < 2) errs.label = 'اسم الرابط بالعربي مطلوب (حرفان على الأقل).';
    const existing = draft.id
      ? listFor(draft.group, draft.parentId).find((i) => i.id === draft.id)
      : undefined;
    const hasChildren = !draft.parentId && (existing?.children?.length ?? 0) > 0;
    if (!draft.path.trim()) {
      if (!hasChildren)
        errs.path = 'الوجهة مطلوبة — أضف وجهة أو أضف روابط فرعية أولًا ليصبح زر قائمة فقط.';
    } else if (!isSafeNavUrl(draft.kind, draft.path)) {
      errs.path =
        draft.kind === 'internal'
          ? 'وجهة داخلية يجب أن تبدأ بـ / — مثل /products أو /category/rugs.'
          : 'رابط خارجي يجب أن يبدأ بـ https:// أو http:// — بروتوكولات غير آمنة مرفوضة.';
    }
    const dup = listFor(draft.group, draft.parentId).some(
      (i) => i.id !== draft.id && i.label.trim() === draft.label.trim(),
    );
    if (dup) errs.label = 'يوجد رابط بنفس الاسم في هذه القائمة.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const item: StorefrontNavItem = {
      id: draft.id ?? generateId(),
      label: draft.label.trim(),
      kind: draft.kind,
      path: draft.path.trim(),
      visible: draft.visible,
      ...(existing?.children?.length ? { children: existing.children } : {}),
    };
    const list = listFor(draft.group, draft.parentId);
    saveList(
      draft.group,
      draft.parentId,
      list.some((i) => i.id === item.id)
        ? list.map((i) => (i.id === item.id ? item : i))
        : [...list, item],
    );
    setDraft(null);
  };

  const delParent = del?.parentId ? parentOf(del.group, del.parentId) : undefined;
  const delItem = del
    ? (delParent?.children ?? nav[del.group]).find((i) => i.id === del.id)
    : undefined;
  const delChildrenCount = delItem?.children?.length ?? 0;

  const formFor = (group: NavGroup, parentId: string | null) => {
    if (!draft || draft.group !== group || draft.parentId !== parentId) return null;
    const parent = parentOf(group, parentId);
    return (
      <form
        onSubmit={submit}
        noValidate
        className={`rounded border border-burgundy/40 bg-white p-5 ${parentId ? 'mt-3' : 'mt-4'}`}
      >
        <h3 className="text-sm font-semibold text-espresso">
          {draft.id ? 'تعديل الرابط' : parentId ? `رابط فرعي داخل «${parent?.label ?? ''}»` : 'رابط جديد'}
        </h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`nv-label-${parentId ?? 'top'}`} className={labelCls}>
              الاسم بالعربي *
            </label>
            <input
              id={`nv-label-${parentId ?? 'top'}`}
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              className={inputCls}
              aria-invalid={Boolean(errors.label)}
            />
            {errors.label && <p className="mt-1.5 text-xs text-burgundy">{errors.label}</p>}
          </div>
          <div>
            <span className={labelCls}>نوع الرابط *</span>
            <div className="flex gap-4 pt-2">
              {(['internal', 'external'] as const).map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-2 text-sm text-espresso/80"
                >
                  <input
                    type="radio"
                    name={`nv-kind-${parentId ?? 'top'}`}
                    className="sr-only"
                    checked={draft.kind === k}
                    onChange={() => setDraft({ ...draft, kind: k })}
                  />
                  <span
                    className={`size-4 shrink-0 rounded-full border ${
                      draft.kind === k ? 'border-[5px] border-burgundy' : 'border-espresso/30'
                    }`}
                    aria-hidden
                  />
                  {k === 'internal' ? 'داخلي' : 'خارجي'}
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`nv-path-${parentId ?? 'top'}`} className={labelCls}>
              {draft.kind === 'internal'
                ? parentId
                  ? 'الوجهة (مسار داخلي) *'
                  : 'الوجهة (مسار داخلي) — اتركه فارغًا ليكون زر قائمة فقط'
                : 'الرابط الخارجي *'}
            </label>
            <input
              id={`nv-path-${parentId ?? 'top'}`}
              dir="ltr"
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              className={inputCls}
              placeholder={draft.kind === 'internal' ? '/category/rugs' : 'https://…'}
              aria-invalid={Boolean(errors.path)}
            />
            {errors.path && <p className="mt-1.5 text-xs text-burgundy">{errors.path}</p>}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-espresso/75">
            <input
              type="checkbox"
              className="sr-only"
              checked={draft.visible}
              onChange={(e) => setDraft({ ...draft, visible: e.target.checked })}
            />
            <span
              className={`flex size-4 shrink-0 items-center justify-center border transition ${
                draft.visible ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30'
              }`}
              aria-hidden
            >
              {draft.visible && (
                <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                  <path d="M2 6.5 5 9l5-6" />
                </svg>
              )}
            </span>
            ظاهر في المتجر
          </label>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-burgundy px-6 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            {draft.id ? 'حفظ الرابط' : 'إضافة الرابط'}
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="text-sm font-medium text-espresso/60 transition hover:text-espresso"
          >
            إلغاء
          </button>
        </div>
      </form>
    );
  };

  const itemRow = (group: NavGroup, parentId: string | null, item: StorefrontNavItem, i: number) => {
    const list = listFor(group, parentId);
    const kids = item.children ?? [];
    const expanded = expandedId === item.id;
    const canNest = group === 'main' && !parentId;
    return (
      <li key={item.id} className={parentId ? 'px-3 py-2.5' : 'px-5 py-3.5'}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => move(group, parentId, i, -1)}
              disabled={i === 0}
              aria-label={`تقديم ${item.label}`}
              className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <ArrowUp className="size-3" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => move(group, parentId, i, 1)}
              disabled={i === list.length - 1}
              aria-label={`تأخير ${item.label}`}
              className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <ArrowDown className="size-3" aria-hidden />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-espresso">{item.label}</span>
              <span className="rounded-full border border-espresso/20 px-1.5 py-px text-[10px] text-espresso/55">
                {item.kind === 'internal' ? 'داخلي' : 'خارجي'}
              </span>
              {!item.path && (
                <span className="rounded-full border border-gold/50 bg-gold/10 px-1.5 py-px text-[10px] text-espresso/70">
                  زر قائمة فقط
                </span>
              )}
              {kids.length > 0 && (
                <span className="rounded-full border border-espresso/20 px-1.5 py-px text-[10px] text-espresso/55">
                  {kids.length} روابط فرعية
                </span>
              )}
              {!item.visible && (
                <span className="rounded-full border border-espresso/25 bg-espresso/5 px-2 py-0.5 text-[10px] font-semibold text-espresso/70">
                  مخفي
                </span>
              )}
            </div>
            {item.path && (
              <p className="mt-0.5 font-mono text-xs text-espresso/50" dir="ltr">
                {item.path}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {canNest && (
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : item.id)}
                aria-expanded={expanded}
                aria-label={`${expanded ? 'طي' : 'عرض'} روابط ${item.label} الفرعية`}
                className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                <ChevronDown
                  className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
            )}
            <label className="me-1 flex cursor-pointer items-center gap-1.5 text-xs text-espresso/70">
              <input
                type="checkbox"
                className="sr-only"
                checked={item.visible}
                onChange={() => toggleVisible(group, parentId, item.id)}
              />
              <span
                className={`flex size-4 shrink-0 items-center justify-center border transition ${
                  item.visible ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30'
                }`}
                aria-hidden
              >
                {item.visible && (
                  <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                    <path d="M2 6.5 5 9l5-6" />
                  </svg>
                )}
              </span>
              إظهار
            </label>
            <button
              type="button"
              onClick={() => openEdit(group, parentId, item)}
              aria-label={`تعديل ${item.label}`}
              className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setDel({ group, parentId, id: item.id })}
              aria-label={`حذف ${item.label}`}
              className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {canNest && expanded && (
          <div className="mt-3 border-s-2 border-espresso/15 ps-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-espresso/60">الروابط الفرعية</p>
              <button
                type="button"
                onClick={() => openAdd(group, item.id)}
                className="inline-flex items-center gap-1.5 rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                <Plus className="size-3.5" aria-hidden /> إضافة رابط فرعي
              </button>
            </div>
            {kids.length === 0 ? (
              <p className="mt-2 rounded border border-dashed border-taupe px-3 py-4 text-center text-xs text-espresso/50">
                لا روابط فرعية بعد.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-taupe/50 rounded border border-taupe/60 bg-porcelain/40">
                {kids.map((child, ci) => itemRow(group, item.id, child, ci))}
              </ul>
            )}
            {formFor(group, item.id)}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <AdminPageHeader
        title="التنقل"
        description="روابط متجر الواجهة — القائمة الرئيسية وروابط الفوتر. التعديلات تظهر فورًا؛ روابط لوحة الإدارة لا تُدار من هنا."
      />

      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`nav-${g.key}`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id={`nav-${g.key}`} className="font-display text-lg text-espresso">
                {g.title}
              </h2>
              <p className="mt-0.5 text-xs text-espresso/55">{g.desc}</p>
            </div>
            <button
              type="button"
              onClick={() => openAdd(g.key, null)}
              className="inline-flex items-center gap-2 rounded bg-burgundy px-4 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <Plus className="size-4" aria-hidden /> إضافة رابط
            </button>
          </div>

          {nav[g.key].length === 0 ? (
            <p className="mt-4 rounded border border-dashed border-taupe bg-white py-10 text-center text-sm text-espresso/60">
              لا توجد روابط — أضف أول رابط.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-taupe/60 rounded border border-taupe/70 bg-white">
              {nav[g.key].map((item, i) => itemRow(g.key, null, item, i))}
            </ul>
          )}

          {formFor(g.key, null)}
        </section>
      ))}

      <ConfirmDialog
        open={del !== null}
        title="حذف الرابط"
        body={
          delItem
            ? `حذف «${delItem.label}» من ${
                del?.parentId
                  ? `الروابط الفرعية لـ «${delParent?.label ?? ''}»`
                  : del?.group === 'main'
                    ? 'القائمة الرئيسية'
                    : 'روابط الفوتر'
              }؟${
                delChildrenCount > 0
                  ? ` سيُحذف معها ${delChildrenCount} روابط فرعية.`
                  : ''
              } الصفحة أو المحتوى الذي يشير إليه الرابط لا يتأثر — يُحذف الرابط فقط.`
            : ''
        }
        confirmLabel="حذف الرابط"
        onConfirm={() => {
          if (del) {
            if (del.parentId) {
              const parent = parentOf(del.group, del.parentId);
              if (parent)
                upsertNavItem(del.group, {
                  ...parent,
                  children: (parent.children ?? []).filter((c) => c.id !== del.id),
                });
            } else {
              removeNavItem(del.group, del.id);
            }
          }
          setDel(null);
        }}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}
