<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useShop'

const props = defineProps<{
  product: CatalogProduct
  /** stronger shadow when the card overlaps the dark band */
  onDark?: boolean
}>()

const cart = useCartStore()
const img = useAssetUrl()
const badge = computed(() => badgeLabel(props.product.category.slug))

const STOCK_TONE_CLASS: Record<'out' | 'low' | 'ok', string> = {
  out: 'text-status-canceled',
  // the darker -text variant: plain status-open is only 2.4:1 on white at 10px
  low: 'text-status-open-text',
  ok: 'text-muted',
}

const soldOut = computed(() => props.product.stock_available <= 0)
const stockClass = computed(() => STOCK_TONE_CLASS[stockTone(props.product.stock_available)])
</script>

<template>
  <NuxtLink
    :to="`/products/${product.slug}`"
    class="card card-hoverable group flex flex-col overflow-hidden"
    :style="onDark ? 'box-shadow: var(--shadow-card-ondark)' : ''"
  >
    <div class="relative aspect-square overflow-hidden bg-cream-alt">
      <img
        v-if="product.image"
        :src="img(product.image, { width: 640, height: 640, fit: 'cover', format: 'webp' }) ?? undefined"
        :alt="product.name"
        class="h-full w-full object-cover"
        loading="lazy"
      >
      <span class="mono-label absolute left-3.5 top-3.5 rounded-full bg-espresso px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-cream">
        {{ badge }}
      </span>
      <span
        v-if="soldOut"
        class="mono-label absolute right-3.5 top-3.5 rounded-full bg-status-canceled px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-white"
      >
        OUT OF STOCK
      </span>
    </div>

    <div class="flex grow flex-col p-4 lg:p-5">
      <h3 class="font-display text-[17px] lg:text-lg font-semibold leading-snug">{{ product.name }}</h3>
      <p v-if="product.tagline" class="mt-1 text-[13px] text-muted">{{ product.tagline }}</p>

      <div class="mt-auto pt-4">
        <!-- desktop/tablet: price + circular add -->
        <div class="hidden md:flex items-center justify-between">
          <div>
            <span class="text-[17px] font-semibold">{{ fmtPrice(product.price_cents) }}</span>
            <p class="mono-label mt-1 text-[10px] font-semibold" :class="stockClass">
              {{ stockLabel(product.stock_available) }}
            </p>
          </div>
          <button
            class="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-espresso text-white transition-colors hover:bg-terra disabled:opacity-40 disabled:hover:bg-espresso"
            :aria-label="`Add ${product.name} to cart`"
            :disabled="product.stock_available <= 0"
            @click.prevent.stop="cart.add(product)"
          >
            <Icon name="Plus" :size="19" :stroke-width="2.5" />
          </button>
        </div>
        <!-- mobile: price + full-width add -->
        <div class="md:hidden">
          <span class="text-base font-semibold">{{ fmtPrice(product.price_cents) }}</span>
          <p class="mono-label mt-1 text-[10px] font-semibold" :class="stockClass">
            {{ stockLabel(product.stock_available) }}
          </p>
          <button
            class="mt-2.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-espresso text-sm font-semibold text-white transition-colors active:bg-terra disabled:opacity-40"
            :disabled="product.stock_available <= 0"
            @click.prevent.stop="cart.add(product)"
          >
            <Icon name="Plus" :size="16" :stroke-width="2.5" />
            Add to cart
          </button>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
