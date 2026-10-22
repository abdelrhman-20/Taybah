import {
  ORDER_STATUS_LABELS_AR,
  type OrderStatus,
} from '../../storefront/checkout/orderStore';

const styles: Record<OrderStatus, string> = {
  pending: 'border-espresso/25 bg-espresso/5 text-espresso',
  confirmed: 'border-gold/50 bg-gold/10 text-espresso',
  processing: 'border-espresso/30 bg-espresso/10 text-espresso',
  shipped: 'border-espresso/40 bg-espresso/15 text-espresso',
  delivered: 'border-burgundy/40 bg-burgundy/10 text-burgundy',
  cancelled: 'border-burgundy bg-burgundy text-white',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${styles[status]}`}
    >
      {ORDER_STATUS_LABELS_AR[status]}
    </span>
  );
}
