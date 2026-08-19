<script setup lang="ts">
definePageMeta({ layout: false })

const cart = useCartStore()
const route = useRoute()
const batch = batchInfo()
const img = useAssetUrl()

const sessionId = computed(() => String(route.query.session_id ?? ''))

// Fetched from the server, not read out of the store: sessionStorage would
// survive the round trip to Stripe but cannot answer the only question this
// page needs answered — did the payment actually succeed?
const { data: order, refresh, pending: reloading } = await useFetch('/api/orders/by-session', {
  // the computed goes in by reference — passing `.value` would freeze the query
  // at its SSR value and let the client disagree with the server
  query: { session_id: sessionId },
  immediate: !!sessionId.value,
})

const paid = computed(() => order.value?.payment_status === 'paid')
// Paid, but cancelled before the money landed: an admin cancelled the pending
// order while the buyer was still on Stripe's page. markPaid() deliberately
// suppresses the confirmation mail for exactly this case — the stock is already
// back on sale for somebody else — so the page must not undo that by saying
// "thank you".
const unfulfillable = computed(() => paid.value && order.value?.status === 'canceled')
const confirmed = computed(() => paid.value && !unfulfillable.value)
/** Checkout ran out of time — unlike `pending`, refreshing will never help. */
const expired = computed(() => order.value?.payment_status === 'expired')

// Cleared HERE, not at checkout: backing out of Stripe must leave the cart
// intact, so it only goes once the money is confirmed *and* the order stands.
//
// A watcher rather than a one-shot in onMounted, because "confirmed" is not
// necessarily true when the page first paints. If the webhook is a few seconds
// behind, the buyer lands on the pending variant and clicks "Check again" —
// refresh() swaps in the paid order and the template re-renders into the
// thank-you state, but an onMounted body would never run a second time. They
// would be looking at a completed purchase with their items still in the cart.
watch(confirmed, (v) => { if (v) cart.clear() }, { immediate: true })

onMounted(() => {
  if (!sessionId.value || !order.value) navigateTo('/')
})

const firstName = computed(() => order.value?.customer_name?.split(' ')[0] ?? '')

useHead({ title: 'Order confirmed — Ember & Oak' })
</script>

<template>
  <div v-if="order" class="min-h-screen bg-cream pb-16">
    <!-- ===== dark band ===== -->
    <section class="relative overflow-hidden bg-espresso pb-[120px] text-center text-cream">
      <span class="ember-glow left-1/2 -top-72 h-[860px] w-[860px] -translate-x-1/2" />

      <div class="relative mx-auto max-w-[1440px] px-5 pt-6 lg:pt-8">
        <NuxtLink to="/" class="inline-flex items-center gap-2.5">
          <span class="h-2.5 w-2.5 rounded-full bg-terra" />
          <span class="font-display text-[19px] md:text-[21px] font-semibold text-cream">Ember &amp; Oak</span>
        </NuxtLink>
      </div>

      <div
        class="relative mx-auto mt-10 lg:mt-14 flex h-16 w-16 items-center justify-center rounded-full text-white"
        :class="confirmed ? 'bg-status-marked' : unfulfillable ? 'bg-status-canceled' : 'bg-terra'"
      >
        <Icon
          :name="confirmed ? 'Check' : unfulfillable ? 'RotateCcw' : 'Clock'"
          :size="30"
          :stroke-width="confirmed ? 3 : 2.4"
        />
      </div>

      <!-- paid, and the order still stands -->
      <template v-if="confirmed">
        <h1 class="relative mt-6 px-5 font-display text-[30px] md:text-[42px] lg:text-[52px] font-semibold tracking-[-0.02em]">
          Thank you<template v-if="firstName">, {{ firstName }}</template>!
        </h1>
        <p class="relative mx-auto mt-4 max-w-[52ch] px-5 text-[15px] leading-[1.7] text-[#EFE4D8]/72">
          Your order is in. We'll roast on {{ batch.nextRoastHuman }} and ship within
          48 hours — a confirmation is on its way to {{ order.email }}.
        </p>
      </template>

      <!-- paid, but the order was cancelled before the payment landed -->
      <template v-else-if="unfulfillable">
        <h1 class="relative mt-6 px-5 font-display text-[30px] md:text-[42px] lg:text-[52px] font-semibold tracking-[-0.02em]">
          We're sorry<template v-if="firstName">, {{ firstName }}</template>.
        </h1>
        <p class="relative mx-auto mt-4 max-w-[52ch] px-5 text-[15px] leading-[1.7] text-[#EFE4D8]/72">
          Your payment went through, but this order was cancelled before it reached
          us and we can no longer roast it. Nothing more is needed from you — we're
          arranging a full refund and will write to {{ order.email }} as soon as it
          is on its way.
        </p>
      </template>

      <!-- Stripe has not confirmed the payment to us yet -->
      <!-- Checkout timed out. Distinct from `pending` on purpose: telling
           somebody to "check again" on a session that can never clear is a
           small lie that wastes their afternoon. -->
      <template v-else-if="expired">
        <h1 class="relative mt-6 px-5 font-display text-[30px] md:text-[42px] lg:text-[52px] font-semibold tracking-[-0.02em]">
          This checkout expired.
        </h1>
        <p class="relative mx-auto mt-4 max-w-[52ch] px-5 text-[15px] leading-[1.7] text-[#EFE4D8]/72">
          The payment window closed before it was completed, so nothing was charged
          and the coffee went back on sale. Your basket is still where you left it —
          start again whenever you like.
        </p>
        <NuxtLink to="/cart" class="mono-label relative mt-6 inline-flex h-[42px] items-center gap-2 rounded-full border border-[#EFE4D8]/32 px-5 text-[11px] font-semibold tracking-[0.1em] text-cream transition-colors hover:border-[#EFE4D8]/60">
          BACK TO CART
        </NuxtLink>
      </template>

      <template v-else>
        <h1 class="relative mt-6 px-5 font-display text-[30px] md:text-[42px] lg:text-[52px] font-semibold tracking-[-0.02em]">
          Almost there<template v-if="firstName">, {{ firstName }}</template>.
        </h1>
        <p class="relative mx-auto mt-4 max-w-[52ch] px-5 text-[15px] leading-[1.7] text-[#EFE4D8]/72">
          We haven't had confirmation of your payment yet. This usually clears within
          a few seconds — check again in a moment. Your order is held either way, and
          you won't be charged twice.
        </p>
        <button
          class="mono-label relative mt-6 inline-flex h-[42px] items-center gap-2 rounded-full border border-[#EFE4D8]/32 px-5 text-[11px] font-semibold tracking-[0.1em] text-cream transition-colors hover:border-[#EFE4D8]/60 disabled:opacity-55"
          :disabled="reloading"
          @click="refresh()"
        >
          <Icon name="RefreshCw" :size="14" :stroke-width="2.4" :class="reloading ? 'animate-spin' : ''" />
          {{ reloading ? 'CHECKING…' : 'CHECK AGAIN' }}
        </button>
      </template>

      <p class="mono-label relative mx-auto mt-6 inline-block rounded-full border border-[#EFE4D8]/32 px-4 py-2 text-[11px] font-semibold tracking-[0.1em] text-cream">
        ORDER № {{ order.order_number }}
      </p>
    </section>

    <!-- ===== cards, overlapping ===== -->
    <div class="relative mx-auto -mt-[70px] grid max-w-[980px] grid-cols-1 md:grid-cols-[1.3fr_1fr] items-start gap-5 px-5 md:px-6">
      <!-- items -->
      <div class="card p-6 md:p-7" style="box-shadow: var(--shadow-card-ondark)">
        <h2 class="font-display text-[20px] font-semibold">Your items</h2>
        <div class="mt-4 divide-y divide-line">
          <div v-for="(item, i) in order.items" :key="i" class="flex items-center gap-4 py-3.5">
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
            <p class="grow text-sm font-medium">
              <NuxtLink
                v-if="item.product?.slug"
                :to="`/products/${item.product.slug}`"
                class="transition-colors hover:text-terra"
              >{{ item.product_name }}</NuxtLink>
              <span v-else>{{ item.product_name }}</span>
              × {{ item.quantity }}
            </p>
            <span class="text-sm font-semibold">{{ fmtPrice(item.unit_price_cents * item.quantity) }}</span>
          </div>
        </div>
        <div class="mt-2 flex items-center justify-between border-t border-line pt-4">
          <p class="text-sm font-medium text-muted">
            Total{{ order.shipping_cents === 0 ? ' (free shipping)' : ` (incl. ${fmtPrice(order.shipping_cents)} shipping)` }}
          </p>
          <span class="text-lg font-semibold">{{ fmtPrice(order.total_cents) }}</span>
        </div>
      </div>

      <!-- delivery info -->
      <div class="space-y-5">
        <div class="card p-6" style="box-shadow: var(--shadow-card-ondark)">
          <p class="mono-label text-[10px] font-semibold text-muted">DELIVERS TO</p>
          <p class="mt-3 text-sm leading-relaxed">
            {{ order.customer_name }}<br>
            {{ order.street }}<br>
            {{ order.zip }} {{ order.city }}, {{ order.country }}
          </p>
        </div>

        <div v-if="confirmed" class="card p-6" style="box-shadow: var(--shadow-card)">
          <p class="mono-label text-[10px] font-semibold text-muted">ESTIMATED DELIVERY</p>
          <p class="mt-3 font-display text-[20px] font-semibold">{{ batch.deliveryHuman }}</p>
          <p class="mt-1.5 text-[13px] text-muted">Roasted fresh on {{ batch.nextRoastHuman }}</p>
        </div>

        <div
          v-else-if="unfulfillable"
          class="card border border-status-canceled/30 bg-status-canceled-bg p-6"
          style="box-shadow: var(--shadow-card)"
        >
          <p class="mono-label text-[10px] font-semibold text-status-canceled-text">REFUND ON ITS WAY</p>
          <p class="mt-3 font-display text-[20px] font-semibold text-status-canceled-text">{{ fmtPrice(order.total_cents) }}</p>
          <p class="mt-1.5 text-[13px] text-status-canceled-text/80">
            Back to the card you paid with — it usually shows within a few working days.
          </p>
        </div>

        <div v-else-if="expired" class="card p-6" style="box-shadow: var(--shadow-card)">
          <p class="mono-label text-[10px] font-semibold text-muted">PAYMENT</p>
          <p class="mt-3 font-display text-[20px] font-semibold">Expired</p>
          <p class="mt-1.5 text-[13px] text-muted">
            Nothing was charged, and these items are available again.
          </p>
        </div>
        <div v-else class="card p-6" style="box-shadow: var(--shadow-card)">
          <p class="mono-label text-[10px] font-semibold text-muted">PAYMENT</p>
          <p class="mt-3 font-display text-[20px] font-semibold">Not confirmed yet</p>
          <p class="mt-1.5 text-[13px] text-muted">
            Nothing is roasted until it is — delivery is estimated {{ batch.deliveryHuman }} once it clears.
          </p>
        </div>
      </div>
    </div>

    <div class="mt-10 text-center">
      <NuxtLink to="/shop" class="btn-primary">Back to shop</NuxtLink>
    </div>
  </div>
</template>
