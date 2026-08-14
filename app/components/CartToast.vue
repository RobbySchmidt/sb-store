<script setup lang="ts">
const cart = useCartStore()
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div
        v-if="cart.toast.visible"
        class="fixed bottom-5 left-5 lg:bottom-14 lg:left-14 z-[60] flex items-center gap-3.5 rounded-[14px] bg-white px-[18px] py-3.5"
        style="box-shadow: var(--shadow-toast)"
      >
        <span class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-status-marked text-white">
          <Icon name="Check" :size="14" :stroke-width="3" />
        </span>
        <div>
          <p class="mono-label text-[9px] font-semibold text-muted">ADDED TO CART</p>
          <p class="text-sm font-semibold text-espresso">{{ cart.toast.name }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(10px); }

@media (prefers-reduced-motion: reduce) {
  .toast-enter-from, .toast-leave-to { transform: none; }
}
</style>
