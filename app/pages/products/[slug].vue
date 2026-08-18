<script setup lang="ts">
const route = useRoute()
const cart = useCartStore()
const { data: catalog } = await useCatalog()

const products = computed(() => catalog.value?.products ?? [])
const product = computed(() => products.value.find(p => p.slug === route.params.slug))

if (!product.value) {
  throw createError({ statusCode: 404, statusMessage: 'Product not found' })
}

const qty = ref(1)
watch(() => route.params.slug, () => { qty.value = 1 })

const stock = computed(() => product.value?.stock ?? 0)
const soldOut = computed(() => stock.value <= 0)

/** keep qty inside 1…stock whenever the product (and therefore the stock) changes */
watch(stock, (s) => {
  qty.value = Math.min(Math.max(1, qty.value), Math.max(1, s))
}, { immediate: true })

/** on the white info card */
const STOCK_TONE_CLASS: Record<'out' | 'low' | 'ok', string> = {
  out: 'text-status-canceled',
  // the darker -text variant: plain status-open is only 2.4:1 on white at 10px
  low: 'text-status-open-text',
  ok: 'text-muted',
}
/** on the espresso sticky bar — the canceled red fails contrast there, ember carries the alarm */
const STOCK_TONE_CLASS_ONDARK: Record<'out' | 'low' | 'ok', string> = {
  out: 'text-ember',
  low: 'text-status-open',
  ok: 'text-[#EFE4D8]/72',
}

const stockClass = computed(() => STOCK_TONE_CLASS[stockTone(stock.value)])
const stockClassOnDark = computed(() => STOCK_TONE_CLASS_ONDARK[stockTone(stock.value)])

const badge = computed(() => badgeLabel(product.value?.categories?.slug))
const meta = computed(() => product.value?.meta ?? {})

const perKg = computed(() => {
  const w = meta.value.weight_g
  if (!w || !product.value) return null
  return fmtPrice(Math.round(product.value.price_cents / w * 1000))
})

const lineTotal = computed(() => (product.value?.price_cents ?? 0) * qty.value)

const related = computed(() => {
  if (!product.value) return []
  const p = product.value
  const same = products.value.filter(x => x.id !== p.id && x.category_id === p.category_id)
  const rest = products.value.filter(x => x.id !== p.id && x.category_id !== p.category_id)
  return [...same, ...rest].slice(0, 3)
})

function addToCart() {
  if (product.value && !soldOut.value) cart.add(product.value, qty.value)
}

useHead(() => ({ title: `${product.value?.name ?? 'Product'} — Ember & Oak` }))
</script>

<template>
  <div v-if="product" class="pb-24 md:pb-0">
    <!-- ===== dark band: back link + gallery + info card ===== -->
    <section class="relative overflow-hidden bg-espresso pb-14 lg:pb-20">
      <span class="ember-glow -left-52 -top-64 h-[760px] w-[760px]" />

      <div class="relative mx-auto max-w-[1440px] px-5 md:px-6 lg:px-14 pt-8 lg:pt-10">
        <NuxtLink to="/shop" class="mono-label text-[11px] font-medium text-[#EFE4D8]/72 transition-colors hover:text-ember">
          ← BACK TO SHOP
        </NuxtLink>

        <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14">
          <!-- gallery -->
          <div>
            <div class="aspect-square overflow-hidden rounded-[14px] bg-[#3B2A21]" style="box-shadow: var(--shadow-hero)">
              <img
                v-if="product.image_url"
                :src="product.image_url"
                :alt="product.name"
                class="h-full w-full object-cover"
              >
            </div>
          </div>

          <!-- info card -->
          <div class="card relative -mt-2 lg:mt-0 p-6 md:p-8 lg:p-10 self-start" style="box-shadow: var(--shadow-card-ondark)">
            <span class="mono-label inline-block rounded-full bg-espresso px-3 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-cream">
              {{ badge }}
            </span>

            <h1 class="mt-4 font-display text-[28px] md:text-[34px] lg:text-[44px] font-semibold leading-[1.06] tracking-[-0.01em]">
              {{ product.name }}
            </h1>

            <p v-if="meta.meta_line" class="mono-label mt-3 text-[11px] font-medium text-muted">
              {{ meta.meta_line }}
            </p>

            <p class="mt-5 text-[28px] lg:text-[32px] font-semibold">
              {{ fmtPrice(product.price_cents) }}
              <span class="ml-1 text-[13px] font-normal text-muted">
                incl. VAT<template v-if="perKg"> · {{ perKg }} / kg</template>
              </span>
            </p>

            <p class="mono-label mt-2 text-[10px] font-semibold" :class="stockClass">
              {{ stockLabel(stock) }}
            </p>

            <p class="mt-5 text-[15px] leading-[1.75] text-muted">{{ product.description }}</p>

            <!-- roast profile (coffee only) -->
            <div v-if="meta.roast_pct != null" class="mt-6 rounded-xl bg-cream p-[18px]">
              <p class="mono-label text-[10px] font-semibold text-muted">ROAST PROFILE</p>
              <div class="relative mt-3 h-2 rounded-full" style="background: linear-gradient(90deg, #E4A07F, #C65F3D 55%, #4A3428)">
                <span
                  class="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white"
                  style="border: 3px solid #C65F3D"
                  :style="{ left: `${meta.roast_pct}%` }"
                />
              </div>
              <div class="mono-label mt-2 flex justify-between text-[9px] text-muted">
                <span>LIGHT</span><span>MEDIUM</span><span>DARK</span>
              </div>
              <div v-if="meta.flavors?.length" class="mt-4 flex flex-wrap gap-2">
                <span
                  v-for="f in meta.flavors"
                  :key="f"
                  class="rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px]"
                >
                  {{ f }}
                </span>
              </div>
            </div>

            <!-- qty + add -->
            <div class="mt-7 flex flex-col md:flex-row gap-3.5 md:items-center">
              <div class="flex items-center gap-3">
                <span class="mono-label text-[10px] font-medium text-muted md:hidden">QTY</span>
                <QtyStepper v-model="qty" :size="44" :max="Math.max(1, product.stock)" />
              </div>
              <button
                class="btn-primary w-full md:grow disabled:opacity-40 disabled:hover:bg-terra"
                :disabled="soldOut"
                @click="addToCart"
              >
                <template v-if="soldOut">Out of stock</template>
                <template v-else>Add to cart — {{ fmtPrice(lineTotal) }}</template>
              </button>
            </div>

            <p class="mono-label mt-6 border-t border-line pt-5 text-[10px] leading-relaxed text-muted">
              ✓ FREE SHIPPING OVER €49 &nbsp;·&nbsp; ✓ ROASTED THIS TUESDAY &nbsp;·&nbsp; ✓ RESEALABLE BAG
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== related ===== -->
    <section class="mx-auto max-w-[1440px] px-5 md:px-6 lg:px-14 py-12 lg:py-20">
      <div class="flex items-end justify-between">
        <h2 class="font-display text-[26px] lg:text-[30px] font-semibold">You might also like</h2>
        <NuxtLink to="/shop" class="text-sm font-medium text-terra hover:text-terra-dark">
          All {{ products.length }} products →
        </NuxtLink>
      </div>

      <!-- desktop/tablet: cards -->
      <div class="mt-7 hidden md:grid grid-cols-3 gap-4 lg:gap-[22px]">
        <ProductCard v-for="p in related" :key="p.id" :product="p" />
      </div>

      <!-- mobile: compact rows -->
      <div class="mt-5 md:hidden divide-y divide-line">
        <NuxtLink
          v-for="p in related"
          :key="p.id"
          :to="`/products/${p.slug}`"
          class="flex items-center gap-4 py-3.5"
        >
          <div class="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-cream-alt">
            <img v-if="p.image_url" :src="p.image_url" :alt="p.name" class="h-full w-full object-cover">
          </div>
          <div class="grow">
            <p class="font-display text-[15px] font-semibold leading-snug">{{ p.name }}</p>
            <p v-if="p.tagline" class="mt-0.5 text-xs text-muted">{{ p.tagline }}</p>
          </div>
          <span class="text-sm font-semibold">{{ fmtPrice(p.price_cents) }}</span>
        </NuxtLink>
      </div>
    </section>

    <!-- ===== mobile sticky add-to-cart bar ===== -->
    <div
      class="fixed inset-x-0 bottom-0 z-30 flex items-center gap-4 bg-espresso px-5 pb-[22px] pt-3.5 md:hidden"
      style="box-shadow: var(--shadow-sticky-bar)"
    >
      <div>
        <p class="mono-label text-[9px] font-medium text-[#EFE4D8]/55">TOTAL</p>
        <p class="text-lg font-semibold text-cream">{{ fmtPrice(lineTotal) }}</p>
        <p class="mono-label mt-0.5 text-[9px] font-semibold" :class="stockClassOnDark">
          {{ stockLabel(stock) }}
        </p>
      </div>
      <button
        class="btn-primary h-12 grow disabled:opacity-40 disabled:hover:bg-terra"
        :disabled="soldOut"
        @click="addToCart"
      >
        {{ soldOut ? 'Out of stock' : 'Add to cart' }}
      </button>
    </div>
  </div>
</template>
