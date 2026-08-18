<script setup lang="ts">
import type { AssetOptions } from '~~/shared/utils/assetUrl'

const { data: catalog } = await useCatalog()

const products = computed(() => catalog.value?.products ?? [])
const categories = computed(() => catalog.value?.categories ?? [])

const featuredSlugs = ['ember-blend-dark-roast', 'sunrise-single-origin-ethiopia', 'honey-almond-granola', 'ceramic-pour-over-dripper']
const featured = computed(() =>
  featuredSlugs.map(s => products.value.find(p => p.slug === s)).filter(Boolean) as NonNullable<typeof products.value[0]>[])

const batch = batchInfo()
const img = useAssetUrl()

/** The Directus asset URL for a product's photo, by slug. */
function photo(slug: string, opts: AssetOptions) {
  return img(products.value.find(p => p.slug === slug)?.image, opts) ?? undefined
}

const BAND = { width: 1600, quality: 78, format: 'webp' } as const
const TILE = { width: 720, height: 520, fit: 'cover', format: 'webp' } as const

const heroImage = computed(() => photo('house-espresso-classic', BAND))
const tanneryImage = computed(() => photo('glass-carafe-brewer', BAND))

const tileImages: Record<string, string> = {
  coffee: 'sunrise-single-origin-ethiopia',
  pantry: 'wildflower-honey',
  accessories: 'ceramic-pour-over-dripper',
}
function tileImage(slug: string) {
  const productSlug = tileImages[slug]
  return productSlug ? photo(productSlug, TILE) : undefined
}
function categoryCount(id: string) {
  return products.value.filter(p => p.category.id === id).length
}

const email = ref('')
const subscribed = ref(false)

useHead({ title: 'Ember & Oak — Small-batch coffee roastery' })
</script>

<template>
  <div>
    <!-- ===== full-bleed hero: the drum ===== -->
    <section class="relative flex min-h-[480px] md:min-h-[560px] lg:min-h-[660px] flex-col justify-end overflow-hidden bg-espresso text-cream">
      <img
        v-if="heroImage"
        :src="heroImage"
        alt="Espresso running from the machine, side light"
        class="absolute inset-0 h-full w-full object-cover"
      >
      <div class="absolute inset-0" style="background: linear-gradient(100deg, rgba(46,33,26,.96) 25%, rgba(46,33,26,.55) 55%, rgba(46,33,26,.25))" />
      <div class="absolute inset-0" style="background: linear-gradient(0deg, rgba(46,33,26,.85), transparent 45%)" />

      <p class="mono-label absolute right-5 top-7 md:right-6 lg:right-14 lg:top-9 text-right text-[10px] lg:text-[11px] leading-[2] text-[#EFE4D8]/75">
        BATCH № {{ batch.number }}<br>ROASTED {{ batch.roastedShort }}
      </p>

      <div class="relative mx-auto w-full max-w-[1440px] px-5 md:px-6 lg:px-14 pb-12 md:pb-16 lg:pb-20 pt-32">
        <p class="mono-label text-xs font-medium tracking-[0.18em] text-ember">
          SMALL-BATCH ROASTERY · FREIBURG · EST. 2019
        </p>
        <h1 class="mt-5 max-w-[14ch] font-display text-[42px] md:text-[58px] lg:text-[80px] font-semibold leading-[1.02] tracking-[-0.02em] text-cream">
          Dark, sweet and&nbsp;still <em class="font-normal italic text-ember">warm</em> from the&nbsp;drum.
        </h1>
        <div class="mt-8 lg:mt-10 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <NuxtLink to="/shop" class="btn-primary w-full sm:w-auto">Shop the roast</NuxtLink>
          <a href="#" class="text-[15px] font-medium text-[#EFE4D8] border-b border-[#EFE4D8]/40 pb-0.5 self-center sm:self-auto transition-colors hover:text-ember hover:border-ember">
            Taste guide
          </a>
        </div>
      </div>
    </section>

    <!-- ===== featured products ===== -->
    <section class="mx-auto max-w-[1440px] px-5 md:px-6 lg:px-14 pt-12 lg:pt-16">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-[22px]">
        <ProductCard v-for="p in featured" :key="p.id" :product="p" />
      </div>
      <div class="mt-5 text-right">
        <NuxtLink to="/shop" class="text-sm font-medium text-terra hover:text-terra-dark">
          All {{ products.length }} products →
        </NuxtLink>
      </div>
    </section>

    <!-- ===== category tiles ===== -->
    <section class="mx-auto max-w-[1440px] px-5 md:px-6 lg:px-14 pt-14 lg:pt-20 pb-16 lg:pb-24">
      <div class="flex items-end justify-between">
        <h2 class="font-display text-[28px] lg:text-[34px] font-semibold">Browse the shelves</h2>
        <p class="mono-label hidden md:block text-[10px] text-muted">THREE SHELVES · ALL PRICES INCL. VAT</p>
      </div>

      <div class="mt-7 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 lg:gap-[22px]">
        <NuxtLink
          v-for="c in categories"
          :key="c.id"
          :to="`/shop?category=${c.slug}`"
          class="card-hoverable group relative block h-[130px] md:h-[190px] lg:h-[260px] overflow-hidden rounded-[14px]"
        >
          <img
            v-if="tileImage(c.slug)"
            :src="tileImage(c.slug)"
            :alt="`${c.name} shelf`"
            class="absolute inset-0 h-full w-full object-cover"
          >
          <div class="absolute inset-0" style="background: linear-gradient(transparent 40%, rgba(46,33,26,.68))" />
          <div class="absolute inset-x-5 bottom-4 flex items-baseline gap-3 md:block">
            <h3 class="font-display text-[24px] lg:text-[30px] font-semibold text-white">{{ c.name }}</h3>
            <p class="text-[13px] text-white/82">{{ categoryCount(c.id) }} products →</p>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- ===== story band ===== -->
    <section class="bg-cream-alt">
      <div class="mx-auto grid max-w-[1440px] grid-cols-1 lg:grid-cols-2 items-center gap-10 lg:gap-16 px-5 md:px-6 lg:px-14 py-14 lg:py-24">
        <div class="h-[240px] md:h-[320px] lg:h-[420px] overflow-hidden rounded-[14px]" style="box-shadow: var(--shadow-card-overlap)">
          <img
            v-if="tanneryImage"
            :src="tanneryImage"
            alt="The drum roaster mid-batch"
            class="h-full w-full object-cover"
          >
        </div>
        <div>
          <p class="mono-label text-xs font-medium tracking-[0.18em] text-terra">INSIDE THE TANNERY</p>
          <h2 class="mt-4 font-display text-[30px] lg:text-[44px] font-semibold leading-tight">
            Four people, one drum, no warehouse.
          </h2>
          <p class="mt-5 max-w-[52ch] text-[15px] leading-[1.75] text-muted">
            We buy small lots, roast them the week they ship, and write the date
            on every bag by hand. If a coffee sells out, it sells out — the next
            batch tastes like the next batch should.
          </p>
          <div class="mt-8 grid grid-cols-3 gap-6 border-t border-[#2E211A]/10 pt-6">
            <div>
              <p class="font-display text-[26px] lg:text-[30px] font-semibold">12 kg</p>
              <p class="mono-label mt-1 text-xs text-muted">PER BATCH</p>
            </div>
            <div>
              <p class="font-display text-[26px] lg:text-[30px] font-semibold">48 h</p>
              <p class="mono-label mt-1 text-xs text-muted">ROAST TO POST</p>
            </div>
            <div>
              <p class="font-display text-[26px] lg:text-[30px] font-semibold">7 yrs</p>
              <p class="mono-label mt-1 text-xs text-muted">SAME ROOM</p>
            </div>
          </div>
          <a href="#" class="mt-6 inline-block text-sm font-medium text-terra hover:text-terra-dark">Read our story →</a>
        </div>
      </div>
    </section>

    <!-- ===== newsletter band ===== -->
    <section class="bg-espresso">
      <div class="mx-auto flex max-w-[1440px] flex-col lg:flex-row lg:items-center justify-between gap-7 px-5 md:px-6 lg:px-14 py-12 lg:py-16">
        <div>
          <h3 class="font-display text-[24px] lg:text-[28px] font-semibold text-cream">Know what's in the drum</h3>
          <p class="mt-2 text-sm text-[#EFE4D8]/70">One short note every Tuesday: what we roasted, what's nearly gone.</p>
        </div>
        <form v-if="!subscribed" class="flex flex-col sm:flex-row gap-3" @submit.prevent="subscribed = true">
          <input
            v-model="email"
            type="email"
            required
            placeholder="you@example.com"
            class="h-[52px] w-full sm:w-[300px] rounded-full border border-[#EFE4D8]/30 bg-[#EFE4D8]/8 px-6 text-[15px] text-cream placeholder:text-[#EFE4D8]/45 outline-none focus:border-ember"
          >
          <button type="submit" class="btn-primary">Subscribe</button>
        </form>
        <p v-else class="flex items-center gap-2.5 text-[15px] font-medium text-status-marked-ondark">
          <Icon name="Check" :size="18" :stroke-width="2.5" />
          You're on the list — see you Tuesday.
        </p>
      </div>
    </section>
  </div>
</template>
