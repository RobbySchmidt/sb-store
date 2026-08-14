<script setup lang="ts">
const cart = useCartStore()
const route = useRoute()
const menuOpen = ref(false)
const batch = batchInfo()

const navLinks = [
  { label: 'Shop', to: '/shop' },
  { label: 'About', to: '#' },
  { label: 'Brew guides', to: '#' },
]

watch(() => route.fullPath, () => { menuOpen.value = false })
</script>

<template>
  <div class="bg-espresso">
    <!-- announcement bar -->
    <div class="bg-black/25 py-2 px-4 text-center">
      <p class="mono-label text-[11px] font-medium text-[#EFE4D8]/80">
        BATCH № {{ batch.number }} ROASTED {{ batch.roastedShort }} · FREE EU SHIPPING OVER €49
      </p>
    </div>

    <!-- sticky header -->
    <header class="sticky top-0 z-40 bg-espresso border-b border-[#EFE4D8]/16">
      <div class="mx-auto flex h-[62px] md:h-[68px] lg:h-[84px] max-w-[1440px] items-center justify-between px-5 md:px-6 lg:px-14">
        <!-- burger (mobile/tablet) -->
        <button
          class="flex lg:hidden h-11 w-11 items-center justify-center -ml-2"
          aria-label="Menu"
          @click="menuOpen = !menuOpen"
        >
          <Icon :name="menuOpen ? 'X' : 'Menu'" :size="22" color="#EFE4D8" :stroke-width="2" />
        </button>

        <!-- logo -->
        <NuxtLink to="/" class="flex items-center gap-2.5 lg:-ml-0 absolute left-1/2 -translate-x-1/2 lg:static lg:translate-x-0">
          <span class="h-2.5 w-2.5 rounded-full bg-terra shrink-0" />
          <span class="font-display text-[20px] lg:text-[23px] font-semibold text-cream whitespace-nowrap">Ember &amp; Oak</span>
        </NuxtLink>

        <!-- desktop nav -->
        <nav class="hidden lg:flex items-center gap-8">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.label"
            :to="link.to"
            class="text-sm font-medium transition-colors"
            :class="route.path.startsWith(link.to) && link.to !== '#'
              ? 'text-ember'
              : 'text-[#EFE4D8] hover:text-ember'"
          >
            {{ link.label }}
          </NuxtLink>
          <button
            class="flex items-center gap-2.5 rounded-full border border-[#EFE4D8]/32 px-[17px] py-[9px] text-sm font-medium text-[#EFE4D8] transition-colors hover:border-ember hover:text-ember"
            @click="cart.drawerOpen = true"
          >
            Cart
            <span class="flex h-5 min-w-5 items-center justify-center rounded-full bg-terra px-1 text-[11px] font-bold text-white">
              {{ cart.itemCount }}
            </span>
          </button>
        </nav>

        <!-- cart icon (mobile/tablet) -->
        <button
          class="relative flex lg:hidden h-11 w-11 items-center justify-center -mr-2"
          aria-label="Cart"
          @click="cart.drawerOpen = true"
        >
          <Icon name="ShoppingBag" :size="22" color="#EFE4D8" :stroke-width="2" />
          <span
            v-if="cart.itemCount > 0"
            class="absolute right-0 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-terra px-1 text-[11px] font-bold text-white"
          >
            {{ cart.itemCount }}
          </span>
        </button>
      </div>

      <!-- mobile menu -->
      <Transition name="menu">
        <nav v-if="menuOpen" class="lg:hidden border-t border-[#EFE4D8]/16 bg-espresso px-5 py-3">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.label"
            :to="link.to"
            class="block py-3 text-[15px] font-medium min-h-11"
            :class="route.path.startsWith(link.to) && link.to !== '#' ? 'text-ember' : 'text-[#EFE4D8]'"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>
      </Transition>
    </header>
  </div>
</template>

<style scoped>
.menu-enter-active, .menu-leave-active { transition: opacity 0.15s; }
.menu-enter-from, .menu-leave-to { opacity: 0; }
</style>
