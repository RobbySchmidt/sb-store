<script setup lang="ts">
definePageMeta({ layout: false })

const cart = useCartStore()
const step = ref<1 | 2>(1)
const placing = ref(false)
const placeError = ref('')
const summaryOpen = ref(false)
const img = useAssetUrl()

const form = reactive({
  firstName: '', lastName: '', email: '',
  street: '', zip: '', city: '', country: 'Germany',
})
const payment = reactive({ name: '', card: '', expiry: '', cvc: '' })
const errors = reactive<Record<string, string>>({})

onMounted(() => {
  if (cart.items.length === 0) navigateTo('/cart')
})

function validateStep1(): boolean {
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

function continueToPayment() {
  if (!validateStep1()) return
  step.value = 2
  if (import.meta.client) window.scrollTo({ top: 0 })
}

async function placeOrder() {
  if (placing.value) return
  placing.value = true
  placeError.value = ''
  try {
    const order = await $fetch('/api/orders', {
      method: 'POST',
      body: {
        customer: { ...form },
        items: cart.items.map(i => ({ productId: i.productId, qty: i.qty })),
      },
    })
    cart.setLastOrder({ ...order, firstName: form.firstName })
    cart.clear()
    await navigateTo('/confirmation')
  } catch (e: any) {
    // e.data.statusMessage keeps the original text — e.statusMessage comes from the
    // HTTP reason phrase, which h3 strips of non-ASCII (every product name has an en dash)
    placeError.value = e?.data?.statusMessage ?? e?.data?.message ?? e?.statusMessage
      ?? e?.message ?? 'Something went wrong placing your order.'
  } finally {
    placing.value = false
  }
}

const inputClass = (key: string) =>
  `h-[50px] w-full rounded-[10px] border bg-cream px-4 text-[15px] outline-none transition-colors focus:border-terra focus:border-2 focus:bg-white ${
    errors[key] ? 'border-status-canceled' : 'border-line'
  }`
</script>

<template>
  <div class="flex min-h-screen flex-col bg-cream">
    <!-- ===== dark band: minimal header + steps ===== -->
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

      <!-- step indicator -->
      <div class="relative mt-6 flex items-center justify-center gap-3">
        <div class="flex items-center gap-2.5">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold"
            :class="step === 1 ? 'bg-terra text-white' : 'bg-status-marked text-white'"
          >
            <template v-if="step === 1">1</template>
            <Icon v-else name="Check" :size="15" :stroke-width="3" />
          </span>
          <span class="text-sm" :class="step === 1 ? 'font-semibold text-cream' : 'text-[#EFE4D8]/55'">
            <span class="hidden md:inline">Contact &amp; shipping</span><span class="md:hidden">Shipping</span>
          </span>
        </div>
        <span class="h-px w-10 md:w-[76px]" :class="step === 2 ? 'bg-terra' : 'bg-[#EFE4D8]/30'" />
        <div class="flex items-center gap-2.5">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold"
            :class="step === 2 ? 'bg-terra text-white' : 'border border-[#EFE4D8]/35 text-[#EFE4D8]/70'"
          >2</span>
          <span class="text-sm" :class="step === 2 ? 'font-semibold text-cream' : 'text-[#EFE4D8]/55'">Payment</span>
        </div>
      </div>
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
        <!-- ===== STEP 1 ===== -->
        <template v-if="step === 1">
          <h2 class="font-display text-[24px] font-semibold">Contact &amp; shipping</h2>

          <form class="mt-7 space-y-5" novalidate @submit.prevent="continueToPayment">
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

            <div class="flex justify-end pt-2">
              <button type="submit" class="btn-primary w-full md:w-auto">Continue to payment →</button>
            </div>
          </form>
        </template>

        <!-- ===== STEP 2 ===== -->
        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <h2 class="font-display text-[24px] font-semibold">Payment</h2>
            <span class="mono-label rounded-full border border-[#EAD9AE] bg-[#FBF3E1] px-3 py-1 text-[10px] font-semibold text-[#9A7217]">
              DEMO — NO REAL CHARGE
            </span>
          </div>

          <p class="mt-5 rounded-[10px] bg-cream px-4 py-3.5 text-[13px] leading-relaxed text-muted">
            This is a design prototype. The fields below are dummies — nothing is stored or charged.
          </p>

          <form class="mt-6 space-y-5" novalidate @submit.prevent="placeOrder">
            <div>
              <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="cardName">NAME ON CARD</label>
              <input id="cardName" v-model="payment.name" :class="inputClass('cardName')" :placeholder="`${form.firstName} ${form.lastName}`.trim()">
            </div>
            <div>
              <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="cardNumber">CARD NUMBER</label>
              <input id="cardNumber" v-model="payment.card" :class="inputClass('cardNumber') + ' font-mono'" placeholder="4242 4242 4242 4242" inputmode="numeric">
            </div>
            <div class="grid grid-cols-2 gap-5">
              <div>
                <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="expiry">EXPIRY</label>
                <input id="expiry" v-model="payment.expiry" :class="inputClass('expiry') + ' font-mono'" placeholder="08 / 29">
              </div>
              <div>
                <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="cvc">CVC</label>
                <input id="cvc" v-model="payment.cvc" :class="inputClass('cvc') + ' font-mono'" placeholder="123" inputmode="numeric">
              </div>
            </div>

            <p v-if="placeError" class="rounded-[10px] bg-status-canceled-bg px-4 py-3 text-[13px] text-status-canceled-text">
              {{ placeError }}
            </p>

            <div class="flex flex-col-reverse md:flex-row items-center justify-between gap-4 pt-2">
              <button type="button" class="text-sm font-medium text-terra hover:text-terra-dark" @click="step = 1">
                ← Back to shipping
              </button>
              <button type="submit" class="btn-primary w-full md:w-auto" :disabled="placing" :class="placing ? 'opacity-70 pointer-events-none' : ''">
                {{ placing ? 'Placing order…' : `Place order — ${fmtPrice(cart.totalCents)}` }}
              </button>
            </div>
          </form>
        </template>
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

          <div v-if="step === 2" class="mt-6 border-t border-[#EFE4D8]/18 pt-5">
            <p class="mono-label text-[10px] font-medium text-[#EFE4D8]/55">SHIPS TO</p>
            <p class="mt-2 text-sm leading-relaxed text-[#EFE4D8]/80">
              {{ form.firstName }} {{ form.lastName }}<br>
              {{ form.street }}<br>
              {{ form.zip }} {{ form.city }}, {{ form.country }}
            </p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
