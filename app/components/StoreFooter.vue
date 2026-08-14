<script setup lang="ts">
defineProps<{ compact?: boolean }>()
const year = new Date().getFullYear()
</script>

<template>
  <footer class="bg-deepbrown text-[#EFE4D8]">
    <!-- compact: single-row variant -->
    <div v-if="compact" class="mx-auto max-w-[1440px] px-5 md:px-6 lg:px-14 py-8 flex flex-col md:flex-row items-center justify-between gap-5">
      <NuxtLink to="/" class="flex items-center gap-2.5">
        <span class="h-2.5 w-2.5 rounded-full bg-terra" />
        <span class="font-display text-[19px] font-semibold text-cream">Ember &amp; Oak</span>
      </NuxtLink>
      <nav class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        <NuxtLink to="/shop?category=coffee" class="hover:text-ember transition-colors">Coffee</NuxtLink>
        <NuxtLink to="/shop?category=pantry" class="hover:text-ember transition-colors">Pantry</NuxtLink>
        <NuxtLink to="/shop?category=accessories" class="hover:text-ember transition-colors">Accessories</NuxtLink>
        <a href="#" class="hover:text-ember transition-colors">Our story</a>
        <a href="#" class="hover:text-ember transition-colors">Contact</a>
      </nav>
      <p class="mono-label text-[10px] text-[#EFE4D8]/50">© {{ year }} · FREE EU SHIPPING OVER €49</p>
    </div>

    <!-- full variant -->
    <div v-else class="mx-auto max-w-[1440px] px-5 md:px-6 lg:px-14 pt-14 pb-8">
      <div class="grid grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-8 gap-y-10">
        <div class="col-span-2 lg:col-span-1">
          <NuxtLink to="/" class="flex items-center gap-2.5">
            <span class="h-2.5 w-2.5 rounded-full bg-terra" />
            <span class="font-display text-[21px] font-semibold text-cream">Ember &amp; Oak</span>
          </NuxtLink>
          <p class="mt-4 max-w-[36ch] text-sm leading-relaxed text-[#EFE4D8]/70">
            A small-batch roastery and pantry in the old tannery quarter.
            Roasted Tuesdays, shipped Wednesdays.
          </p>
        </div>

        <div>
          <h4 class="mono-label text-[10px] font-medium tracking-[0.14em] text-[#EFE4D8]/50">Shop</h4>
          <ul class="mt-4 space-y-2.5 text-sm">
            <li><NuxtLink to="/shop?category=coffee" class="hover:text-ember transition-colors">Coffee</NuxtLink></li>
            <li><NuxtLink to="/shop?category=pantry" class="hover:text-ember transition-colors">Pantry</NuxtLink></li>
            <li><NuxtLink to="/shop?category=accessories" class="hover:text-ember transition-colors">Accessories</NuxtLink></li>
            <li><NuxtLink to="/shop" class="hover:text-ember transition-colors">All products</NuxtLink></li>
          </ul>
        </div>

        <div>
          <h4 class="mono-label text-[10px] font-medium tracking-[0.14em] text-[#EFE4D8]/50">House</h4>
          <ul class="mt-4 space-y-2.5 text-sm">
            <li><a href="#" class="hover:text-ember transition-colors">Our story</a></li>
            <li><a href="#" class="hover:text-ember transition-colors">Wholesale</a></li>
            <li><a href="#" class="hover:text-ember transition-colors">Contact</a></li>
          </ul>
        </div>

        <div>
          <h4 class="mono-label text-[10px] font-medium tracking-[0.14em] text-[#EFE4D8]/50">Help</h4>
          <ul class="mt-4 space-y-2.5 text-sm">
            <li><a href="#" class="hover:text-ember transition-colors">Shipping &amp; returns</a></li>
            <li><a href="#" class="hover:text-ember transition-colors">FAQ</a></li>
            <li><a href="#" class="hover:text-ember transition-colors">Brew guides</a></li>
          </ul>
        </div>
      </div>

      <div class="mt-12 flex flex-col md:flex-row items-center justify-between gap-3 border-t border-[#EFE4D8]/15 pt-6">
        <p class="mono-label text-[10px] text-[#EFE4D8]/50">© {{ year }} EMBER &amp; OAK ROASTERY GMBH</p>
        <p class="mono-label text-[10px] text-[#EFE4D8]/50">PRICES INCL. VAT · FREE SHIPPING OVER €49</p>
      </div>
    </div>
  </footer>
</template>
