<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { profile, isAdmin } = useProfile()
const route = useRoute()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

watch(() => route.fullPath, () => { open.value = false })

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

async function signOut() {
  open.value = false
  await supabase.auth.signOut()
  profile.value = null
  await navigateTo('/')
}

const itemClass =
  'block w-full px-4 py-2.5 text-left text-sm text-espresso transition-colors hover:bg-cream-alt'
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:text-ember"
      :aria-expanded="open"
      aria-haspopup="true"
      aria-label="Account"
      @click="open = !open"
    >
      <Icon name="User" :size="22" color="#EFE4D8" :stroke-width="2" />
    </button>

    <Transition name="acct">
      <div
        v-if="open"
        class="absolute right-0 top-[calc(100%+8px)] z-50 w-[236px] overflow-hidden rounded-xl border border-line bg-white py-1.5 shadow-lg"
      >
        <template v-if="user">
          <p class="truncate border-b border-line px-4 pb-2.5 pt-1.5 text-[13px] text-muted">
            {{ user.email }}
          </p>
          <NuxtLink to="/account" :class="itemClass">My orders</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/admin" :class="itemClass">Admin dashboard</NuxtLink>
          <div class="my-1.5 border-t border-line" />
          <button :class="itemClass" @click="signOut">Sign out</button>
        </template>

        <template v-else>
          <NuxtLink to="/login" :class="itemClass">Log in</NuxtLink>
          <NuxtLink to="/register" :class="itemClass">Create account</NuxtLink>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.acct-enter-active, .acct-leave-active { transition: opacity 0.15s ease-out, transform 0.15s ease-out; }
.acct-enter-from, .acct-leave-to { opacity: 0; transform: translateY(-4px); }

@media (prefers-reduced-motion: reduce) {
  .acct-enter-active, .acct-leave-active { transition: opacity 0.12s; }
  .acct-enter-from, .acct-leave-to { transform: none; }
}
</style>
