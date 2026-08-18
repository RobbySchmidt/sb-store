<script setup lang="ts">
const { profile, landingPath } = useProfile()

// already signed in? the middleware bounces to /admin or /account before paint
definePageMeta({ middleware: 'redirect-if-signed-in' })
useHead({ title: 'Create account — Ember & Oak' })

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  if (busy.value) return
  error.value = null

  // mirrors the server's rule, so the obvious case never costs a round trip
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }

  busy.value = true
  try {
    // /api/auth/register signs the new account straight in, so we can route on
    profile.value = await $fetch('/api/auth/register', {
      method: 'POST',
      body: { email: email.value.trim(), password: password.value },
    })
    await navigateTo(landingPath.value)
  } catch (e: any) {
    // e.data.statusMessage keeps the original text — e.statusMessage is the
    // HTTP reason phrase, which h3 strips of non-ASCII
    error.value = e?.data?.statusMessage ?? e?.data?.message ?? 'Could not create your account.'
  } finally {
    busy.value = false
  }
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
          <p class="mt-1.5 text-[13px] text-muted">At least 8 characters.</p>
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
