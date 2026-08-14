export default defineNuxtPlugin(() => {
  useCartStore().hydrate()
})
