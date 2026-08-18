<script setup lang="ts">
import type { EoOrder } from '~~/shared/types/directus'

const props = defineProps<{ order: Pick<EoOrder, 'order_number' | 'customer_name'> }>()

const emit = defineEmits<{
  confirm: [payload: { reason: string | null; note: string | null }]
  close: []
}>()

// the dialog owns nothing but its own draft — the order is never touched here
const selected = ref<string | null>(null)
const note = ref('')

function toggle(key: string) {
  // clicking the active pill clears it again, so "no reason" stays reachable
  selected.value = selected.value === key ? null : key
}

function confirm() {
  emit('confirm', {
    reason: selected.value,
    note: note.value.trim() || null,
  })
}

const shortNo = computed(() => {
  const n = props.order.order_number
  return '#' + (n.split('-').pop() ?? n)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

const panel = ref<HTMLElement | null>(null)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
  panel.value?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" appear>
      <div class="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-5">
        <!-- backdrop -->
        <div class="absolute inset-0 bg-espresso/40" @click="emit('close')" />

        <!-- panel -->
        <div
          ref="panel"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          class="dialog-panel card relative max-h-full w-full sm:max-w-[460px] overflow-y-auto rounded-b-none sm:rounded-b-card p-6 outline-none"
          style="box-shadow: 0 26px 56px rgba(46, 33, 26, .28)"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 id="cancel-dialog-title" class="font-display text-[22px] font-semibold leading-snug">
                Cancel order {{ shortNo }}?
              </h2>
              <p class="mt-1.5 text-[13px] leading-relaxed text-muted">
                {{ order.customer_name }} gets an email about this. A reason is optional — pick one
                to explain why.
              </p>
            </div>
            <button
              class="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-terra hover:text-terra"
              aria-label="Close"
              @click="emit('close')"
            >
              <Icon name="X" :size="15" :stroke-width="2" />
            </button>
          </div>

          <!-- reasons -->
          <p class="mono-label mt-6 text-[10px] font-semibold text-muted">REASON (OPTIONAL)</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="r in CANCEL_REASONS"
              :key="r.key"
              type="button"
              :aria-pressed="selected === r.key"
              class="min-h-9 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors"
              :class="selected === r.key
                ? 'border-status-canceled bg-status-canceled text-white'
                : 'border-line text-muted hover:border-terra hover:text-terra'"
              @click="toggle(r.key)"
            >
              {{ r.label }}
            </button>
          </div>
          <p class="mt-2.5 text-[12px] leading-relaxed text-muted">
            <template v-if="selected">
              Tap the selected reason again to remove it.
            </template>
            <template v-else>
              No reason selected — that's fine, the email will simply say the order was canceled.
            </template>
          </p>

          <!-- note -->
          <label class="mono-label mt-6 block text-[10px] font-semibold text-muted" for="cancel-note">
            NOTE (OPTIONAL)
          </label>
          <textarea
            id="cancel-note"
            v-model="note"
            rows="3"
            maxlength="500"
            placeholder="Anything you want to add for the customer…"
            class="mt-3 w-full resize-none rounded-xl border border-line bg-cream px-3.5 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted focus:border-terra"
          />
          <p class="mono-label mt-1.5 text-right text-[10px] text-muted">{{ note.length }}/500</p>

          <!-- actions -->
          <div class="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            <button type="button" class="btn-ghost-light justify-center" @click="emit('close')">
              Back
            </button>
            <button
              type="button"
              class="inline-flex h-11 items-center justify-center rounded-full bg-status-canceled px-6 text-sm font-semibold text-white transition-colors hover:bg-status-canceled-text"
              @click="confirm"
            >
              Cancel order
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* entry only — the parent drops the component with v-if, so there is no leave phase */
.dialog-enter-active { transition: opacity 0.2s ease-out; }
.dialog-enter-active .dialog-panel { transition: transform 0.2s ease-out; }
.dialog-enter-from { opacity: 0; }
.dialog-enter-from .dialog-panel { transform: translateY(12px); }

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active .dialog-panel { transition: none; }
  .dialog-enter-from .dialog-panel { transform: none; }
}
</style>
