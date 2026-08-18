<script setup lang="ts">
definePageMeta({ layout: false })

const cart = useCartStore()
const batch = batchInfo()
const img = useAssetUrl()

const order = computed(() => cart.lastOrder)

onMounted(() => {
  if (!cart.lastOrder) navigateTo('/')
})

const firstName = computed(() =>
  order.value?.firstName ?? order.value?.customer_name?.split(' ')[0] ?? '')

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

      <div class="relative mx-auto mt-10 lg:mt-14 flex h-16 w-16 items-center justify-center rounded-full bg-status-marked text-white">
        <Icon name="Check" :size="30" :stroke-width="3" />
      </div>
      <h1 class="relative mt-6 px-5 font-display text-[30px] md:text-[42px] lg:text-[52px] font-semibold tracking-[-0.02em]">
        Thank you<template v-if="firstName">, {{ firstName }}</template>!
      </h1>
      <p class="relative mx-auto mt-4 max-w-[52ch] px-5 text-[15px] leading-[1.7] text-[#EFE4D8]/72">
        Your order is in. We'll roast on {{ batch.nextRoastHuman }} and ship within
        48 hours — a confirmation is on its way to {{ order.email }}.
      </p>
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
        <div class="card p-6" style="box-shadow: var(--shadow-card)">
          <p class="mono-label text-[10px] font-semibold text-muted">ESTIMATED DELIVERY</p>
          <p class="mt-3 font-display text-[20px] font-semibold">{{ batch.deliveryHuman }}</p>
          <p class="mt-1.5 text-[13px] text-muted">Roasted fresh on {{ batch.nextRoastHuman }}</p>
        </div>
      </div>
    </div>

    <div class="mt-10 text-center">
      <NuxtLink to="/shop" class="btn-primary">Back to shop</NuxtLink>
    </div>
  </div>
</template>
