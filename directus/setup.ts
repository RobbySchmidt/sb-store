/**
 * Idempotent Directus schema setup for Ember & Oak.
 *
 * Run with:  yarn directus:setup
 *
 * Creates the role, the file folder, and the four eo_* collections inside the
 * existing Ember_Oak_Shop group. Never touches Cascade_Academy, Robby,
 * shader_presets or anything else on this shared instance.
 *
 * This script is the checked-in, reproducible record of the datastore — it
 * replaces the hand-run supabase/*.sql files. It must stay safely re-runnable,
 * because the repo is worked on from two PCs: a second run has to report only
 * "exists", and must never create a duplicate or rewrite an existing rule.
 */
const URL = (process.env.DIRECTUS_URL || '').replace(/\/$/, '')
const TOKEN = process.env.DIRECTUS_API_TOKEN
if (!URL || !TOKEN) throw new Error('DIRECTUS_URL / DIRECTUS_API_TOKEN missing in env')

const GROUP = 'Ember_Oak_Shop'
const ROLE_NAME = 'Ember & Oak Customer'
const FOLDER_NAME = 'Ember & Oak'

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message ?? res.statusText
    const err: any = new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${msg}`)
    err.status = res.status
    throw err
  }
  return body?.data
}

/** POST that treats "already exists" as success — this is what makes it idempotent. */
async function ensure(path: string, payload: unknown, label: string): Promise<void> {
  try {
    await api(path, { method: 'POST', body: JSON.stringify(payload) })
    console.log(`  created  ${label}`)
  } catch (e: any) {
    if (/already exists|has to be unique|RECORD_NOT_UNIQUE|Duplicate entry/i.test(e.message)) {
      console.log(`  exists   ${label}`)
      return
    }
    throw e
  }
}

/**
 * GET-then-POST, for things Directus does NOT put a unique constraint on.
 * directus_roles.name and directus_folders.name are both non-unique, so the
 * "catch already exists" trick does not work there — a blind POST silently
 * creates a second copy on every run. Relations go through here too, so a
 * re-run can never touch an on_delete rule that is already in place.
 */
async function ensureOnce(
  findPath: string,
  createPath: string,
  payload: unknown,
  label: string,
): Promise<void> {
  const found = await api(findPath).catch((e: any) => {
    // Directus answers "no such relation" with 403, not 404.
    if (e.status === 403 || e.status === 404) return null
    throw e
  })
  if (found && (!Array.isArray(found) || found.length > 0)) {
    console.log(`  exists   ${label}`)
    return
  }
  await api(createPath, { method: 'POST', body: JSON.stringify(payload) })
  console.log(`  created  ${label}`)
}

/** Same contract as ensureOnce, but hands back the row so ids can be chained. */
async function findOrCreate(
  findPath: string,
  createPath: string,
  payload: unknown,
  label: string,
): Promise<any> {
  const found = await api(findPath).catch((e: any) => {
    if (e.status === 403 || e.status === 404) return null
    throw e
  })
  const row = Array.isArray(found) ? found[0] : found
  if (row) {
    console.log(`  exists   ${label}`)
    return row
  }
  const created = await api(createPath, { method: 'POST', body: JSON.stringify(payload) })
  console.log(`  created  ${label}`)
  return created
}

// ---------------------------------------------------------------- builders --

const uuidPk = {
  field: 'id',
  type: 'uuid',
  meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
  schema: { is_primary_key: true, length: 36, has_auto_increment: false },
}

function str(field: string, o: { required?: boolean; unique?: boolean; long?: boolean } = {}) {
  return {
    field,
    type: o.long ? 'text' : 'string',
    meta: {
      interface: o.long ? 'input-multiline' : 'input',
      required: !!o.required,
    },
    schema: { is_nullable: !o.required, is_unique: !!o.unique },
  }
}

function int(field: string, o: { required?: boolean; min?: number; def?: number } = {}) {
  return {
    field,
    type: 'integer',
    meta: {
      interface: 'input',
      required: !!o.required,
      ...(o.min !== undefined ? { validation: { [field]: { _gte: o.min } } } : {}),
    },
    schema: { is_nullable: !o.required, default_value: o.def ?? null },
  }
}

function timestamp(field: string, kind: 'date-created' | 'date-updated') {
  return {
    field,
    type: 'timestamp',
    meta: { special: [kind], interface: 'datetime', readonly: true, hidden: true },
    schema: {},
  }
}

async function createCollection(name: string, icon: string, fields: unknown[]) {
  await ensure('/collections', {
    collection: name,
    meta: { group: GROUP, icon, sort_field: null },
    schema: {},
    fields: [uuidPk],
  }, `collection ${name}`)

  for (const f of fields as any[]) {
    await ensure(`/fields/${name}`, f, `${name}.${f.field}`)
  }
}

/** m2o relation. on_delete is the whole point — get it right. */
async function relate(
  collection: string,
  field: string,
  related: string,
  onDelete: 'CASCADE' | 'SET NULL' | 'NO ACTION',
  oneField: string | null = null,
) {
  await ensureOnce(
    `/relations/${collection}/${field}`,
    '/relations',
    {
      collection,
      field,
      related_collection: related,
      meta: { one_field: oneField, sort_field: null, one_deselect_action: 'nullify' },
      schema: { on_delete: onDelete },
    },
    `relation ${collection}.${field} → ${related} (${onDelete})`,
  )
}

// -------------------------------------------------------------------- main --

async function main() {
  console.log(`Directus setup → ${URL}`)

  // ---- role for shop customers ----
  // Deliberately a NEW role, not the existing "Kunde" — that one belongs to
  // the tour-booking project on this shared instance.
  console.log('\nRole')
  const role = await findOrCreate(
    `/roles?filter[name][_eq]=${encodeURIComponent(ROLE_NAME)}&limit=1`,
    '/roles',
    {
      name: ROLE_NAME,
      icon: 'local_cafe',
      description: 'Customer account for the Ember & Oak shop.',
    },
    `role ${ROLE_NAME}`,
  )

  // ---- policy: the smallest thing that works ----
  // Every bit of shop data is read server-side with the static admin token, so
  // a customer needs no access to eo_* at all — and gets none. The one thing
  // they must be able to read is their OWN email: currentUser() puts it on the
  // session, and /api/account/orders matches it to surface orders placed as a
  // guest before the account existed. Without this permission /users/me returns
  // an id and no email, and that fallback silently stops finding anything.
  //
  // app_access stays false — this is a shop customer, not a Directus user.
  const policy = await findOrCreate(
    `/policies?filter[name][_eq]=${encodeURIComponent(ROLE_NAME)}&limit=1`,
    '/policies',
    {
      name: ROLE_NAME,
      icon: 'local_cafe',
      description: 'Read own email only. All shop data is server-side.',
      admin_access: false,
      app_access: false,
    },
    `policy ${ROLE_NAME}`,
  )

  await ensureOnce(
    `/permissions?filter[policy][_eq]=${policy.id}&filter[collection][_eq]=directus_users&filter[action][_eq]=read&limit=1`,
    '/permissions',
    {
      policy: policy.id,
      collection: 'directus_users',
      action: 'read',
      fields: ['id', 'email'],
      permissions: { id: { _eq: '$CURRENT_USER' } },
    },
    'permission read own directus_users (id, email)',
  )

  await ensureOnce(
    `/access?filter[role][_eq]=${role.id}&filter[policy][_eq]=${policy.id}&limit=1`,
    '/access',
    { role: role.id, policy: policy.id, sort: 1 },
    `policy attached to role ${ROLE_NAME}`,
  )

  // ---- file folder for product images ----
  console.log('\nFolder')
  await ensureOnce(
    `/folders?filter[name][_eq]=${encodeURIComponent(FOLDER_NAME)}&limit=1`,
    '/folders',
    { name: FOLDER_NAME },
    `folder ${FOLDER_NAME}`,
  )

  // ---- collections ----
  console.log('\nCollections')

  await createCollection('eo_categories', 'category', [
    str('name', { required: true }),
    str('slug', { required: true, unique: true }),
    int('sort_order', { def: 0 }),
    timestamp('date_created', 'date-created'),
  ])

  await createCollection('eo_products', 'local_cafe', [
    { field: 'category', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true }, schema: { is_nullable: false } },
    str('name', { required: true }),
    str('slug', { required: true, unique: true }),
    str('tagline'),
    str('description', { long: true }),
    int('price_cents', { required: true, min: 0 }),
    { field: 'image', type: 'uuid', meta: { special: ['file'], interface: 'file-image' }, schema: { is_nullable: true } },
    { field: 'is_active', type: 'boolean', meta: { interface: 'boolean' }, schema: { default_value: true, is_nullable: false } },
    { field: 'meta', type: 'json', meta: { interface: 'input-code', options: { language: 'json' } }, schema: { is_nullable: true } },
    int('stock_initial', { required: true, min: 0, def: 0 }),
    timestamp('date_created', 'date-created'),
  ])

  await createCollection('eo_orders', 'receipt_long', [
    str('order_number', { required: true, unique: true }),
    {
      field: 'status',
      type: 'string',
      meta: {
        interface: 'select-dropdown',
        required: true,
        options: {
          choices: [
            { text: 'Open', value: 'open' },
            { text: 'Marked', value: 'marked' },
            { text: 'Canceled', value: 'canceled' },
          ],
        },
      },
      schema: { default_value: 'open', is_nullable: false },
    },
    str('customer_name', { required: true }),
    str('email', { required: true }),
    str('street', { required: true }),
    str('zip', { required: true }),
    str('city', { required: true }),
    str('country', { required: true }),
    int('subtotal_cents', { required: true, min: 0 }),
    int('shipping_cents', { required: true, min: 0 }),
    int('total_cents', { required: true, min: 0 }),
    str('cancel_reason'),
    str('cancel_note', { long: true }),
    { field: 'user', type: 'uuid', meta: { interface: 'select-dropdown-m2o' }, schema: { is_nullable: true } },
    { field: 'items', type: 'alias', meta: { special: ['o2m'], interface: 'list-o2m' } },
    timestamp('date_created', 'date-created'),
    timestamp('date_updated', 'date-updated'),
  ])

  await createCollection('eo_order_items', 'list', [
    { field: 'order', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true }, schema: { is_nullable: false } },
    { field: 'product', type: 'uuid', meta: { interface: 'select-dropdown-m2o' }, schema: { is_nullable: true } },
    str('product_name', { required: true }),
    int('unit_price_cents', { required: true, min: 0 }),
    int('quantity', { required: true, min: 1 }),
  ])

  // ---- relations ----
  // SET NULL on user: deleting an account must orphan order history, never erase it.
  // SET NULL on product: a deleted product must degrade the line to text, not delete it.
  // CASCADE on order: deleting an order takes its lines with it.
  console.log('\nRelations')
  await relate('eo_products', 'category', 'eo_categories', 'NO ACTION')
  await relate('eo_products', 'image', 'directus_files', 'SET NULL')
  await relate('eo_orders', 'user', 'directus_users', 'SET NULL')
  await relate('eo_order_items', 'order', 'eo_orders', 'CASCADE', 'items')
  await relate('eo_order_items', 'product', 'eo_products', 'SET NULL')

  console.log('\nDone.')
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1) })
