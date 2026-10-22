import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCatalog, upsertProduct } from '../../storefront/catalog/catalogStore';
import { generateId } from '../../shared/utils/id';
import {
  attributeByKey,
  attributeValueReferences,
  upsertAttribute,
  useAttributes,
  RESERVED_ATTRIBUTE_KEYS,
  type AttributeValue,
} from '../../storefront/catalog/attributeStore';
import type { Availability, CatalogProduct, ProductVariant } from '../../storefront/catalog/catalogData';
import {
  axisValuesForAxes,
  comboKey,
  generateVariantCombos,
  newVariantId,
  normalizeSku,
  skuTaken,
  suggestVariantSku,
  syncVariantMatrix,
  validateProductVariants,
} from '../../storefront/catalog/variants';
import { VariantMatrixSection } from './VariantMatrixSection';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ImageUploadField } from '../components/ImageUploadField';
import { ConfirmDialog } from '../components/ConfirmDialog';

const inputCls =
  'w-full border border-taupe bg-white px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-xs font-semibold tracking-wide text-espresso';
const checkRow =
  'flex cursor-pointer items-center gap-2 py-0.5 text-sm text-espresso/75 hover:text-espresso';
const checkBox = (on: boolean) =>
  `flex size-4 shrink-0 items-center justify-center border transition ${
    on ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30 bg-transparent'
  }`;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKU_RE = /^[A-Za-z0-9-]{3,}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// "280 × 200 سم"-style labels carry their dimensions in the text — re-parsed
// on save so widthCm/lengthCm follow the edited label instead of going stale;
// a renamed label with no dimensions drops them.
const SIZE_DIM_RE = /(\d+)\s*[×xX*]\s*(\d+)/;

// Managed option groups — each reserved attribute gets a single «إدارة»
// dialog covering select/rename/enable/delete/add for its values, replacing
// the old per-option checkbox lists in the form.
type ManagerAttrKey = 'color' | 'material' | 'size';
const ATTR_PLURAL: Record<ManagerAttrKey, string> = {
  color: 'الألوان',
  material: 'الخامات',
  size: 'المقاسات',
};
const ATTR_SINGULAR: Record<ManagerAttrKey, string> = {
  color: 'اللون',
  material: 'الخامة',
  size: 'المقاس',
};
const ATTR_UNIT: Record<ManagerAttrKey, string> = {
  color: 'لون',
  material: 'خامة',
  size: 'مقاس',
};
const ATTR_FIELD: Record<ManagerAttrKey, 'colors' | 'materials' | 'sizes'> = {
  color: 'colors',
  material: 'materials',
  size: 'sizes',
};

interface Fields {
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  sku: string;
  slug: string;
  price: string;
  compareAt: string;
  category: string;
  collection: string;
  colors: string[];
  materials: string[];
  sizes: string[];
  size: string;
  availability: Availability;
  published: boolean;
  featured: boolean;
  isNew: boolean;
  image: string;
  imageHover: string;
  extraImages: string[];
  // Custom attribute assignments (non-reserved attrKeys only).
  attributes: Record<string, string[]>;
  // Variant management — axes + the stored matrix. Axis values are derived
  // from this product's own fields (colors/materials/sizes/attributes), never
  // selected twice. Designating ≥1 axis makes it a variant product; with no
  // axes, stored variant data is preserved verbatim as dormant data.
  variantAxes: string[];
  variants: ProductVariant[];
}

function fromProduct(p: CatalogProduct): Fields {
  return {
    nameAr: p.name.ar,
    nameEn: p.name.en,
    descAr: p.description.ar,
    descEn: p.description.en,
    sku: p.sku,
    slug: p.slug,
    price: String(p.price),
    compareAt: p.compareAtPrice !== null ? String(p.compareAtPrice) : '',
    category: p.category,
    collection: p.collection,
    colors: p.colors,
    materials: p.materials,
    sizes: p.sizes,
    size: p.size,
    availability: p.availability,
    published: p.published,
    featured: p.featured,
    isNew: p.isNew,
    image: p.image,
    imageHover: p.imageHover,
    extraImages: p.images.slice(2),
    // Defensive: reserved keys never enter the custom map.
    attributes: Object.fromEntries(
      Object.entries(p.attributes ?? {}).filter(
        ([k]) => !RESERVED_ATTRIBUTE_KEYS.includes(k as never),
      ),
    ),
    variantAxes: p.variantAxes ?? [],
    variants: p.variants ?? [],
  };
}

const empty: Fields = {
  nameAr: '',
  nameEn: '',
  descAr: '',
  descEn: '',
  sku: '',
  slug: '',
  price: '',
  compareAt: '',
  category: '',
  collection: '',
  colors: [],
  materials: [],
  sizes: [],
  size: '',
  availability: 'in_stock',
  published: true,
  featured: false,
  isNew: false,
  image: '',
  imageHover: '',
  extraImages: [],
  attributes: {},
  variantAxes: [],
  variants: [],
};

export function ProductFormPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const attrs = useAttributes(); // option checkboxes resolve from the attribute store
  const existing = productId ? catalog.products.find((p) => p.id === productId) : undefined;

  const [fields, setFields] = useState<Fields>(() =>
    existing ? fromProduct(existing) : empty,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [slugTouched, setSlugTouched] = useState(Boolean(existing));

  // Managed option dialogs — one entry point per reserved attribute
  // (الألوان/الخامات/المقاسات) covering selection, renaming, enabling,
  // deletion, and adding new values. Drafts hold unsaved edits keyed by
  // value key; «حفظ التعديلات» applies them plus the product's selection.
  const [managerAttr, setManagerAttr] = useState<ManagerAttrKey | null>(null);
  const [valueDrafts, setValueDrafts] = useState<
    Record<
      string,
      { selected: boolean; labelAr: string; enabled: boolean; hex: string }
    >
  >({});
  const [newLabel, setNewLabel] = useState('');
  const [newHex, setNewHex] = useState('#681D20');
  const [newW, setNewW] = useState('');
  const [newL, setNewL] = useState('');
  const [managerError, setManagerError] = useState<string | null>(null);
  // Default-size pick lives inside the sizes manager — a draft seeded from
  // the form so the whole size setup completes in one place.
  const [defaultDraft, setDefaultDraft] = useState('');
  // Pending value deletion — rewriting a global attribute value is gated by
  // the same reference scan used on the attributes page (confirm dialog).
  const [delValue, setDelValue] = useState<{
    attrKey: ManagerAttrKey;
    valueKey: string;
  } | null>(null);
  // Transient success feedback after manager save / value delete — the page
  // has no toast system, so this is a small self-dismissing status line.
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (managerAttr === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setManagerAttr(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [managerAttr]);

  // Live audit of the variant configuration — the same issues block save in
  // validate() and annotate matrix rows inside VariantMatrixSection.
  const variantIssues = useMemo(() => {
    if (fields.variantAxes.length === 0 && fields.variants.length === 0)
      return [];
    const price = fields.price.trim() ? Number(fields.price) : null;
    const compareAt = fields.compareAt.trim() ? Number(fields.compareAt) : null;
    const draft: CatalogProduct = {
      id: existing?.id ?? '__draft__',
      slug: fields.slug.trim(),
      sku: fields.sku.trim(),
      name: { ar: fields.nameAr.trim(), en: '' },
      description: { ar: '', en: '' },
      category: fields.category,
      collection: fields.collection,
      price: price !== null && Number.isFinite(price) ? price : 0,
      compareAtPrice:
        compareAt !== null && Number.isFinite(compareAt) ? compareAt : null,
      availability: 'in_stock',
      colors: [],
      materials: [],
      size: '',
      sizes: [],
      createdAt: '',
      featured: false,
      published: false,
      isNew: false,
      image: '',
      imageHover: '',
      images: [],
      variantAxes: fields.variantAxes,
      variants: fields.variants,
    };
    const productsForCheck = catalog.products.some((p) => p.id === draft.id)
      ? catalog.products.map((p) => (p.id === draft.id ? draft : p))
      : [...catalog.products, draft];
    return validateProductVariants(draft, attrs, productsForCheck);
  }, [
    fields.variantAxes,
    fields.variants,
    fields.sku,
    fields.slug,
    fields.nameAr,
    fields.category,
    fields.collection,
    fields.price,
    fields.compareAt,
    existing?.id,
    catalog.products,
    attrs,
  ]);

  // Axis values derive from the product's own fields — colors/materials/sizes
  // for reserved attribute keys, custom attribute assignments otherwise —
  // filtered to enabled attribute values. Editing الخيارات والحالة updates
  // generation inputs automatically; matching variants keep their data,
  // dropped combos are retained inactive.
  const axisValues = useMemo(
    () => axisValuesForAxes(fields.variantAxes, fields, attrs),
    [fields, attrs],
  );

  // Combos produced by the product's current attribute selections but not yet
  // materialized as stored variants — regenerating is required before save so
  // nothing new is written unreviewed.
  const pendingCombos = useMemo(() => {
    if (fields.variantAxes.length === 0) return 0;
    const generated = generateVariantCombos(fields.variantAxes, axisValues);
    if (!generated) return 0;
    const stored = new Set(fields.variants.map((v) => comboKey(v.combo)));
    return generated.filter((c) => !stored.has(comboKey(c))).length;
  }, [fields.variantAxes, axisValues, fields.variants]);

  if (productId && !existing) {
    return (
      <div className="mx-auto max-w-4xl">
        <AdminPageHeader title="المنتج غير موجود" />
        <Link
          to="/admin/products"
          className="inline-flex items-center gap-2 text-sm font-medium text-burgundy underline-offset-4 hover:underline"
        >
          <ArrowRight className="size-4" /> العودة إلى المنتجات
        </Link>
      </div>
    );
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));



  const err = (key: keyof Fields) =>
    errors[key] ? <p className="mt-1.5 text-xs text-burgundy">{errors[key]}</p> : null;

  // Parsed numerics reused by variant inheritance hints.
  const parsedPrice = fields.price.trim() ? Number(fields.price) : null;
  const parsedCompareAt = fields.compareAt.trim() ? Number(fields.compareAt) : null;

  // Reference scan for the pending value deletion — a warning in the confirm
  // dialog, never a hard block. This product's own assignment is excluded
  // because confirming strips it from the form fields anyway; confirming
  // also rewrites every other product's matching fields so no stored
  // assignment survives as an orphan key.
  const delTarget =
    delValue !== null
      ? attributeByKey(delValue.attrKey)?.values.find(
          (v) => v.key === delValue.valueKey,
        )
      : undefined;
  const delRefs =
    delValue !== null
      ? attributeValueReferences(delValue.attrKey, delValue.valueKey).filter(
          (r) => r !== `منتج: ${existing?.name.ar}`,
        )
      : [];
  const delReferenced = delRefs.length > 0;

  const confirmDeleteValue = () => {
    if (delValue === null) return;
    const { attrKey, valueKey } = delValue;
    const attr = attributeByKey(attrKey);
    if (attr) {
      upsertAttribute({
        ...attr,
        values: attr.values.filter((v) => v.key !== valueKey),
      });
    }
    for (const p of catalog.products) {
      if (attrKey === 'size') {
        if (!p.sizes.includes(valueKey) && p.size !== valueKey) continue;
        const sizes = p.sizes.filter((s) => s !== valueKey);
        upsertProduct({
          ...p,
          sizes,
          size: p.size === valueKey ? '' : p.size,
        });
      } else if (attrKey === 'color' && p.colors.includes(valueKey)) {
        upsertProduct({ ...p, colors: p.colors.filter((c) => c !== valueKey) });
      } else if (attrKey === 'material' && p.materials.includes(valueKey)) {
        upsertProduct({
          ...p,
          materials: p.materials.filter((m) => m !== valueKey),
        });
      }
    }
    setFields((f) => {
      if (attrKey === 'size') {
        const sizes = f.sizes.filter((s) => s !== valueKey);
        return {
          ...f,
          sizes,
          size: f.size === valueKey ? '' : f.size,
        };
      }
      if (attrKey === 'color')
        return { ...f, colors: f.colors.filter((c) => c !== valueKey) };
      return { ...f, materials: f.materials.filter((m) => m !== valueKey) };
    });
    setValueDrafts((s) => {
      const next = { ...s };
      delete next[valueKey];
      return next;
    });
    setDelValue(null);
    setToast(`تم حذف «${delTarget?.label.ar ?? ''}» بنجاح.`);
  };

  const openManager = (attrKey: ManagerAttrKey) => {
    const attr = attributeByKey(attrKey);
    const fieldKey = ATTR_FIELD[attrKey];
    setValueDrafts(
      Object.fromEntries(
        (attr?.values ?? []).map((v) => [
          v.key,
          {
            selected: fields[fieldKey].includes(v.key),
            labelAr: v.label.ar,
            enabled: v.enabled,
            hex: v.hex ?? '',
          },
        ]),
      ),
    );
    setNewLabel('');
    setNewHex('#681D20');
    setNewW('');
    setNewL('');
    setDefaultDraft(fields.size);
    setManagerError(null);
    setManagerAttr(attrKey);
  };

  const patchDraft = (
    key: string,
    patch: Partial<{
      selected: boolean;
      labelAr: string;
      enabled: boolean;
      hex: string;
    }>,
  ) =>
    setValueDrafts((s) => {
      const cur =
        s[key] ?? { selected: false, labelAr: '', enabled: true, hex: '' };
      return { ...s, [key]: { ...cur, ...patch } };
    });

  // New values register in the attribute store immediately (variant axes and
  // storefront filters resolve by key) and are drafted as selected — the
  // product assignment itself applies on «حفظ التعديلات».
  const addManagerValue = () => {
    if (managerAttr === null) return;
    const attr = attributeByKey(managerAttr);
    if (!attr) return;
    let value: AttributeValue;
    if (managerAttr === 'size') {
      const w = Number(newW.trim());
      const l = Number(newL.trim());
      if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(l) || l <= 0) {
        setManagerError('أدخل عرض وطول صحيحين بالسنتيمتر (أرقام أكبر من صفر).');
        return;
      }
      value = {
        key: `${w}x${l}`,
        label: { ar: `${w} × ${l} سم`, en: `${w} × ${l} cm` },
        widthCm: w,
        lengthCm: l,
        enabled: true,
        order: attr.values.length + 1,
      };
    } else {
      const labelAr = newLabel.trim();
      if (!labelAr) {
        setManagerError('اكتب اسم القيمة بالعربي أولًا.');
        return;
      }
      if (attr.values.some((v) => v.label.ar === labelAr)) {
        setManagerError('القيمة موجودة بالفعل.');
        return;
      }
      value = {
        key: `v-${generateId().slice(0, 8)}`,
        label: { ar: labelAr, en: '' },
        enabled: true,
        order: attr.values.length + 1,
      };
      if (managerAttr === 'color') value.hex = newHex;
    }
    setManagerError(null);
    if (!attr.values.some((v) => v.key === value.key)) {
      upsertAttribute({ ...attr, values: [...attr.values, value] });
    }
    patchDraft(value.key, {
      selected: true,
      labelAr: value.label.ar,
      enabled: true,
      hex: value.hex ?? '',
    });
    setNewLabel('');
    setNewHex('#681D20');
    setNewW('');
    setNewL('');
  };

  const saveManager = () => {
    if (managerAttr === null) return;
    const attrKey = managerAttr;
    const attr = attributeByKey(attrKey);
    if (attr) {
      upsertAttribute({
        ...attr,
        values: attr.values.map((v) => {
          const d = valueDrafts[v.key];
          if (!d) return v;
          const next: AttributeValue = {
            ...v,
            label: { ...v.label, ar: d.labelAr.trim() || v.label.ar },
            enabled: d.enabled,
          };
          if (attrKey === 'color') {
            if (HEX_RE.test(d.hex)) next.hex = d.hex;
          } else if (attrKey === 'size') {
            const m = SIZE_DIM_RE.exec(next.label.ar);
            if (m) {
              next.widthCm = Number(m[1]);
              next.lengthCm = Number(m[2]);
            } else {
              delete next.widthCm;
              delete next.lengthCm;
            }
          }
          return next;
        }),
      });
      // Selection applies here too — the dialog replaced the old checkbox
      // list, so «للمنتج» drafts become this product's assignments
      // (attribute order). The default size comes from the dialog's own
      // pick, constrained to what's selected — never auto-filled.
      const fieldKey = ATTR_FIELD[attrKey];
      const selected = attr.values
        .filter(
          (v) =>
            valueDrafts[v.key]?.selected ?? fields[fieldKey].includes(v.key),
        )
        .map((v) => v.key);
      const nextSize =
        attrKey === 'size'
          ? selected.includes(defaultDraft)
            ? defaultDraft
            : ''
          : undefined;
      setFields((f) => {
        if (attrKey === 'size') return { ...f, sizes: selected, size: nextSize ?? '' };
        if (attrKey === 'color') return { ...f, colors: selected };
        return { ...f, materials: selected };
      });
      // When editing a stored product the assignment persists right away —
      // the attribute system is its own subsystem (values are global anyway),
      // so the "incomplete size data" notification clears the moment the fix
      // is real instead of waiting on the full form submit. The eventual
      // form save rewrites the same fields.
      if (existing) {
        if (attrKey === 'size')
          upsertProduct({ ...existing, sizes: selected, size: nextSize ?? '' });
        else if (attrKey === 'color')
          upsertProduct({ ...existing, colors: selected });
        else upsertProduct({ ...existing, materials: selected });
      }
      setToast('تم حفظ التعديلات بنجاح.');
    }
    setManagerAttr(null);
  };

  // One fieldset per managed group — just the manage button and a selection
  // count; everything else lives inside the dialog.
  const managerField = (attrKey: ManagerAttrKey) => {
    const fieldKey = ATTR_FIELD[attrKey];
    const count = fields[fieldKey].length;
    return (
      <fieldset>
        <legend className="mb-2 text-xs font-semibold tracking-wide text-espresso">
          {ATTR_PLURAL[attrKey]}
        </legend>
        <button
          type="button"
          onClick={() => openManager(attrKey)}
          className="inline-flex items-center gap-2 rounded border border-burgundy/40 bg-burgundy/5 px-4 py-2.5 text-sm font-semibold text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <Pencil className="size-4" aria-hidden /> إدارة {ATTR_PLURAL[attrKey]}
        </button>
        <p className="mt-1.5 text-[11px] text-espresso/50">
          {count > 0
            ? `${count} ${ATTR_UNIT[attrKey]} مختار لهذا المنتج`
            : 'لا شيء مختار بعد'}
        </p>
        {err(fieldKey)}
      </fieldset>
    );
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof Fields, string>> = {};
    const price = Number(fields.price);
    const compareAt = fields.compareAt.trim() ? Number(fields.compareAt) : null;

    if (fields.nameAr.trim().length < 2) e.nameAr = 'اسم المنتج مطلوب (حرفان على الأقل).';
    if (!SKU_RE.test(fields.sku.trim())) e.sku = 'SKU مطلوب — أحرف إنجليزية وأرقام وشرطات فقط.';
    else if (skuTaken(fields.sku, catalog.products, { productId: existing?.id }))
      e.sku = 'SKU مستخدم بالفعل — لمنتج أو تنويعة أخرى.';
    if (!SLUG_RE.test(fields.slug.trim()))
      e.slug = 'الـ slug مطلوب — أحرف إنجليزية صغيرة وأرقام وشرطات.';
    else if (
      catalog.products.some((p) => p.slug === fields.slug.trim() && p.id !== existing?.id)
    )
      e.slug = 'الـ slug مستخدم بالفعل.';
    if (!fields.price.trim() || !Number.isFinite(price) || price <= 0)
      e.price = 'السعر مطلوب ويجب أن يكون أكبر من صفر.';
    if (compareAt !== null && (!Number.isFinite(compareAt) || compareAt <= price))
      e.compareAt = 'السعر قبل الخصم يجب أن يكون أكبر من السعر الحالي.';
    if (!catalog.categories.some((c) => c.slug === fields.category))
      e.category = 'اختر تصنيفًا.';
    if (!fields.collection) e.collection = 'اختر مجموعة.';
    if (fields.sizes.length === 0) e.sizes = 'اختر مقاسًا واحدًا على الأقل.';
    else if (!fields.sizes.includes(fields.size)) e.size = 'المقاس الافتراضي يجب أن يكون ضمن المقاسات المختارة.';
    if (!fields.image.trim()) e.image = 'الصورة الأساسية مطلوبة.';

    // Variant gate — a designated matrix must be structurally valid AND
    // current (every generated combo materialized as a stored variant).
    // Simple products (no axes) with preserved variant data aren't re-gated.
    if (fields.variantAxes.length > 0) {
      const emptyAxes = fields.variantAxes.filter(
        (a) => (axisValues[a] ?? []).length === 0,
      );
      if (emptyAxes.length > 0)
        e.variants = `محاور بلا قيم مختارة: ${emptyAxes.map((a) => attributeByKey(a)?.name.ar ?? a).join('، ')} — أضف قيمها في «الخيارات والحالة» أو أزل المحور.`;
      else if (variantIssues.length > 0)
        e.variants = `${variantIssues.length} مشكلة في إعداد التنويعات — راجع القسم أدناه.`;
      else if (pendingCombos > 0)
        e.variants = 'القيم المختارة تنتج تركيبات جديدة — اضغط «توليد / تحديث المصفوفة» قبل الحفظ.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const allImages = [
      fields.image.trim(),
      fields.imageHover.trim(),
      ...fields.extraImages.map((x) => x.trim()),
    ].filter(Boolean);
    // Variant persistence: axes designated → persist the matrix synced
    // against the current selections (matching combos keep their records;
    // dropped combos stay stored but inactive). No axes → previously stored
    // variant data rides through verbatim. Cleared → fields omitted entirely.
    let variantPart: Pick<CatalogProduct, 'variantAxes' | 'variants'> | Record<string, never>;
    if (fields.variantAxes.length > 0) {
      const taken = new Set(fields.variants.map((v) => normalizeSku(v.sku)));
      const isTaken = (s: string) =>
        normalizeSku(s) === normalizeSku(fields.sku) ||
        skuTaken(s, catalog.products, { productId: existing?.id }) ||
        taken.has(normalizeSku(s));
      const res = syncVariantMatrix(
        fields.variantAxes,
        axisValues,
        fields.variants,
        (combo) => {
          const suggested = suggestVariantSku(fields.sku, combo, isTaken);
          taken.add(normalizeSku(suggested));
          return {
            id: newVariantId(),
            sku: suggested,
            combo,
            price: null,
            compareAtPrice: null,
            stockQuantity: null,
            availability: 'in_stock' as Availability,
            image: null,
            active: true,
          };
        },
      );
      variantPart = res
        ? { variantAxes: fields.variantAxes, variants: res.variants }
        : { variantAxes: fields.variantAxes, variants: fields.variants };
    } else if (fields.variants.length > 0) {
      variantPart = { variantAxes: fields.variantAxes, variants: fields.variants };
    } else {
      variantPart = {};
    }
    const product: CatalogProduct = {
      id: existing?.id ?? generateId(),
      name: { ar: fields.nameAr.trim(), en: fields.nameEn.trim() },
      description: { ar: fields.descAr.trim(), en: fields.descEn.trim() },
      sku: fields.sku.trim(),
      slug: fields.slug.trim(),
      price: Math.round(Number(fields.price)),
      compareAtPrice: fields.compareAt.trim() ? Math.round(Number(fields.compareAt)) : null,
      category: fields.category,
      collection: fields.collection,
      colors: fields.colors,
      materials: fields.materials,
      size: fields.size,
      sizes: fields.sizes,
      availability: fields.availability,
      published: fields.published,
      featured: fields.featured,
      isNew: fields.isNew,
      image: fields.image.trim(),
      imageHover: fields.imageHover.trim() || fields.image.trim(),
      images: allImages,
      // Reserved keys can't enter the map; empty selections are dropped.
      // Stale/unknown assignments ride through untouched.
      attributes: Object.fromEntries(
        Object.entries(fields.attributes).filter(
          ([k, v]) => !(RESERVED_ATTRIBUTE_KEYS as readonly string[]).includes(k) && v.length > 0,
        ),
      ),
      ...variantPart,
      createdAt: existing?.createdAt ?? new Date().toISOString().slice(0, 10),
    };
    upsertProduct(product);
    navigate(`/admin/products/${product.id}`, {
      state: { saved: existing ? 'updated' : 'created' },
    });
  };

  const title = existing ? `تعديل: ${existing.name.ar}` : 'إضافة منتج';

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/admin/products"
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> المنتجات
      </Link>
      <div className="mt-4">
        <AdminPageHeader title={title} />
      </div>

      <form onSubmit={submit} noValidate className="space-y-8">
        <section className="rounded border border-taupe/70 bg-white p-5">
          <h3 className="font-display text-lg text-espresso">الأساسيات</h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="pf-name-ar" className={labelCls}>الاسم بالعربي *</label>
              <input id="pf-name-ar" value={fields.nameAr} onChange={(e) => set('nameAr', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.nameAr)} />
              {err('nameAr')}
            </div>
            <div>
              <label htmlFor="pf-name-en" className={labelCls}>الاسم بالإنجليزي (داخلي)</label>
              <input id="pf-name-en" value={fields.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pf-desc-ar" className={labelCls}>الوصف بالعربي</label>
              <textarea id="pf-desc-ar" value={fields.descAr} onChange={(e) => set('descAr', e.target.value)} rows={3} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pf-desc-en" className={labelCls}>الوصف بالإنجليزي (داخلي)</label>
              <textarea id="pf-desc-en" value={fields.descEn} onChange={(e) => set('descEn', e.target.value)} rows={2} dir="ltr" className={inputCls} />
            </div>
            <div>
              <label htmlFor="pf-sku" className={labelCls}>SKU *</label>
              <input id="pf-sku" value={fields.sku} onChange={(e) => set('sku', e.target.value)} dir="ltr" className={inputCls} placeholder="TYB-P25" aria-invalid={Boolean(errors.sku)} />
              {err('sku')}
            </div>
            <div>
              <label htmlFor="pf-slug" className={labelCls}>الـ slug التقني *</label>
              <input
                id="pf-slug"
                value={fields.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set('slug', e.target.value);
                }}
                dir="ltr"
                className={inputCls}
                placeholder="wool-rug-burgundy"
                aria-invalid={Boolean(errors.slug)}
              />
              {!existing && !slugTouched && (
                <button
                  type="button"
                  onClick={() => set('slug', slugify(fields.nameEn || fields.sku))}
                  className="mt-1.5 text-xs font-medium text-burgundy underline-offset-4 hover:underline"
                >
                  توليد تلقائي من الاسم/SKU
                </button>
              )}
              {err('slug')}
            </div>
          </div>
        </section>

        <section className="rounded border border-taupe/70 bg-white p-5">
          <h3 className="font-display text-lg text-espresso">التسعير والتصنيف</h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="pf-price" className={labelCls}>السعر (ج.م) *</label>
              <input id="pf-price" inputMode="numeric" dir="ltr" value={fields.price} onChange={(e) => set('price', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.price)} />
              {err('price')}
            </div>
            <div>
              <label htmlFor="pf-compare" className={labelCls}>السعر قبل الخصم (اختياري)</label>
              <input id="pf-compare" inputMode="numeric" dir="ltr" value={fields.compareAt} onChange={(e) => set('compareAt', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.compareAt)} />
              {err('compareAt')}
            </div>
            <div>
              <label htmlFor="pf-cat" className={labelCls}>التصنيف *</label>
              <select id="pf-cat" value={fields.category} onChange={(e) => set('category', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.category)}>
                <option value="">— اختر —</option>
                {catalog.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name.ar}</option>
                ))}
              </select>
              {err('category')}
            </div>
            <div>
              <label htmlFor="pf-coll" className={labelCls}>المجموعة *</label>
              <select id="pf-coll" value={fields.collection} onChange={(e) => set('collection', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.collection)}>
                <option value="">— اختر —</option>
                {catalog.collections.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name.ar}</option>
                ))}
              </select>
              {err('collection')}
            </div>
          </div>
        </section>

        <section className="rounded border border-taupe/70 bg-white p-5">
          <h3 className="font-display text-lg text-espresso">الخيارات والحالة</h3>
          <div className="mt-4 grid gap-6 sm:grid-cols-3">
            {managerField('color')}
            {managerField('material')}
            {managerField('size')}
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <div>
              <label htmlFor="pf-size" className={labelCls}>المقاس الافتراضي</label>
              <select id="pf-size" value={fields.size} onChange={(e) => set('size', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.size)}>
                <option value="">— اختر —</option>
                {(attributeByKey('size')?.values ?? []).map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label.ar}
                    {!s.enabled ? ' (معطّلة)' : ''}
                  </option>
                ))}
              </select>
              {err('size')}
            </div>
            <div>
              <label htmlFor="pf-avail" className={labelCls}>حالة المخزون</label>
              <select id="pf-avail" value={fields.availability} onChange={(e) => set('availability', e.target.value as Availability)} className={inputCls}>
                <option value="in_stock">متوفر</option>
                <option value="low_stock">باقي قطع قليلة</option>
                <option value="out_of_stock">نفدت الكمية</option>
              </select>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ['published', 'منشور في المتجر'],
                ['featured', 'منتج مميز'],
                ['isNew', 'منتج جديد'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className={checkRow}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={fields[key]}
                  onChange={(e) => set(key, e.target.checked)}
                />
                <span className={checkBox(fields[key])} aria-hidden>
                  {fields[key] && (
                    <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                      <path d="M2 6.5 5 9l5-6" />
                    </svg>
                  )}
                </span>
                {label}
              </label>
            ))}
          </div>

          <VariantMatrixSection
            productId={existing?.id}
            sku={fields.sku}
            price={parsedPrice !== null && Number.isFinite(parsedPrice) ? parsedPrice : null}
            compareAtPrice={
              parsedCompareAt !== null && Number.isFinite(parsedCompareAt) ? parsedCompareAt : null
            }
            category={fields.category}
            axes={fields.variantAxes}
            axisValues={axisValues}
            variants={fields.variants}
            issues={variantIssues}
            error={errors.variants}
            onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
          />
        </section>

        <section className="rounded border border-taupe/70 bg-white p-5">
          <h3 className="font-display text-lg text-espresso">الصور</h3>
          <p className="mt-1 text-xs text-espresso/55">
            الصور تُختار من جهازك وتُحفظ محليًا في المتصفح (IndexedDB) — الروابط الخارجية الحالية تبقى تعمل.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <ImageUploadField
              id="pf-img"
              label="الصورة الأساسية"
              required
              value={fields.image}
              onChange={(v) => set('image', v)}
              error={errors.image}
            />
            <ImageUploadField
              id="pf-img-hover"
              label="صورة التمرير (اختياري)"
              value={fields.imageHover}
              onChange={(v) => set('imageHover', v)}
            />
          </div>
          <div className="mt-4">
            <span className={labelCls}>صور إضافية</span>
            <ul className="space-y-2">
              {fields.extraImages.map((url, i) => (
                <li key={i}>
                  <ImageUploadField
                    id={`pf-img-extra-${i}`}
                    label={`صورة إضافية ${i + 1}`}
                    compact
                    value={url}
                    onChange={(v) =>
                      set('extraImages', fields.extraImages.map((x, xi) => (xi === i ? v : x)))
                    }
                  />
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => set('extraImages', [...fields.extraImages, ''])}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-burgundy underline-offset-4 hover:underline"
            >
              <Plus className="size-3.5" aria-hidden /> إضافة صورة
            </button>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-burgundy px-8 py-2.5 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            {existing ? 'حفظ التعديلات' : 'إضافة المنتج'}
          </button>
          <Link
            to="/admin/products"
            className="text-sm font-medium text-espresso/60 transition hover:text-espresso"
          >
            إلغاء
          </Link>
        </div>
      </form>

      {managerAttr !== null && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            aria-label="إغلاق"
            onClick={() => setManagerAttr(null)}
            className="absolute inset-0 bg-espresso/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`إدارة ${ATTR_PLURAL[managerAttr]}`}
            className="relative w-full max-w-lg rounded border border-taupe bg-white p-6 shadow-xl"
          >
            <h3 className="font-display text-lg text-espresso">
              إدارة {ATTR_PLURAL[managerAttr]}
            </h3>
            <p className="mt-1 text-xs leading-5 text-espresso/55">
              علّم «للمنتج» لاختيار القيمة لهذا المنتج، عدّل الاسم أو التفعيل، أضف قيمة جديدة، أو احذف نهائيًا — «حفظ التعديلات» تطبّق الاختيار والتعديلات معًا، والحذف يسأل تأكيدًا أولًا.
            </p>
            <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pl-1">
              {(attributeByKey(managerAttr)?.values ?? []).map((v) => {
                const fieldKey = ATTR_FIELD[managerAttr];
                const d = valueDrafts[v.key] ?? {
                  selected: fields[fieldKey].includes(v.key),
                  labelAr: v.label.ar,
                  enabled: v.enabled,
                  hex: v.hex ?? '',
                };
                return (
                  <li
                    key={v.key}
                    className="flex items-center gap-3 rounded border border-taupe/60 bg-porcelain/40 px-3 py-2"
                  >
                    <label className={checkRow} title="اختيار القيمة لهذا المنتج">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={d.selected}
                        onChange={(e) =>
                          patchDraft(v.key, { selected: e.target.checked })
                        }
                      />
                      <span className={checkBox(d.selected)} aria-hidden>
                        {d.selected && (
                          <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                            <path d="M2 6.5 5 9l5-6" />
                          </svg>
                        )}
                      </span>
                      للمنتج
                    </label>
                    {managerAttr === 'color' && (
                      <input
                        type="color"
                        value={HEX_RE.test(d.hex) ? d.hex : '#000000'}
                        onChange={(e) =>
                          patchDraft(v.key, { hex: e.target.value })
                        }
                        className="size-8 shrink-0 cursor-pointer rounded border border-espresso/15 bg-white p-0.5"
                        aria-label={`لون ${v.label.ar}`}
                      />
                    )}
                    <input
                      value={d.labelAr}
                      onChange={(e) =>
                        patchDraft(v.key, { labelAr: e.target.value })
                      }
                      className={`${inputCls} flex-1 px-2.5 py-1.5`}
                      aria-label={`تسمية ${v.label.ar}`}
                    />
                    <label className={checkRow}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={d.enabled}
                        onChange={(e) =>
                          patchDraft(v.key, { enabled: e.target.checked })
                        }
                      />
                      <span className={checkBox(d.enabled)} aria-hidden>
                        {d.enabled && (
                          <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                            <path d="M2 6.5 5 9l5-6" />
                          </svg>
                        )}
                      </span>
                      مفعّلة
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDelValue({ attrKey: managerAttr, valueKey: v.key })
                      }
                      aria-label={`حذف ${v.label.ar}`}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-espresso/50 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>

            {managerAttr === 'size' && (
              <div className="mt-4">
                <label htmlFor="pm-size-default" className={labelCls}>
                  المقاس الافتراضي للمنتج
                </label>
                <select
                  id="pm-size-default"
                  value={defaultDraft}
                  onChange={(e) => setDefaultDraft(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— اختر —</option>
                  {(attributeByKey('size')?.values ?? [])
                    .filter(
                      (v) =>
                        valueDrafts[v.key]?.selected ??
                        fields.sizes.includes(v.key),
                    )
                    .map((v) => (
                      <option key={v.key} value={v.key}>
                        {valueDrafts[v.key]?.labelAr.trim() || v.label.ar}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-[11px] text-espresso/50">
                  الاختيار المبدئي اللي يظهر للعميل في صفحة المنتج — من المقاسات المتعلّمة «للمنتج» فقط.
                </p>
              </div>
            )}

            <div className="mt-4 rounded border border-dashed border-taupe/70 p-3">
              <span className={labelCls}>
                {managerAttr === 'size'
                  ? 'أضف مقاسًا جديدًا (عرض × طول بالسنتيمتر)'
                  : managerAttr === 'color'
                    ? 'أضف لونًا جديدًا'
                    : 'أضف خامة جديدة'}
              </span>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                {managerAttr === 'size' ? (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="العرض"
                      value={newW}
                      onChange={(e) => setNewW(e.target.value)}
                      className={`${inputCls} w-24`}
                      aria-label="العرض (سم)"
                    />
                    <span className="pb-2.5 text-espresso/50">×</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="الطول"
                      value={newL}
                      onChange={(e) => setNewL(e.target.value)}
                      className={`${inputCls} w-24`}
                      aria-label="الطول (سم)"
                    />
                  </>
                ) : (
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={
                      managerAttr === 'color' ? 'اسم اللون بالعربي' : 'اسم الخامة بالعربي'
                    }
                    className={`${inputCls} w-44`}
                    aria-label="اسم القيمة بالعربي"
                  />
                )}
                {managerAttr === 'color' && (
                  <input
                    type="color"
                    value={newHex}
                    onChange={(e) => setNewHex(e.target.value)}
                    className="size-9 cursor-pointer rounded border border-espresso/15 bg-white p-0.5"
                    aria-label="اختيار اللون"
                  />
                )}
                <button
                  type="button"
                  onClick={addManagerValue}
                  className="inline-flex items-center gap-1.5 rounded border border-espresso/25 px-3 py-2 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <Plus className="size-3.5" aria-hidden /> إضافة
                </button>
              </div>
              {managerError && (
                <p className="mt-1.5 text-xs text-burgundy">{managerError}</p>
              )}
              {managerAttr === 'size' && (
                <p className="mt-1.5 text-[11px] text-espresso/50">
                  مثال: اكتب 280 و200 لإضافة مقاس «280 × 200 سم» — يُضاف للقائمة ويُحدَّد للمنتج تلقائيًا.
                </p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setManagerAttr(null)}
                className="rounded border border-espresso/25 px-5 py-2 text-sm font-medium text-espresso transition hover:border-espresso focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={saveManager}
                className="rounded bg-burgundy px-5 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                حفظ التعديلات
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={delValue !== null}
        title={
          delValue
            ? delReferenced
              ? `حذف ${ATTR_SINGULAR[delValue.attrKey]} المستخدم؟`
              : `حذف ${ATTR_SINGULAR[delValue.attrKey]}`
            : ''
        }
        body={
          delTarget && delValue !== null
            ? delReferenced
              ? `«${delTarget.label.ar}» مستخدمة في: ${delRefs.join('، ')}. حذفها سيُزيلها من اختيارات تلك المنتجات، وستتوقف التنويعات المعتمدة عليها، وستعرض الطلبات والسلة المفتاح التقني بدل التسمية — لا يمكن التراجع.`
              : `حذف «${delTarget.label.ar}» نهائيًا؟${fields[ATTR_FIELD[delValue.attrKey]].includes(delValue.valueKey) ? ' ستُزال من اختيارات هذا المنتج أيضًا —' : ''} لا يمكن التراجع.`
            : ''
        }
        confirmLabel={
          delReferenced
            ? 'حذف على أي حال'
            : delValue
              ? `حذف ${ATTR_SINGULAR[delValue.attrKey]}`
              : undefined
        }
        onConfirm={confirmDeleteValue}
        onCancel={() => setDelValue(null)}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 start-1/2 z-80 -translate-x-1/2 rounded border border-espresso/20 bg-espresso px-5 py-3 shadow-xl"
        >
          <span className="inline-flex items-center gap-2 text-sm font-medium text-porcelain">
            <Check className="size-4 text-gold" aria-hidden /> {toast}
          </span>
        </div>
      )}
    </div>
  );
}
