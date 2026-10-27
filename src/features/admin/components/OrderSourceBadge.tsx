import {
  ORDER_SOURCE_LABELS_AR,
  type OrderSource,
} from '../../storefront/checkout/orderStore';

const styles: Record<OrderSource, string> = {
  online: 'border-taupe bg-white text-espresso/70',
  in_store: 'border-gold/60 bg-gold/10 text-espresso',
};

export function OrderSourceBadge({ source }: { source: OrderSource }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${styles[source]}`}
    >
      {ORDER_SOURCE_LABELS_AR[source]}
    </span>
  );
}
