<script setup lang="ts">
import type { OrderStatus } from '~~/shared/types/directus'
import type { ExpandedOrder } from '~/composables/useShop'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'My account — Ember & Oak' })

const { profile, signOut } = useProfile()
const img = useAssetUrl()

const { data: ordersData, pending } = await useFetch<ExpandedOrder[]>('/api/account/orders')
const orders = computed(() => ordersData.value ?? [])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

const STATUS_CLASS: Record<OrderStatus, string> = {
  open: 'bg-status-open-bg text-status-open-text',
  marked: 'bg-status-marked-bg text-status-marked-text',
  canceled: 'bg-status-canceled-bg text-status-canceled-text',
}
</script>

<template>
  <div class="mx-auto w-full max-w-[860px] px-5 py-12 md:py-16">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="mono-label text-[10px] font-medium text-muted">MY ACCOUNT</p>
        <h1 class="mt-2 font-display text-[30px] md:text-[34px] font-semibold">
          {{ profile?.email }}
        </h1>
      </div>
      <button class="btn-ghost-light" @click="signOut">Sign out</button>
    </div>

    <h2 class="mt-10 font-display text-[22px] font-semibold">Your orders</h2>

    <p v-if="pending" class="mt-6 text-[15px] text-muted">Loading your orders…</p>

    <div v-else-if="orders.length === 0" class="card mt-5 px-6 py-10 text-center">
      <p class="text-[15px] text-muted">No orders yet.</p>
      <NuxtLink to="/shop" class="btn-primary mt-5">Browse the shop</NuxtLink>
    </div>

    <div v-else class="mt-5 space-y-4">
      <article v-for="order in orders" :key="order.id" class="card p-5 md:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="mono-label text-[11px] font-medium">{{ order.order_number }}</p>
            <p class="mt-1 text-[13px] text-muted">{{ fmtDate(order.date_created) }}</p>
          </div>
          <span
            class="rounded-full px-3 py-1 text-[12px] font-semibold"
            :class="STATUS_CLASS[order.status]"
          >
            {{ customerOrderStatus(order.status) }}
          </span>
        </div>

        <ul class="mt-4 space-y-2.5 border-t border-line pt-4">
          <li
            v-for="item in order.items"
            :key="item.id"
            class="flex items-center gap-3.5 text-[14px]"
          >
            <!-- product is a live relation — absent once the product is deleted,
                 so the line quietly falls back to text only -->
            <NuxtLink
              v-if="item.product?.slug"
              :to="`/products/${item.product.slug}`"
              class="h-[46px] w-[46px] shrink-0 overflow-hidden rounded-lg bg-cream-alt"
            >
              <img
                v-if="item.product.image"
                :src="img(item.product.image, THUMB) ?? undefined"
                :alt="item.product_name"
                class="h-full w-full object-cover"
              >
            </NuxtLink>
            <span class="grow">
              {{ item.quantity }} ×
              <NuxtLink
                v-if="item.product?.slug"
                :to="`/products/${item.product.slug}`"
                class="transition-colors hover:text-terra"
              >{{ item.product_name }}</NuxtLink>
              <template v-else>{{ item.product_name }}</template>
            </span>
            <span class="shrink-0 text-muted">{{ fmtPrice(item.quantity * item.unit_price_cents) }}</span>
          </li>
        </ul>

        <!-- shipped orders get an arrival estimate, counted from when it was marked -->
        <p v-if="order.status === 'marked'" class="mt-4 text-[13px] text-status-marked-text">
          Estimated delivery {{ deliveryWindow(order.date_updated) }}
        </p>

        <div class="mt-4 flex justify-between border-t border-line pt-3.5 text-[15px] font-semibold">
          <span>Total</span>
          <span>{{ fmtPrice(order.total_cents) }}</span>
        </div>
      </article>
    </div>
  </div>
</template>
