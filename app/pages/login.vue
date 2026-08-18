<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { loadFor, landingPath } = useProfile()

useHead({ title: 'Log in — Ember & Oak' })

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

// already signed in — bounce to wherever this role belongs.
// `sub`, not `id` — useSupabaseUser() returns JWT claims.
onMounted(async () => {
  if (user.value) {
    await loadFor(user.value.sub)
    await navigateTo(landingPath.value)
  }
})

async function submit() {
  if (busy.value) return
  error.value = null
  busy.value = true

  // The Supabase SDK RETURNS an error object rather than throwing an h3
  // error, so this is error.message — not the e.data.statusMessage shape
  // used for our own API routes.
  const { data, error: authError } = await supabase.auth.signInWithPassword({
    email: email.value.trim(),
    password: password.value,
  })
  busy.value = false

  if (authError || !data.user) {
    error.value = authError?.message ?? 'Could not sign you in.'
    return
  }

  // data.user is a real User from the auth SDK — .id is correct here
  await loadFor(data.user.id)
  await navigateTo(landingPath.value)
}

const inputClass =
  'h-[50px] w-full rounded-[10px] border border-line bg-cream px-4 text-[15px] outline-none transition-colors focus:border-terra focus:border-2 focus:bg-white'
</script>

<template>
  <div class="mx-auto w-full max-w-[440px] px-5 py-14 md:py-20">
    <h1 class="text-center font-display text-[30px] md:text-[34px] font-semibold">Welcome back</h1>
    <p class="mt-2 text-center text-[15px] text-muted">Sign in to see your orders.</p>

    <div class="card mt-8 p-6 md:p-8">
      <form class="space-y-5" novalidate @submit.prevent="submit">
        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="email">EMAIL</label>
          <input id="email" v-model="email" type="email" autocomplete="email" :class="inputClass">
        </div>

        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="password">PASSWORD</label>
          <input id="password" v-model="password" type="password" autocomplete="current-password" :class="inputClass">
        </div>

        <p v-if="error" class="text-[13px] text-status-canceled">{{ error }}</p>

        <button type="submit" class="btn-primary w-full" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>

    <p class="mt-6 text-center text-[15px] text-muted">
      No account yet?
      <NuxtLink to="/register" class="font-medium text-terra hover:underline">Create one</NuxtLink>
    </p>
  </div>
</template>
