<script setup lang="ts">
const { data: catalog } = await useCatalog()
const route = useRoute()
const router = useRouter()

const products = computed(() => catalog.value?.products ?? [])
const categories = computed(() => catalog.value?.categories ?? [])

type SortKey = 'price-asc' | 'price-desc' | 'name-asc'
const sortLabels: Record<SortKey, string> = {
  'price-asc': 'Price, low → high',
  'price-desc': 'Price, high → low',
  'name-asc': 'Name, A → Z',
}

const activeCategory = computed(() => {
  const c = String(route.query.category ?? 'all')
  return categories.value.some(x => x.slug === c) ? c : 'all'
})
const activeSort = computed<SortKey>(() => {
  const s = String(route.query.sort ?? 'price-asc')
  return (s in sortLabels ? s : 'price-asc') as SortKey
})

function setFilter(patch: { category?: string; sort?: string }) {
  const q: Record<string, string> = {}
  const category = patch.category ?? activeCategory.value
  const sort = patch.sort ?? activeSort.value
  if (category !== 'all') q.category = category
  if (sort !== 'price-asc') q.sort = sort
  router.replace({ query: q })
}

const filtered = computed(() => {
  let list = [...products.value]
  if (activeCategory.value !== 'all') {
    const cat = categories.value.find(c => c.slug === activeCategory.value)
    list = list.filter(p => p.category_id === cat?.id)
  }
  switch (activeSort.value) {
    case 'price-asc': list.sort((a, b) => a.price_cents - b.price_cents); break
    case 'price-desc': list.sort((a, b) => b.price_cents - a.price_cents); break
    case 'name-asc': list.sort((a, b) => a.name.localeCompare(b.name)); break
  }
  return list
})

function categoryCount(id: string) {
  return products.value.filter(p => p.category_id === id).length
}

const sortOpen = ref(false)
const sortRef = ref<HTMLElement>()
onMounted(() => {
  document.addEventListener('click', (e) => {
    if (sortRef.value && !sortRef.value.contains(e.target as Node)) sortOpen.value = false
  })
})

useHead({ title: 'Shop — Ember & Oak' })
</script>

<template>
  <div class="pb-16 lg:pb-24">
    <!-- ===== dark band ===== -->
    <section class="relative overflow-hidden bg-espresso pb-[104px] text-cream">
      <span class="ember-glow -right-52 -top-64 h-[700px] w-[700px]" />
      <div class="relative mx-auto flex max-w-[1440px] items-end justify-between gap-10 px-5 md:px-6 lg:px-14 pt-10 lg:pt-16">
        <div>
          <p class="mono-label text-xs font-medium tracking-[0.18em] text-ember">
            THE SHOP · {{ products.length }} PRODUCTS
          </p>
          <h1 class="mt-4 max-w-[16ch] font-display text-[32px] md:text-[40px] lg:text-[60px] font-semibold leading-[1.05] tracking-[-0.02em]">
            Everything roasted, jarred and packed in-house.
          </h1>
        </div>
        <p class="hidden lg:block max-w-[34ch] pb-2 text-sm leading-relaxed text-[#EFE4D8]/65 text-right">
          Four coffees, four pantry goods and the gear we actually use.
          Whatever you order was made this week.
        </p>
      </div>
    </section>

    <!-- ===== floating filter bar ===== -->
    <div class="relative mx-auto -mt-[58px] max-w-[1440px] px-5 md:px-6 lg:px-14">
      <div class="card flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-5 py-4" style="box-shadow: 0 14px 34px rgba(46,33,26,.12)">
        <!-- category pills -->
        <div class="flex gap-2 overflow-x-auto pb-1 lg:pb-0 -mx-1 px-1">
          <button
            class="flex min-h-11 lg:min-h-0 shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors"
            :class="activeCategory === 'all'
              ? 'bg-espresso text-cream'
              : 'border border-line text-espresso hover:border-terra hover:text-terra'"
            @click="setFilter({ category: 'all' })"
          >
            All <span :class="activeCategory === 'all' ? 'text-cream/70' : 'text-muted'">{{ products.length }}</span>
          </button>
          <button
            v-for="c in categories"
            :key="c.id"
            class="flex min-h-11 lg:min-h-0 shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors"
            :class="activeCategory === c.slug
              ? 'bg-espresso text-cream'
              : 'border border-line text-espresso hover:border-terra hover:text-terra'"
            @click="setFilter({ category: c.slug })"
          >
            {{ c.name }} <span :class="activeCategory === c.slug ? 'text-cream/70' : 'text-muted'">{{ categoryCount(c.id) }}</span>
          </button>
        </div>

        <!-- sort -->
        <div ref="sortRef" class="relative shrink-0">
          <button
            class="flex min-h-11 lg:min-h-0 w-full lg:w-auto items-center justify-between lg:justify-start gap-3 rounded-full bg-cream px-5 py-2.5 text-sm"
            @click="sortOpen = !sortOpen"
          >
            <span class="mono-label text-[10px] font-medium text-muted">SORT</span>
            <span class="font-semibold">{{ sortLabels[activeSort] }}</span>
            <Icon name="ChevronDown" :size="15" :stroke-width="2" class="transition-transform" :class="sortOpen ? 'rotate-180' : ''" />
          </button>
          <Transition name="menu">
            <div v-if="sortOpen" class="card absolute right-0 top-[calc(100%+8px)] z-20 min-w-[220px] overflow-hidden py-1.5">
              <button
                v-for="(label, key) in sortLabels"
                :key="key"
                class="block w-full px-5 py-2.5 text-left text-sm transition-colors hover:bg-cream"
                :class="key === activeSort ? 'font-semibold text-terra' : ''"
                @click="setFilter({ sort: key }); sortOpen = false"
              >
                {{ label }}
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <!-- ===== grid ===== -->
      <div v-if="filtered.length" class="mt-7 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-[22px]">
        <ProductCard v-for="p in filtered" :key="p.id" :product="p" />
      </div>

      <!-- ===== empty state ===== -->
      <div v-else class="relative mt-7 overflow-hidden rounded-[14px] bg-espresso px-8 py-16 text-center" style="box-shadow: var(--shadow-card)">
        <span class="ember-glow -right-32 -top-40 h-[460px] w-[460px]" />
        <div class="relative mx-auto flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#EFE4D8]/8">
          <Icon name="Package" :size="42" color="#E4A07F" :stroke-width="1.5" />
        </div>
        <h2 class="relative mt-6 font-display text-[28px] font-semibold text-cream">Nothing on this shelf</h2>
        <p class="relative mx-auto mt-3 max-w-[40ch] text-sm leading-[1.65] text-[#EFE4D8]/70">
          No products match your filters right now. New batches land every
          Tuesday — try another shelf in the meantime.
        </p>
        <button class="btn-primary relative mt-7" @click="setFilter({ category: 'all' })">Clear filters</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-enter-active, .menu-leave-active { transition: opacity 0.15s, transform 0.15s; }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
