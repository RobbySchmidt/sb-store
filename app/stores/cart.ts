import { defineStore } from 'pinia'
import type { CartItem } from '~/types/shop'
import type { CatalogProduct } from '~/composables/useShop'
import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '~~/shared/utils/shop'

const STORAGE_KEY = 'eo-cart'
const LAST_ORDER_KEY = 'eo-last-order'

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([])
  const drawerOpen = ref(false)
  const toast = ref<{ visible: boolean; name: string }>({ visible: false, name: '' })
  const lastOrder = ref<any>(null)

  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let hydrated = false

  function hydrate() {
    if (!import.meta.client || hydrated) return
    hydrated = true
    try {
      items.value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    } catch { items.value = [] }
    try {
      lastOrder.value = JSON.parse(sessionStorage.getItem(LAST_ORDER_KEY) ?? 'null')
    } catch { lastOrder.value = null }
  }

  watch(items, (v) => {
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  }, { deep: true })

  const itemCount = computed(() => items.value.reduce((n, i) => n + i.qty, 0))
  const subtotalCents = computed(() => items.value.reduce((n, i) => n + i.qty * i.unitPriceCents, 0))
  const shippingCents = computed(() =>
    subtotalCents.value === 0 || subtotalCents.value >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_FLAT_CENTS)
  const totalCents = computed(() => subtotalCents.value + shippingCents.value)
  const freeShippingUnlocked = computed(() => subtotalCents.value >= FREE_SHIPPING_CENTS)
  const remainingToFreeCents = computed(() => Math.max(0, FREE_SHIPPING_CENTS - subtotalCents.value))
  const freeShippingProgress = computed(() =>
    Math.min(100, Math.round((subtotalCents.value / FREE_SHIPPING_CENTS) * 100)))

  function add(product: CatalogProduct, qty = 1) {
    const existing = items.value.find(i => i.productId === product.id)
    const inCart = existing?.qty ?? 0
    // never let the cart hold more than the shop can actually ship
    const next = Math.min(inCart + qty, product.stock_available ?? Infinity)
    if (next <= inCart) {
      drawerOpen.value = true // nothing was added — open the cart so it's visible why
      return
    }
    if (existing) existing.qty = next
    else items.value.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents: product.price_cents,
      image: product.image,
      qty: next,
    })
    showToast(product.name)
    drawerOpen.value = true
  }

  function setQty(productId: string, qty: number) {
    const item = items.value.find(i => i.productId === productId)
    if (!item) return
    if (qty < 1) remove(productId)
    else item.qty = qty
  }

  function remove(productId: string) {
    items.value = items.value.filter(i => i.productId !== productId)
  }

  function clear() { items.value = [] }

  function showToast(name: string) {
    toast.value = { visible: true, name }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.value.visible = false }, 3000)
  }

  function setLastOrder(order: any) {
    lastOrder.value = order
    if (import.meta.client) sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order))
  }

  return {
    items, drawerOpen, toast, lastOrder,
    itemCount, subtotalCents, shippingCents, totalCents,
    freeShippingUnlocked, remainingToFreeCents, freeShippingProgress,
    hydrate, add, setQty, remove, clear, showToast, setLastOrder,
  }
})
