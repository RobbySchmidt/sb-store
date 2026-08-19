<script setup lang="ts">
import type { ExpandedOrder, ExpandedOrderItem } from '~/composables/useShop'

const props = defineProps<{ order: ExpandedOrder; busy?: boolean; error?: string | null }>()

const emit = defineEmits<{
  confirm: [lines: Array<{ itemId: string; quantity: number }>]
  close: []
}>()

// The dialog owns nothing but its own draft — the order is never mutated here.
const qty = reactive<Record<string, number>>({})
for (const i of props.order.items) qty[i.id] = 0

function remaining(item: ExpandedOrderItem): number {
  return item.quantity - (item.refunded_quantity ?? 0)
}

/** Clamp on input so the confirm button can never propose an over-refund. */
function clamp(item: ExpandedOrderItem) {
  const max = remaining(item)
  const v = Math.floor(Number(qty[item.id]) || 0)
  qty[item.id] = Math.min(Math.max(v, 0), max)
}

const amount = computed(() =>
  props.order.items.reduce((n, i) => n + i.unit_price_cents * (qty[i.id] ?? 0), 0))

/** True when the selection covers every line still refundable. */
const coversEverything = computed(() =>
  amount.value > 0 && props.order.items.every(i => (qty[i.id] ?? 0) >= remaining(i)))

const shortNo = computed(() => {
  const n = props.order.order_number
  return '#' + (n.split('-').pop() ?? n)
})

function confirm() {
  if (amount.value <= 0 || props.busy) return
  emit('confirm', props.order.items
    .filter(i => (qty[i.id] ?? 0) > 0)
    .map(i => ({ itemId: i.id, quantity: qty[i.id]! })))
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

const panel = ref<HTMLElement | null>(null)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
  panel.value?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" appear>
      <div class="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-5">
        <!-- backdrop -->
        <div class="absolute inset-0 bg-espresso/40" @click="emit('close')" />

        <!-- panel -->
        <div
          ref="panel"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          aria-labelledby="refund-dialog-title"
          class="dialog-panel card relative max-h-full w-full sm:max-w-[520px] overflow-y-auto rounded-b-none sm:rounded-b-card p-6 outline-none"
          style="box-shadow: 0 26px 56px rgba(46, 33, 26, .28)"
        >
          <h2 id="refund-dialog-title" class="font-display text-[22px] font-semibold leading-snug">
            Refund items from {{ shortNo }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-muted">
            {{ order.customer_name }} gets an email about this. Refunded items go
            straight back on sale — shipping is only returned when you cancel the
            whole order.
          </p>

          <div class="mt-5 divide-y divide-line">
            <div v-for="item in order.items" :key="item.id" class="flex items-center gap-4 py-3">
              <div class="grow">
                <p class="text-sm font-medium">{{ item.product_name }}</p>
                <p class="mt-0.5 text-[12px] text-muted">
                  {{ fmtPrice(item.unit_price_cents) }} each ·
                  {{ remaining(item) }} of {{ item.quantity }} still refundable
                </p>
              </div>
              <input
                v-model.number="qty[item.id]"
                type="number"
                min="0"
                :max="remaining(item)"
                :disabled="remaining(item) === 0 || busy"
                class="h-[42px] w-[72px] shrink-0 rounded-[10px] border border-line bg-cream px-3 text-center text-[15px] outline-none transition-colors focus:border-terra disabled:opacity-40"
                @input="clamp(item)"
              >
            </div>
          </div>

          <p
            v-if="coversEverything"
            class="mt-4 rounded-[10px] bg-cream px-4 py-3 text-[13px] leading-relaxed text-muted"
          >
            That's every remaining item. Cancelling the order instead would also
            return the {{ fmtPrice(order.shipping_cents) }} shipping.
          </p>

          <p
            v-if="error"
            class="mt-4 rounded-[10px] bg-status-canceled-bg px-4 py-3 text-[13px] text-status-canceled-text"
          >
            {{ error }}
          </p>

          <div class="mt-6 flex items-center justify-between gap-4">
            <button
              type="button"
              class="text-sm font-medium text-muted transition-colors hover:text-espresso"
              @click="emit('close')"
            >
              Never mind
            </button>
            <button
              type="button"
              class="inline-flex h-11 items-center justify-center rounded-full bg-terra px-6 text-sm font-semibold text-white transition-colors hover:bg-terra-dark disabled:opacity-50"
              :disabled="busy || amount <= 0"
              @click="confirm"
            >
              {{ busy ? 'Refunding…' : `Refund ${fmtPrice(amount)}` }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* entry only — the parent drops the component with v-if, so there is no leave phase */
.dialog-enter-active { transition: opacity 0.2s ease-out; }
.dialog-enter-active .dialog-panel { transition: transform 0.2s ease-out; }
.dialog-enter-from { opacity: 0; }
.dialog-enter-from .dialog-panel { transform: translateY(12px); }

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active .dialog-panel { transition: none; }
  .dialog-enter-from .dialog-panel { transform: none; }
}
</style>
