<template>
  <div class="flex min-h-screen flex-col">
    <StoreHeader />
    <main class="grow">
      <slot />
    </main>
    <StoreFooter :compact="compactFooter" />
    <CartDrawer />
    <CartToast />
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
// full 4-column footer on the homepage, condensed row everywhere else
const compactFooter = computed(() => route.path !== '/')
</script>
