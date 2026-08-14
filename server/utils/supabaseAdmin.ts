import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/** Service-role client — bypasses RLS. Server-side only. */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY missing in env')
    client = createClient(url, key, { auth: { persistSession: false } })
  }
  return client
}
