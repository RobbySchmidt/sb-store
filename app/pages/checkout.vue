<script setup lang="ts">
definePageMeta({ layout: false })

const cart = useCartStore()
const route = useRoute()
const placing = ref(false)
const placeError = ref('')
const summaryOpen = ref(false)
const img = useAssetUrl()

/** Set when Stripe bounced the buyer back via cancel_url. The cart is
 *  deliberately untouched; the abandoned order is released below. */
const paymentCanceled = computed(() => route.query.canceled === '1')

/** The order we sent them to Stripe with, so backing out can release its stock. */
const abandonedId = computed(() => {
  const v = route.query.abandoned
  return typeof v === 'string' && v ? v : null
})

const form = reactive({
  firstName: '', lastName: '', email: '',
  street: '', zip: '', city: '', country: 'Germany',
})
const errors = reactive<Record<string, string>>({})

/** Restored from the back-forward cache with `placing` still true — see below. */
function onPageShow(e: PageTransitionEvent) {
  if (e.persisted) placing.value = false
}

onMounted(() => {
  if (cart.items.length === 0 && !paymentCanceled.value) navigateTo('/cart')

  // goToPayment() deliberately leaves `placing` true so the button stays
  // disabled while the browser navigates to Stripe. But this page has no
  // Cache-Control header, so it is bfcache-eligible: using the browser's own
  // back button from Stripe restores it frozen, button reading "Redirecting to
  // Stripe…" forever, with no way out but a manual reload.
  window.addEventListener('pageshow', onPageShow)

  // Backing out of Stripe is the one moment we KNOW the buyer walked away, so
  // release the order's stock now instead of leaving it held for 45 minutes.
  // Without this a buyer who backs out and immediately retries is refused by
  // their own abandoned order — "only 0 left" on stock they are holding — and
  // every retry stacks another ghost. Fire-and-forget: it is a courtesy, and
  // the sweep is still the backstop if it fails.
  if (abandonedId.value) {
    $fetch('/api/orders/abandon', { method: 'POST', body: { orderId: abandonedId.value } })
      .catch(() => {})
  }
})

onUnmounted(() => window.removeEventListener('pageshow', onPageShow))

function validate(): boolean {
  Object.keys(errors).forEach(k => delete errors[k])
  if (!form.firstName.trim()) errors.firstName = 'Please enter your first name.'
  if (!form.lastName.trim()) errors.lastName = 'Please enter your last name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Please enter a valid email address.'
  if (!form.street.trim()) errors.street = 'Please enter your street and number.'
  if (form.country === 'Germany' ? !/^\d{5}$/.test(form.zip.trim()) : !form.zip.trim()) {
    errors.zip = form.country === 'Germany' ? 'ZIP must be 5 digits.' : 'Please enter your ZIP code.'
  }
  if (!form.city.trim()) errors.city = 'Please enter your city.'
  return Object.keys(errors).length === 0
}

async function goToPayment() {
  if (placing.value || !validate()) return
  placing.value = true
  placeError.value = ''
  try {
    const { checkoutUrl } = await $fetch<{ checkoutUrl: string }>('/api/orders', {
      method: 'POST',
      body: {
        customer: { ...form },
        items: cart.items.map(i => ({ productId: i.productId, qty: i.qty })),
      },
    })
    // The cart is deliberately NOT cleared here. Backing out of Stripe must
    // leave it intact — /confirmation clears it once payment is confirmed.
    window.location.href = checkoutUrl
  } catch (e: any) {
    // e.data.statusMessage keeps the original text — e.statusMessage comes from the
    // HTTP reason phrase, which h3 strips of non-ASCII (every product name has an en dash)
    placeError.value = e?.data?.statusMessage ?? e?.data?.message ?? e?.statusMessage
      ?? e?.message ?? 'Something went wrong placing your order.'
    placing.value = false
  }
  // No `finally` — on success the browser is navigating away and the button
  // should stay disabled until it does.
}

const inputClass = (key: string) =>
  `h-[50px] w-full rounded-[10px] border bg-cream px-4 text-[15px] outline-none transition-colors focus:border-terra focus:border-2 focus:bg-white ${
    errors[key] ? 'border-status-canceled' : 'border-line'
  }`
</script>

<template>
  <div class="flex min-h-screen flex-col bg-cream">
    <!-- ===== dark band: minimal header ===== -->
    <section class="relative overflow-hidden bg-espresso pb-[92px] text-cream">
      <span class="ember-glow -left-52 -top-72 h-[820px] w-[820px]" />

      <div class="relative mx-auto grid max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-5 md:px-6 lg:px-14 pt-6 lg:pt-8">
        <NuxtLink to="/cart" class="mono-label text-[10px] md:text-[11px] font-medium text-[#EFE4D8]/72 transition-colors hover:text-ember">
          ← BACK TO CART
        </NuxtLink>
        <NuxtLink to="/" class="flex items-center gap-2.5">
          <span class="h-2.5 w-2.5 rounded-full bg-terra" />
          <span class="font-display text-[19px] md:text-[21px] font-semibold text-cream">Ember &amp; Oak</span>
        </NuxtLink>
        <p class="mono-label text-right text-[10px] md:text-[11px] font-medium text-[#EFE4D8]/55">SECURE CHECKOUT</p>
      </div>

      <h1 class="relative mt-8 lg:mt-10 text-center font-display text-[25px] md:text-[34px] lg:text-[40px] font-semibold">Checkout</h1>

      <!-- payment note: hosted Checkout means we never see a card number -->
      <p class="relative mt-5 text-center text-[13px] text-[#EFE4D8]/60">
        Payment is handled by Stripe — you'll be redirected to complete it.
      </p>
    </section>

    <!-- ===== content ===== -->
    <div class="relative mx-auto -mt-[52px] grid w-full max-w-[1440px] grow grid-cols-1 lg:grid-cols-[1fr_400px] items-start gap-6 lg:gap-8 px-5 md:px-6 lg:px-14 pb-16 lg:pb-24">

      <!-- mobile/tablet: collapsible summary -->
      <div class="lg:hidden">
        <button
          class="card flex min-h-[54px] w-full items-center justify-between px-5 py-3.5"
          style="box-shadow: var(--shadow-card-overlap)"
          @click="summaryOpen = !summaryOpen"
        >
          <span class="text-sm font-medium">Order summary ({{ cart.itemCount }} {{ cart.itemCount === 1 ? 'item' : 'items' }})</span>
          <span class="flex items-center gap-2.5">
            <span class="text-[15px] font-semibold">{{ fmtPrice(cart.totalCents) }}</span>
            <Icon name="ChevronDown" :size="16" :stroke-width="2" class="transition-transform" :class="summaryOpen ? 'rotate-180' : ''" />
          </span>
        </button>
        <div v-if="summaryOpen" class="card mt-2 px-5 py-4">
          <div v-for="item in cart.items" :key="item.productId" class="flex items-center gap-3.5 py-2.5">
            <div class="relative h-[46px] w-[46px] shrink-0 rounded-lg bg-cream-alt overflow-hidden">
              <img v-if="item.image" :src="img(item.image, THUMB) ?? undefined" :alt="item.name" class="h-full w-full object-cover">
              <span class="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-terra px-1 text-[10px] font-bold text-white">{{ item.qty }}</span>
            </div>
            <p class="grow text-[13px] font-medium leading-snug">{{ item.name }}</p>
            <span class="text-[13px] font-semibold">{{ fmtPrice(item.qty * item.unitPriceCents) }}</span>
          </div>
          <div class="mt-3 space-y-2 border-t border-line pt-3.5 text-sm text-muted">
            <div class="flex justify-between"><span>Subtotal</span><span class="text-espresso">{{ fmtPrice(cart.subtotalCents) }}</span></div>
            <div class="flex justify-between">
              <span>Shipping</span>
              <span :class="cart.shippingCents === 0 ? 'font-medium text-status-marked-text' : 'text-espresso'">{{ cart.shippingCents === 0 ? 'Free' : fmtPrice(cart.shippingCents) }}</span>
            </div>
            <div class="flex justify-between border-t border-line pt-3 text-base font-semibold text-espresso">
              <span>Total</span><span>{{ fmtPrice(cart.totalCents) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- form card -->
      <div class="card p-6 md:p-9" style="box-shadow: var(--shadow-card-overlap)">
        <h2 class="font-display text-[24px] font-semibold">Contact &amp; shipping</h2>

        <form class="mt-7 space-y-5" novalidate @submit.prevent="goToPayment">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="firstName">FIRST NAME</label>
              <input id="firstName" v-model="form.firstName" :class="inputClass('firstName')" autocomplete="given-name">
              <p v-if="errors.firstName" class="mt-1.5 text-[13px] text-status-canceled">{{ errors.firstName }}</p>
            </div>
            <div>
              <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="lastName">LAST NAME</label>
              <input id="lastName" v-model="form.lastName" :class="inputClass('lastName')" autocomplete="family-name">
              <p v-if="errors.lastName" class="mt-1.5 text-[13px] text-status-canceled">{{ errors.lastName }}</p>
            </div>
          </div>

          <div>
            <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="email">EMAIL</label>
            <input id="email" v-model="form.email" type="email" :class="inputClass('email')" autocomplete="email">
            <p v-if="errors.email" class="mt-1.5 text-[13px] text-status-canceled">{{ errors.email }}</p>
            <p v-else class="mt-1.5 text-[13px] text-muted">Order confirmation goes here — no newsletter unless you ask.</p>
          </div>

          <div>
            <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="street">STREET &amp; NUMBER</label>
            <input id="street" v-model="form.street" :class="inputClass('street')" autocomplete="street-address">
            <p v-if="errors.street" class="mt-1.5 text-[13px] text-status-canceled">{{ errors.street }}</p>
          </div>

          <div class="grid grid-cols-[110px_1fr] md:grid-cols-2 gap-5">
            <div>
              <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="zip">ZIP</label>
              <input id="zip" v-model="form.zip" :class="inputClass('zip')" autocomplete="postal-code" inputmode="numeric">
              <p v-if="errors.zip" class="mt-1.5 text-[13px] text-status-canceled">{{ errors.zip }}</p>
            </div>
            <div>
              <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="city">CITY</label>
              <input id="city" v-model="form.city" :class="inputClass('city')" autocomplete="address-level2">
              <p v-if="errors.city" class="mt-1.5 text-[13px] text-status-canceled">{{ errors.city }}</p>
            </div>
          </div>

          <div>
            <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="country">COUNTRY</label>
            <select id="country" v-model="form.country" :class="inputClass('country')" autocomplete="country-name">
              <option>Germany</option>
              <option>Austria</option>
              <option>Switzerland</option>
              <option>Netherlands</option>
              <option>France</option>
            </select>
          </div>

          <p v-if="paymentCanceled" class="rounded-[10px] bg-cream px-4 py-3 text-[13px] leading-relaxed text-muted">
            Payment was canceled — nothing has been charged and your cart is still here.
          </p>
          <p v-if="placeError" class="rounded-[10px] bg-status-canceled-bg px-4 py-3 text-[13px] text-status-canceled-text">
            {{ placeError }}
          </p>

          <div class="flex justify-end pt-2">
            <button
              type="submit"
              class="btn-primary w-full md:w-auto"
              :disabled="placing"
              :class="placing ? 'opacity-70 pointer-events-none' : ''"
            >
              {{ placing ? 'Redirecting to Stripe…' : `Continue to payment — ${fmtPrice(cart.totalCents)}` }}
            </button>
          </div>
        </form>
      </div>

      <!-- desktop summary (dark, sticky) -->
      <aside class="relative hidden lg:block overflow-hidden rounded-[14px] bg-espresso p-7 sticky top-6" style="box-shadow: 0 20px 48px rgba(46,33,26,.24)">
        <span class="ember-glow -right-28 -top-32 h-[380px] w-[380px]" />
        <div class="relative">
          <h2 class="font-display text-[22px] font-semibold text-cream">Order summary</h2>

          <div class="mt-5 space-y-4">
            <div v-for="item in cart.items" :key="item.productId" class="flex items-center gap-3.5">
              <div class="relative h-[54px] w-[54px] shrink-0 overflow-hidden rounded-lg bg-[#3B2A21]">
                <img v-if="item.image" :src="img(item.image, THUMB) ?? undefined" :alt="item.name" class="h-full w-full object-cover">
                <span class="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-terra px-1 text-[10px] font-bold text-white">{{ item.qty }}</span>
              </div>
              <p class="grow text-[13px] font-medium leading-snug text-cream">{{ item.name }}</p>
              <span class="text-[13px] font-semibold text-cream">{{ fmtPrice(item.qty * item.unitPriceCents) }}</span>
            </div>
          </div>

          <div class="mt-6 space-y-2.5 border-t border-[#EFE4D8]/18 pt-5 text-sm text-[#EFE4D8]/70">
            <div class="flex justify-between"><span>Subtotal</span><span class="text-cream">{{ fmtPrice(cart.subtotalCents) }}</span></div>
            <div class="flex justify-between">
              <span>Shipping</span>
              <span :class="cart.shippingCents === 0 ? 'font-medium text-status-marked-ondark' : 'text-cream'">{{ cart.shippingCents === 0 ? 'Free' : fmtPrice(cart.shippingCents) }}</span>
            </div>
          </div>
          <div class="mt-4 flex justify-between border-t border-[#EFE4D8]/18 pt-4 text-xl font-semibold text-cream">
            <span>Total</span><span>{{ fmtPrice(cart.totalCents) }}</span>
          </div>
          <p class="mono-label mt-1.5 text-[9px] text-[#EFE4D8]/50">INCL. VAT</p>
        </div>
      </aside>
    </div>
  </div>
</template>
