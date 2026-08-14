<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: number
  /** 'light' = cream pill on white, 'dark' = translucent pill on espresso */
  variant?: 'light' | 'dark'
  /** control size in px (min tap target) */
  size?: number
}>(), { variant: 'light', size: 44 })

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function step(delta: number) {
  emit('update:modelValue', props.modelValue + delta)
}
</script>

<template>
  <div
    class="inline-flex items-center rounded-full border"
    :class="variant === 'dark'
      ? 'border-[#EFE4D8]/22 bg-[#EFE4D8]/8 text-cream'
      : 'border-line bg-cream text-espresso'"
  >
    <button
      class="flex items-center justify-center rounded-full transition-opacity hover:opacity-70"
      :style="{ width: `${size}px`, height: `${size}px` }"
      aria-label="Decrease quantity"
      @click="step(-1)"
    >
      <Icon name="Minus" :size="15" :stroke-width="2" />
    </button>
    <span class="min-w-6 text-center text-sm font-semibold tabular-nums">{{ modelValue }}</span>
    <button
      class="flex items-center justify-center rounded-full transition-opacity hover:opacity-70"
      :style="{ width: `${size}px`, height: `${size}px` }"
      aria-label="Increase quantity"
      @click="step(1)"
    >
      <Icon name="Plus" :size="15" :stroke-width="2" />
    </button>
  </div>
</template>
