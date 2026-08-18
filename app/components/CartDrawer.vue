<script setup lang="ts">
const cart = useCartStore()
const batch = batchInfo()

// live stock, so a cart line can never be raised above what the shop can ship.
// Not awaited: the drawer lives in the default layout and every page that renders
// it has already resolved the shared useAsyncData('catalog').
const { data: catalog } = useCatalog()
function stockOf(productId: string): number {
  return catalog.value?.products.find(p => p.id === productId)?.stock ?? Infinity
}

function close() { cart.drawerOpen = false }

// lock body scroll while open
watch(() => cart.drawerOpen, (open) => {
  if (import.meta.client) document.body.style.overflow = open ? 'hidden' : ''
})

onUnmounted(() => {
  if (import.meta.client) document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="cart.drawerOpen" class="fixed inset-0 z-50">
        <!-- backdrop -->
        <div class="drawer-backdrop absolute inset-0 bg-[#130C09]/55" @click="close" />

        <!-- panel -->
        <aside
          class="drawer-panel absolute right-0 top-0 flex h-full w-full md:w-[450px] flex-col overflow-hidden bg-espresso"
          style="box-shadow: var(--shadow-drawer)"
        >
          <span class="ember-glow -left-40 -top-40 h-[460px] w-[460px]" />

          <!-- header -->
          <div class="relative flex items-start justify-between px-6 pt-6 pb-5">
            <div>
              <h2 class="font-display text-[23px] font-semibold text-cream">Your cart</h2>
              <p class="mono-label mt-1 text-[10px] font-medium text-[#EFE4D8]/55">
                {{ cart.itemCount }} {{ cart.itemCount === 1 ? 'ITEM' : 'ITEMS' }} · BATCH № {{ batch.number }}
              </p>
            </div>
            <button
              class="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#EFE4D8]/30 text-cream transition-colors hover:border-ember hover:text-ember"
              aria-label="Close cart"
              @click="close"
            >
              <Icon name="X" :size="16" :stroke-width="2" />
            </button>
          </div>

          <!-- empty state -->
          <div v-if="cart.items.length === 0" class="relative flex grow flex-col items-center justify-center px-8 pb-16 text-center">
            <div class="flex h-[140px] w-[140px] items-center justify-center rounded-full bg-[#EFE4D8]/8">
              <Icon name="Coffee" :size="48" color="#E4A07F" :stroke-width="1.5" />
            </div>
            <h3 class="mt-7 font-display text-[26px] font-semibold text-cream">Your cart is empty</h3>
            <p class="mt-2.5 max-w-[30ch] text-sm leading-relaxed text-[#EFE4D8]/68">
              Nothing brewing yet. The good stuff is one shelf away.
            </p>
            <NuxtLink to="/shop" class="btn-primary mt-7" @click="close">Browse the shop</NuxtLink>
          </div>

          <template v-else>
            <!-- free shipping meter / chip -->
            <div class="relative px-6 pb-5">
              <template v-if="!cart.freeShippingUnlocked">
                <p class="text-[13px] text-[#EFE4D8]/70">
                  <span class="font-semibold text-cream">{{ fmtPrice(cart.remainingToFreeCents) }}</span>
                  away from free shipping
                </p>
                <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#EFE4D8]/16">
                  <div class="h-full rounded-full bg-terra transition-all duration-300" :style="{ width: `${cart.freeShippingProgress}%` }" />
                </div>
              </template>
              <div v-else class="inline-flex items-center gap-2 rounded-full border border-status-marked/50 bg-status-marked/18 px-3.5 py-1.5 text-[13px] font-medium text-status-marked-ondark">
                <Icon name="Check" :size="14" :stroke-width="2.5" />
                You've unlocked free shipping
              </div>
            </div>

            <!-- line items -->
            <div class="relative grow overflow-y-auto px-6">
              <div
                v-for="item in cart.items"
                :key="item.productId"
                class="relative flex gap-4 border-t border-[#EFE4D8]/14 py-5 first:border-t-0"
              >
                <NuxtLink :to="`/products/${item.slug}`" class="block h-[76px] w-[76px] shrink-0 overflow-hidden rounded-lg bg-[#3B2A21]" @click="close">
                  <img v-if="item.image" :src="item.image" :alt="item.name" class="h-full w-full object-cover">
                </NuxtLink>
                <div class="flex grow flex-col">
                  <p class="pr-7 font-display text-[15px] font-semibold leading-snug text-cream">{{ item.name }}</p>
                  <p class="mono-label mt-1 text-[10px] text-[#EFE4D8]/55">{{ fmtPrice(item.unitPriceCents) }} EACH</p>
                  <div class="mt-2.5 flex items-center justify-between">
                    <div class="flex flex-col items-start gap-1">
                      <QtyStepper
                        :model-value="item.qty"
                        variant="dark"
                        :size="36"
                        :max="Math.max(1, stockOf(item.productId))"
                        @update:model-value="cart.setQty(item.productId, $event)"
                      />
                      <p
                        v-if="item.qty >= stockOf(item.productId)"
                        class="mono-label text-[10px] font-semibold text-status-open"
                      >
                        {{ stockLabel(stockOf(item.productId)) }}
                      </p>
                    </div>
                    <span class="text-[15px] font-semibold text-cream">{{ fmtPrice(item.qty * item.unitPriceCents) }}</span>
                  </div>
                </div>
                <button
                  class="absolute right-0 top-5 text-[#EFE4D8]/50 transition-colors hover:text-ember"
                  aria-label="Remove item"
                  @click="cart.remove(item.productId)"
                >
                  <Icon name="X" :size="15" :stroke-width="2" />
                </button>
              </div>
            </div>

            <!-- cream totals footer -->
            <div class="relative bg-cream px-6 pb-6 pt-5">
              <div class="flex justify-between text-sm text-muted">
                <span>Subtotal</span><span class="text-espresso">{{ fmtPrice(cart.subtotalCents) }}</span>
              </div>
              <div class="mt-2 flex justify-between text-sm text-muted">
                <span>Shipping</span>
                <span :class="cart.shippingCents === 0 ? 'font-medium text-status-marked-text' : 'text-espresso'">
                  {{ cart.shippingCents === 0 ? 'Free' : fmtPrice(cart.shippingCents) }}
                </span>
              </div>
              <div class="mt-4 flex justify-between border-t border-line pt-4 text-lg font-semibold">
                <span>Total</span><span>{{ fmtPrice(cart.totalCents) }}</span>
              </div>
              <NuxtLink to="/checkout" class="btn-primary mt-5 w-full" @click="close">Proceed to checkout</NuxtLink>
              <NuxtLink to="/cart" class="mt-3.5 block text-center text-sm font-medium text-terra hover:text-terra-dark" @click="close">
                View full cart
              </NuxtLink>
            </div>
          </template>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.25s ease-out; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.25s ease-out; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }

@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: none; }
  .drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: none; }
}
</style>
