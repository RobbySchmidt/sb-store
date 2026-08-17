<script setup lang="ts">
import type { Order, OrderStatus } from '~/types/shop'

definePageMeta({ layout: false })

// deep: true — Nuxt 4 defaults useFetch data to a shallowRef, which would not
// react to the optimistic `order.status = …` mutation in setStatus() below
const { data: ordersData, refresh } = await useFetch<Order[]>('/api/admin/orders', { deep: true })
const orders = computed(() => ordersData.value ?? [])

const statusFilter = ref<'all' | OrderStatus>('all')
const query = ref('')
const expandedId = ref<string | null>(null)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortNo(order: Order) {
  return '#' + (order.order_number.split('-').pop() ?? order.order_number)
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
function itemsCount(order: Order) {
  return order.order_items.reduce((n, i) => n + i.quantity, 0)
}

// ---- header stats ----
const now = new Date()
const weekAgo = new Date(now.getTime() - 7 * 86400000)
const thisWeek = computed(() => orders.value.filter(o => new Date(o.created_at) >= weekAgo))
const openCount = computed(() => orders.value.filter(o => o.status === 'open').length)
const weekRevenue = computed(() =>
  thisWeek.value.filter(o => o.status !== 'canceled').reduce((n, o) => n + o.total_cents, 0))
const bagsToRoast = computed(() =>
  orders.value.filter(o => o.status === 'open')
    .reduce((n, o) => n + itemsCount(o), 0))
const todayLabel = `${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]!.toUpperCase()} ${now.getFullYear()}`

// ---- filters ----
const statusCounts = computed(() => ({
  all: orders.value.length,
  open: orders.value.filter(o => o.status === 'open').length,
  marked: orders.value.filter(o => o.status === 'marked').length,
  canceled: orders.value.filter(o => o.status === 'canceled').length,
}))

const filtered = computed(() => {
  let list = orders.value
  if (statusFilter.value !== 'all') list = list.filter(o => o.status === statusFilter.value)
  const q = query.value.trim().toLowerCase()
  if (q) {
    list = list.filter(o =>
      o.customer_name.toLowerCase().includes(q) ||
      o.email.toLowerCase().includes(q) ||
      o.order_number.toLowerCase().includes(q))
  }
  return list
})

// ---- status change (optimistic) ----
const saving = ref<string | null>(null)
async function setStatus(
  order: Order,
  status: OrderStatus,
  extra?: { reason: string | null; note: string | null },
) {
  if (order.status === status || saving.value) return
  const prev = { status: order.status, reason: order.cancel_reason, note: order.cancel_note }

  // the reason columns belong to a cancellation — any other status clears them, like the server does
  const reason = status === 'canceled' ? extra?.reason ?? null : null
  const note = status === 'canceled' ? extra?.note ?? null : null

  order.status = status
  order.cancel_reason = reason
  order.cancel_note = note
  saving.value = order.id
  try {
    await $fetch(`/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      body: extra ? { status, reason, note } : { status },
    })
  } catch {
    order.status = prev.status
    order.cancel_reason = prev.reason
    order.cancel_note = prev.note
    await refresh()
  } finally {
    saving.value = null
  }
}

// ---- cancellation dialog ----
// shallowRef: the entry already is the reactive order object from `orders`
const cancelTarget = shallowRef<Order | null>(null)

function pickStatus(order: Order, status: OrderStatus) {
  if (status !== 'canceled') return setStatus(order, status)
  // canceling asks for a reason first — nothing is touched until the dialog confirms
  if (order.status === 'canceled' || saving.value) return
  cancelTarget.value = order
}

function confirmCancel(payload: { reason: string | null; note: string | null }) {
  const order = cancelTarget.value
  cancelTarget.value = null
  if (order) setStatus(order, 'canceled', payload)
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

const badgeStyles: Record<OrderStatus, { bg: string; text: string; dot: string; label: string }> = {
  open: { bg: 'bg-status-open-bg', text: 'text-status-open-text', dot: 'bg-status-open', label: 'Open' },
  marked: { bg: 'bg-status-marked-bg', text: 'text-status-marked-text', dot: 'bg-status-marked', label: 'Marked' },
  canceled: { bg: 'bg-status-canceled-bg', text: 'text-status-canceled-text', dot: 'bg-status-canceled', label: 'Canceled' },
}

const segmentFill: Record<OrderStatus, string> = {
  open: 'bg-status-open text-white',
  marked: 'bg-status-marked text-white',
  canceled: 'bg-status-canceled text-white',
}

const pillCountColor: Record<OrderStatus, string> = {
  open: 'text-status-open',
  marked: 'text-status-marked',
  canceled: 'text-status-canceled',
}

useHead({ title: 'Orders — Ember & Oak Admin' })
</script>

<template>
  <div class="min-h-screen bg-admin pb-16">
    <!-- ===== dark topbar + counters ===== -->
    <section class="relative overflow-hidden bg-espresso pb-[72px] text-cream">
      <span class="ember-glow -right-52 -top-72 h-[700px] w-[700px]" />

      <div class="relative mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 md:px-6 lg:px-14 pt-5">
        <div class="flex items-center gap-3">
          <NuxtLink to="/" class="flex items-center gap-2.5">
            <span class="h-2.5 w-2.5 rounded-full bg-terra" />
            <span class="font-display text-[19px] font-semibold text-cream">Ember &amp; Oak</span>
          </NuxtLink>
          <span class="text-[#EFE4D8]/40">/</span>
          <span class="text-sm font-medium text-[#EFE4D8]/85">Orders</span>
          <span class="mono-label rounded-full border border-[#EFE4D8]/32 px-2.5 py-1 text-[9px] font-semibold text-[#EFE4D8]/70">INTERNAL</span>
        </div>
        <p class="mono-label text-[10px] text-[#EFE4D8]/55">
          {{ todayLabel }} · {{ thisWeek.length }} ORDERS THIS WEEK
        </p>
      </div>

      <div class="relative mx-auto grid max-w-[1440px] grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-5 px-5 md:px-6 lg:px-14 pt-8">
        <div>
          <p class="font-display text-[24px] lg:text-[28px] font-semibold text-cream">{{ thisWeek.length }}</p>
          <p class="mono-label mt-0.5 text-[10px] text-[#EFE4D8]/55">ORDERS THIS WEEK</p>
        </div>
        <div>
          <p class="font-display text-[24px] lg:text-[28px] font-semibold text-cream">{{ openCount }}</p>
          <p class="mono-label mt-0.5 text-[10px] text-[#EFE4D8]/55">OPEN</p>
        </div>
        <div>
          <p class="font-display text-[24px] lg:text-[28px] font-semibold text-cream">{{ fmtPrice(weekRevenue) }}</p>
          <p class="mono-label mt-0.5 text-[10px] text-[#EFE4D8]/55">WEEK REVENUE</p>
        </div>
        <div>
          <p class="font-display text-[24px] lg:text-[28px] font-semibold text-cream">{{ bagsToRoast }}</p>
          <p class="mono-label mt-0.5 text-[10px] text-[#EFE4D8]/55">BAGS TO ROAST</p>
        </div>
      </div>
    </section>

    <div class="relative mx-auto -mt-8 max-w-[1440px] px-5 md:px-6 lg:px-14">
      <!-- ===== toolbar ===== -->
      <div class="card flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-5 py-4" style="box-shadow: 0 14px 34px rgba(46,33,26,.12)">
        <!-- search first on tablet/mobile -->
        <div class="relative order-first lg:order-last lg:w-[330px]">
          <Icon name="Search" :size="16" class="absolute left-4 top-1/2 -translate-y-1/2 text-muted" :stroke-width="2" />
          <input
            v-model="query"
            placeholder="Search customer or order №…"
            class="h-11 w-full rounded-full border border-line bg-cream pl-11 pr-5 text-sm outline-none transition-colors focus:border-terra"
          >
        </div>

        <div class="flex gap-2 overflow-x-auto pb-1 lg:pb-0 -mx-1 px-1">
          <button
            class="flex min-h-11 lg:min-h-0 shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors"
            :class="statusFilter === 'all' ? 'bg-espresso text-cream' : 'border border-line hover:border-terra hover:text-terra'"
            @click="statusFilter = 'all'"
          >
            All <span :class="statusFilter === 'all' ? 'text-cream/70' : 'text-muted'">{{ statusCounts.all }}</span>
          </button>
          <button
            v-for="s in (['open', 'marked', 'canceled'] as const)"
            :key="s"
            class="flex min-h-11 lg:min-h-0 shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors"
            :class="statusFilter === s ? 'bg-espresso text-cream' : 'border border-line hover:border-terra'"
            @click="statusFilter = s"
          >
            {{ badgeStyles[s].label }}
            <span :class="statusFilter === s ? 'text-cream/70' : pillCountColor[s]">{{ statusCounts[s] }}</span>
          </button>
        </div>
      </div>

      <!-- ===== desktop table ===== -->
      <div class="card mt-5 hidden lg:block overflow-hidden">
        <div class="mono-label grid grid-cols-[130px_92px_1.2fr_1.5fr_64px_90px_118px_220px] gap-4 bg-cream px-5 py-3.5 text-[10px] font-semibold text-muted">
          <span>ORDER</span><span>DATE</span><span>CUSTOMER</span><span>EMAIL</span>
          <span class="text-right">ITEMS</span><span class="text-right">TOTAL</span><span>STATUS</span><span>SET STATUS</span>
        </div>

        <template v-for="order in filtered" :key="order.id">
          <div
            class="grid cursor-pointer grid-cols-[130px_92px_1.2fr_1.5fr_64px_90px_118px_220px] items-center gap-4 border-t border-[#F0EAE0] px-5 py-3.5 transition-colors hover:bg-[#FDFBF7]"
            @click="toggleExpand(order.id)"
          >
            <span class="flex items-center gap-2 font-mono text-[13px] font-semibold">
              <Icon name="ChevronRight" :size="13" :stroke-width="2.5" class="text-muted transition-transform" :class="expandedId === order.id ? 'rotate-90' : ''" />
              {{ shortNo(order) }}
            </span>
            <span class="text-[13px] text-muted">{{ fmtDate(order.created_at) }}</span>
            <span class="truncate text-sm font-medium">{{ order.customer_name }}</span>
            <span class="truncate text-[13px] text-muted">{{ order.email }}</span>
            <span class="text-right text-[13px]">{{ itemsCount(order) }}</span>
            <span class="text-right text-sm font-semibold">{{ fmtPrice(order.total_cents) }}</span>
            <span>
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" :class="[badgeStyles[order.status].bg, badgeStyles[order.status].text]">
                <span class="h-[7px] w-[7px] rounded-full" :class="badgeStyles[order.status].dot" />
                {{ badgeStyles[order.status].label }}
              </span>
            </span>
            <span class="flex rounded-full border border-line bg-white p-0.5" @click.stop>
              <button
                v-for="s in (['open', 'marked', 'canceled'] as const)"
                :key="s"
                class="grow rounded-full px-2 py-1.5 text-xs font-medium transition-colors"
                :class="order.status === s ? segmentFill[s] : 'text-muted hover:text-espresso'"
                @click="pickStatus(order, s)"
              >
                {{ s === 'canceled' ? 'Cancel' : badgeStyles[s].label }}
              </button>
            </span>
          </div>

          <!-- expanded -->
          <div v-if="expandedId === order.id" class="border-t border-[#F0EAE0] bg-[#FDFBF7] py-5 pl-[56px] pr-5">
            <div class="grid grid-cols-2 gap-4">
              <div class="rounded-xl bg-cream p-5">
                <p class="mono-label text-[10px] font-semibold text-muted">LINE ITEMS</p>
                <div class="mt-3 space-y-2">
                  <div v-for="(item, i) in order.order_items" :key="i" class="flex justify-between text-[13px]">
                    <span>{{ item.product_name }} × {{ item.quantity }}</span>
                    <span class="font-medium">{{ fmtPrice(item.unit_price_cents * item.quantity) }}</span>
                  </div>
                  <div class="flex justify-between border-t border-line pt-2 text-[13px]">
                    <span>Shipping</span>
                    <span :class="order.shipping_cents === 0 ? 'font-medium text-status-marked-text' : 'font-medium'">
                      {{ order.shipping_cents === 0 ? 'Free' : fmtPrice(order.shipping_cents) }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="rounded-xl bg-cream p-5">
                <p class="mono-label text-[10px] font-semibold text-muted">SHIPPING ADDRESS</p>
                <p class="mt-3 text-[13px] leading-relaxed">
                  {{ order.customer_name }}<br>
                  {{ order.street }}<br>
                  {{ order.zip }} {{ order.city }}, {{ order.country }}
                </p>
              </div>
              <div
                v-if="order.status === 'canceled' && (order.cancel_reason || order.cancel_note)"
                class="col-span-2 rounded-xl bg-cream p-5"
              >
                <p class="mono-label text-[10px] font-semibold text-muted">CANCELED BECAUSE</p>
                <p v-if="findCancelReason(order.cancel_reason)" class="mt-3 text-[13px] font-medium text-status-canceled-text">
                  {{ findCancelReason(order.cancel_reason)?.label }}
                </p>
                <p v-if="order.cancel_note" class="mt-2 text-[13px] leading-relaxed text-muted">
                  {{ order.cancel_note }}
                </p>
              </div>
            </div>
          </div>
        </template>

        <div v-if="filtered.length === 0" class="border-t border-[#F0EAE0] px-5 py-12 text-center text-sm text-muted">
          No orders match your filters.
        </div>

        <div class="flex items-center justify-between border-t border-[#F0EAE0] bg-cream px-5 py-3.5">
          <p class="mono-label text-[10px] font-semibold text-muted">
            SHOWING {{ filtered.length }} OF {{ orders.length }} ORDERS
          </p>
          <div class="flex gap-2">
            <button class="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted opacity-50" disabled>
              <Icon name="ChevronLeft" :size="14" :stroke-width="2" />
            </button>
            <button class="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted opacity-50" disabled>
              <Icon name="ChevronRight" :size="14" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>

      <!-- ===== tablet/mobile cards ===== -->
      <div class="mt-5 grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4">
        <div v-for="order in filtered" :key="order.id" class="card p-5">
          <button class="flex w-full items-center justify-between" @click="toggleExpand(order.id)">
            <span class="font-mono text-[14px] font-semibold">{{ shortNo(order) }}</span>
            <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" :class="[badgeStyles[order.status].bg, badgeStyles[order.status].text]">
              <span class="h-[7px] w-[7px] rounded-full" :class="badgeStyles[order.status].dot" />
              {{ badgeStyles[order.status].label }}
            </span>
          </button>
          <p class="mt-3 text-sm font-medium">{{ order.customer_name }}</p>
          <p class="text-[13px] text-muted">{{ order.email }}</p>
          <div class="mt-2 flex items-center justify-between text-[13px] text-muted">
            <span>{{ fmtDate(order.created_at) }} · {{ itemsCount(order) }} {{ itemsCount(order) === 1 ? 'item' : 'items' }}</span>
            <span class="text-[15px] font-semibold text-espresso">{{ fmtPrice(order.total_cents) }}</span>
          </div>

          <div v-if="expandedId === order.id" class="mt-4 rounded-xl bg-cream p-4">
            <p class="mono-label text-[10px] font-semibold text-muted">LINE ITEMS</p>
            <div class="mt-2.5 space-y-1.5">
              <div v-for="(item, i) in order.order_items" :key="i" class="flex justify-between text-[13px]">
                <span>{{ item.product_name }} × {{ item.quantity }}</span>
                <span class="font-medium">{{ fmtPrice(item.unit_price_cents * item.quantity) }}</span>
              </div>
            </div>
            <p class="mono-label mt-4 text-[10px] font-semibold text-muted">SHIPS TO</p>
            <p class="mt-2 text-[13px] leading-relaxed">
              {{ order.customer_name }}, {{ order.street }}, {{ order.zip }} {{ order.city }}
            </p>
            <template v-if="order.status === 'canceled' && (order.cancel_reason || order.cancel_note)">
              <p class="mono-label mt-4 text-[10px] font-semibold text-muted">CANCELED BECAUSE</p>
              <p v-if="findCancelReason(order.cancel_reason)" class="mt-2 text-[13px] font-medium text-status-canceled-text">
                {{ findCancelReason(order.cancel_reason)?.label }}
              </p>
              <p v-if="order.cancel_note" class="mt-1.5 text-[13px] leading-relaxed text-muted">
                {{ order.cancel_note }}
              </p>
            </template>
          </div>

          <div class="mt-4 flex rounded-full border border-line bg-white p-0.5">
            <button
              v-for="s in (['open', 'marked', 'canceled'] as const)"
              :key="s"
              class="min-h-11 grow rounded-full px-2 text-[13px] font-medium transition-colors"
              :class="order.status === s ? segmentFill[s] : 'text-muted'"
              @click="pickStatus(order, s)"
            >
              {{ s === 'canceled' ? 'Cancel' : badgeStyles[s].label }}
            </button>
          </div>
        </div>

        <div v-if="filtered.length === 0" class="card col-span-full px-5 py-12 text-center text-sm text-muted">
          No orders match your filters.
        </div>
      </div>
    </div>

    <CancelDialog
      v-if="cancelTarget"
      :order="cancelTarget"
      @close="cancelTarget = null"
      @confirm="confirmCancel"
    />
  </div>
</template>
