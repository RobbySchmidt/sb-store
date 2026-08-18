<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { loadFor, landingPath } = useProfile()

useHead({ title: 'Create account — Ember & Oak' })

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

// `sub`, not `id` — useSupabaseUser() returns JWT claims
onMounted(async () => {
  if (user.value) {
    await loadFor(user.value.sub)
    await navigateTo(landingPath.value)
  }
})

async function submit() {
  if (busy.value) return
  error.value = null

  if (password.value.length < 6) {
    error.value = 'Password must be at least 6 characters.'
    return
  }

  busy.value = true
  // Confirm-email is off on this project, so signUp returns a live session
  // and we can route straight on. Same SDK error shape as login.
  const { data, error: authError } = await supabase.auth.signUp({
    email: email.value.trim(),
    password: password.value,
  })
  busy.value = false

  if (authError || !data.user) {
    error.value = authError?.message ?? 'Could not create your account.'
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
    <h1 class="text-center font-display text-[30px] md:text-[34px] font-semibold">Create your account</h1>
    <p class="mt-2 text-center text-[15px] text-muted">So your orders have somewhere to live.</p>

    <div class="card mt-8 p-6 md:p-8">
      <form class="space-y-5" novalidate @submit.prevent="submit">
        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="email">EMAIL</label>
          <input id="email" v-model="email" type="email" autocomplete="email" :class="inputClass">
        </div>

        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="password">PASSWORD</label>
          <input id="password" v-model="password" type="password" autocomplete="new-password" :class="inputClass">
          <p class="mt-1.5 text-[13px] text-muted">At least 6 characters.</p>
        </div>

        <p v-if="error" class="text-[13px] text-status-canceled">{{ error }}</p>

        <button type="submit" class="btn-primary w-full" :disabled="busy">
          {{ busy ? 'Creating…' : 'Create account' }}
        </button>
      </form>
    </div>

    <p class="mt-6 text-center text-[15px] text-muted">
      Already have one?
      <NuxtLink to="/login" class="font-medium text-terra hover:underline">Sign in</NuxtLink>
    </p>
  </div>
</template>
