<script setup lang="ts">
const cart = useCartStore()
const batch = batchInfo()

useHead({ title: 'Your cart — Ember & Oak' })
</script>

<template>
  <div>
    <!-- ===== empty cart ===== -->
    <section v-if="cart.items.length === 0" class="relative overflow-hidden bg-espresso">
      <span class="ember-glow -left-52 -top-64 h-[760px] w-[760px]" />
      <div class="relative mx-auto flex min-h-[70vh] max-w-[1440px] flex-col items-center justify-center px-5 py-20 text-center">
        <div class="flex h-[140px] w-[140px] items-center justify-center rounded-full bg-[#EFE4D8]/8">
          <Icon name="Coffee" :size="48" color="#E4A07F" :stroke-width="1.5" />
        </div>
        <h1 class="mt-7 font-display text-[26px] lg:text-[32px] font-semibold text-cream">Your cart is empty</h1>
        <p class="mt-3 max-w-[32ch] text-sm leading-relaxed text-[#EFE4D8]/68">
          Nothing brewing yet. The good stuff is one shelf away.
        </p>
        <NuxtLink to="/shop" class="btn-primary mt-8">Browse the shop</NuxtLink>
      </div>
    </section>

    <template v-else>
      <!-- ===== dark band ===== -->
      <section class="relative overflow-hidden bg-espresso pb-[110px] text-cream">
        <span class="ember-glow -left-52 -top-64 h-[700px] w-[700px]" />
        <div class="relative mx-auto flex max-w-[1440px] items-end justify-between gap-8 px-5 md:px-6 lg:px-14 pt-10 lg:pt-16">
          <div>
            <p class="mono-label text-xs font-medium tracking-[0.18em] text-ember">
              YOUR CART · {{ cart.itemCount }} {{ cart.itemCount === 1 ? 'ITEM' : 'ITEMS' }}
            </p>
            <h1 class="mt-4 font-display text-[34px] md:text-[42px] lg:text-[52px] font-semibold tracking-[-0.02em]">
              Ready when you are.
            </h1>
          </div>
          <NuxtLink to="/shop" class="mono-label hidden md:block pb-2 text-[11px] font-medium text-[#EFE4D8]/72 transition-colors hover:text-ember">
            ← CONTINUE SHOPPING
          </NuxtLink>
        </div>
      </section>

      <!-- ===== content, overlapping ===== -->
      <div class="relative mx-auto -mt-[56px] grid max-w-[1440px] grid-cols-1 lg:grid-cols-[1fr_410px] items-start gap-6 lg:gap-8 px-5 md:px-6 lg:px-14 pb-16 lg:pb-24">
        <!-- items card -->
        <div class="card px-5 md:px-7 py-2" style="box-shadow: var(--shadow-card-overlap)">
          <div
            v-for="item in cart.items"
            :key="item.productId"
            class="relative flex gap-4 md:gap-5 border-t border-line py-5 md:py-6 first:border-t-0"
          >
            <NuxtLink :to="`/products/${item.slug}`" class="block h-[72px] w-[72px] md:h-[92px] md:w-[92px] shrink-0 overflow-hidden rounded-lg bg-cream-alt">
              <img v-if="item.image" :src="item.image" :alt="item.name" class="h-full w-full object-cover">
            </NuxtLink>
            <div class="flex grow flex-col md:flex-row md:items-center gap-3 md:gap-5">
              <div class="grow pr-8 md:pr-0">
                <NuxtLink :to="`/products/${item.slug}`" class="font-display text-[16px] md:text-lg font-semibold leading-snug hover:text-terra transition-colors">
                  {{ item.name }}
                </NuxtLink>
                <p class="mono-label mt-1 text-[10px] text-muted">{{ fmtPrice(item.unitPriceCents) }} EACH</p>
              </div>
              <QtyStepper
                :model-value="item.qty"
                :size="40"
                @update:model-value="cart.setQty(item.productId, $event)"
              />
              <span class="min-w-[70px] text-right text-[16px] font-semibold">{{ fmtPrice(item.qty * item.unitPriceCents) }}</span>
            </div>
            <button
              class="absolute right-0 top-5 md:top-1/2 md:-translate-y-1/2 text-muted transition-colors hover:text-status-canceled"
              aria-label="Remove item"
              @click="cart.remove(item.productId)"
            >
              <Icon name="X" :size="17" :stroke-width="2" />
            </button>
          </div>

          <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 border-t border-line py-5">
            <NuxtLink to="/shop" class="text-sm font-medium text-terra hover:text-terra-dark">← Continue shopping</NuxtLink>
            <p class="mono-label text-[10px] text-muted">ROASTED {{ batch.roastedShort }} · SHIPS WED</p>
          </div>
        </div>

        <!-- dark summary -->
        <aside class="relative overflow-hidden rounded-[14px] bg-espresso p-6 md:p-7 lg:sticky lg:top-6" style="box-shadow: 0 20px 48px rgba(46,33,26,.24)">
          <span class="ember-glow -right-28 -top-32 h-[380px] w-[380px]" />
          <div class="relative">
            <h2 class="font-display text-[22px] font-semibold text-cream">Order summary</h2>

            <div v-if="cart.freeShippingUnlocked" class="mt-4 inline-flex items-center gap-2 rounded-full border border-status-marked/50 bg-status-marked/18 px-3.5 py-1.5 text-[13px] font-medium text-status-marked-ondark">
              <Icon name="Check" :size="14" :stroke-width="2.5" />
              You've unlocked free shipping
            </div>
            <template v-else>
              <p class="mt-4 text-[13px] text-[#EFE4D8]/70">
                <span class="font-semibold text-cream">{{ fmtPrice(cart.remainingToFreeCents) }}</span>
                away from free shipping
              </p>
              <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#EFE4D8]/16">
                <div class="h-full rounded-full bg-terra transition-all duration-300" :style="{ width: `${cart.freeShippingProgress}%` }" />
              </div>
            </template>

            <div class="mt-6 space-y-2.5 text-sm text-[#EFE4D8]/70">
              <div class="flex justify-between">
                <span>Subtotal</span><span class="text-cream">{{ fmtPrice(cart.subtotalCents) }}</span>
              </div>
              <div class="flex justify-between">
                <span>Shipping</span>
                <span :class="cart.shippingCents === 0 ? 'font-medium text-status-marked-ondark' : 'text-cream'">
                  {{ cart.shippingCents === 0 ? 'Free' : fmtPrice(cart.shippingCents) }}
                </span>
              </div>
            </div>
            <div class="mt-5 flex justify-between border-t border-[#EFE4D8]/18 pt-5 text-xl font-semibold text-cream">
              <span>Total</span><span>{{ fmtPrice(cart.totalCents) }}</span>
            </div>
            <p class="mono-label mt-1.5 text-[9px] text-[#EFE4D8]/50">INCL. VAT</p>

            <NuxtLink to="/checkout" class="btn-primary mt-6 w-full">Proceed to checkout</NuxtLink>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>
