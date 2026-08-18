<script setup lang="ts">
const cart = useCartStore()
const route = useRoute()
const menuOpen = ref(false)
const batch = batchInfo()

const { profile, isAdmin, signOut } = useProfile()

async function signOutFromMenu() {
  menuOpen.value = false
  await signOut()
}

const navLinks = [
  { label: 'Shop', to: '/shop' },
  { label: 'About', to: '#' },
  { label: 'Brew guides', to: '#' },
]

const shelfLinks = [
  { label: 'Coffee', to: '/shop?category=coffee' },
  { label: 'Pantry', to: '/shop?category=pantry' },
  { label: 'Accessories', to: '/shop?category=accessories' },
]

watch(() => route.fullPath, () => { menuOpen.value = false })

// lock body scroll while the mobile nav is open
watch(menuOpen, (open) => {
  if (import.meta.client) document.body.style.overflow = open ? 'hidden' : ''
})
onUnmounted(() => {
  if (import.meta.client) document.body.style.overflow = ''
})

function openCartFromMenu() {
  menuOpen.value = false
  cart.drawerOpen = true
}
</script>

<template>
  <!-- announcement bar (scrolls away) -->
  <div class="bg-espresso">
    <div class="bg-black/25 py-2 px-4 text-center">
      <p class="mono-label text-[11px] font-medium text-[#EFE4D8]/80">
        BATCH № {{ batch.number }} ROASTED {{ batch.roastedShort }} · FREE EU SHIPPING OVER €49
      </p>
    </div>
  </div>

  <!-- sticky header -->
  <header class="sticky top-0 z-40 bg-espresso border-b border-[#EFE4D8]/16">
    <div class="mx-auto flex h-[62px] md:h-[68px] lg:h-[84px] max-w-[1440px] items-center justify-between px-5 md:px-6 lg:px-14">
      <!-- burger (mobile/tablet) -->
      <button
        class="flex lg:hidden h-11 w-11 items-center justify-center -ml-2"
        aria-label="Open menu"
        @click="menuOpen = true"
      >
        <Icon name="Menu" :size="22" color="#EFE4D8" :stroke-width="2" />
      </button>

      <!-- logo -->
      <NuxtLink to="/" class="absolute left-1/2 -translate-x-1/2 lg:static lg:translate-x-0">
        <BrandMark :size="48" />
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
        <AccountMenu />
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
  </header>

  <!-- full-screen mobile nav, slides in from the left -->
  <Teleport to="body">
    <Transition name="mnav">
      <div v-if="menuOpen" class="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-espresso lg:hidden">
        <span class="ember-glow -left-40 -bottom-48 h-[560px] w-[560px]" />

        <!-- top row mirrors the header -->
        <div class="relative flex h-[62px] md:h-[68px] shrink-0 items-center justify-between border-b border-[#EFE4D8]/16 px-5 md:px-6">
          <button
            class="flex h-11 w-11 items-center justify-center -ml-2"
            aria-label="Close menu"
            @click="menuOpen = false"
          >
            <Icon name="X" :size="22" color="#EFE4D8" :stroke-width="2" />
          </button>
          <NuxtLink to="/" class="absolute left-1/2 -translate-x-1/2">
            <BrandMark :size="48" />
          </NuxtLink>
          <button
            class="relative flex h-11 w-11 items-center justify-center -mr-2"
            aria-label="Cart"
            @click="openCartFromMenu"
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

        <!-- links -->
        <nav class="relative flex grow flex-col justify-center px-8 pb-16">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.label"
            :to="link.to"
            class="py-3.5 font-display text-[34px] font-semibold leading-tight transition-colors"
            :class="route.path.startsWith(link.to) && link.to !== '#' ? 'text-ember' : 'text-cream'"
          >
            {{ link.label }}
          </NuxtLink>

          <p class="mono-label mt-10 text-[10px] font-medium text-[#EFE4D8]/50">THE SHELVES</p>
          <div class="mt-3 flex flex-col">
            <NuxtLink
              v-for="link in shelfLinks"
              :key="link.label"
              :to="link.to"
              class="py-2 text-[17px] font-medium text-[#EFE4D8]/85 transition-colors"
            >
              {{ link.label }}
            </NuxtLink>
          </div>

          <p class="mono-label mt-10 text-[10px] font-medium text-[#EFE4D8]/50">ACCOUNT</p>
          <div class="mt-3 flex flex-col items-start">
            <template v-if="profile">
              <NuxtLink to="/account" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">My orders</NuxtLink>
              <NuxtLink v-if="isAdmin" to="/admin" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">Admin dashboard</NuxtLink>
              <button class="py-2 text-[17px] font-medium text-[#EFE4D8]/85" @click="signOutFromMenu">Sign out</button>
            </template>
            <template v-else>
              <NuxtLink to="/login" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">Log in</NuxtLink>
              <NuxtLink to="/register" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">Create account</NuxtLink>
            </template>
          </div>
        </nav>

        <p class="mono-label relative shrink-0 px-8 pb-8 text-[10px] text-[#EFE4D8]/45">
          BATCH № {{ batch.number }} · ROASTED {{ batch.roastedShort }}
        </p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mnav-enter-active, .mnav-leave-active { transition: transform 0.25s ease-out, opacity 0.25s ease-out; }
.mnav-enter-from, .mnav-leave-to { transform: translateX(-100%); opacity: 0.5; }

@media (prefers-reduced-motion: reduce) {
  .mnav-enter-active, .mnav-leave-active { transition: opacity 0.2s; }
  .mnav-enter-from, .mnav-leave-to { transform: none; opacity: 0; }
}
</style>
