<script setup lang="ts">
/**
 * The Ember & Oak roast stamp: circular bean photo wrapped in a slowly
 * rotating ring of type, next to the Fraunces wordmark.
 */
withDefaults(defineProps<{
  /** stamp diameter in px */
  size?: number
  /** hide the wordmark, stamp only */
  stampOnly?: boolean
}>(), { size: 52, stampOnly: false })

const STAMP_IMG = 'https://hgnmtnjrfchfpvxlinqn.supabase.co/storage/v1/object/public/product-images/ember-blend-dark-roast.jpg'
</script>

<template>
  <span class="flex items-center gap-3">
    <span class="relative block shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
      <svg viewBox="0 0 100 100" class="stamp-ring absolute inset-0 h-full w-full" style="overflow: visible">
        <defs>
          <path id="stamp-circle" d="M50,50 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0" />
        </defs>
        <text class="fill-ember font-mono" style="font-size: 9.8px; letter-spacing: 0.3em;">
          <textPath href="#stamp-circle">EMBER &amp; OAK · ROASTED TUESDAYS · </textPath>
        </text>
      </svg>
      <img
        :src="STAMP_IMG"
        alt=""
        class="absolute rounded-full object-cover"
        :style="{
          width: `${size - 2 * Math.round(size * 0.21)}px`,
          height: `${size - 2 * Math.round(size * 0.21)}px`,
          top: `${Math.round(size * 0.21)}px`,
          left: `${Math.round(size * 0.21)}px`,
        }"
      >
    </span>
    <span v-if="!stampOnly" class="font-display text-[20px] lg:text-[23px] font-semibold text-cream whitespace-nowrap">
      Ember &amp; Oak
    </span>
  </span>
</template>

<style scoped>
.stamp-ring {
  animation: stamp-spin 40s linear infinite;
  transform-origin: center;
}
@keyframes stamp-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .stamp-ring { animation: none; }
}
</style>
