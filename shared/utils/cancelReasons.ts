export interface CancelReason {
  /** stored in orders.cancel_reason */
  key: string
  /** shown in the admin dashboard */
  label: string
  /** shown to the customer in the cancellation email; empty for 'other' */
  sentence: string
}

export const CANCEL_REASONS: readonly CancelReason[] = [
  {
    key: 'out_of_stock',
    label: 'Out of stock',
    sentence: 'The coffee in your order sold out before we could roast this batch.',
  },
  {
    key: 'customer_request',
    label: 'Customer requested',
    sentence: 'You asked us to cancel this order.',
  },
  {
    key: 'payment_problem',
    label: 'Payment problem',
    sentence: 'We could not process the payment for this order.',
  },
  {
    key: 'payment_expired',
    label: 'Checkout expired',
    sentence: '',
  },
  {
    key: 'address_problem',
    label: 'Address problem',
    sentence: 'We could not ship to the address on the order.',
  },
  {
    key: 'other',
    label: 'Other',
    sentence: '',
  },
]

export function findCancelReason(key?: string | null): CancelReason | undefined {
  return CANCEL_REASONS.find(r => r.key === key)
}

export function isCancelReasonKey(value: unknown): boolean {
  return typeof value === 'string' && CANCEL_REASONS.some(r => r.key === value)
}
