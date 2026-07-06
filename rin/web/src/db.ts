import { supabase } from './supabase';

async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function uid(): Promise<string | undefined> {
  return (await supabase.auth.getUser()).data.user?.id;
}
async function myMerchant(): Promise<{ id: string; [k: string]: any } | null> {
  const { data } = await supabase.from('merchants').select('*').maybeSingle();
  return data;
}

export const db = {
  // ── auth ──
  signIn: (email: string, password: string) => supabase.auth.signInWithPassword({ email, password }),
  signUp: (email: string, password: string, role: string, display_name?: string) =>
    supabase.auth.signUp({ email, password, options: { data: { role, display_name } } }),
  oauth: (provider: 'google' | 'apple') =>
    supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + '/app' } }),
  signOut: () => supabase.auth.signOut(),

  // ── consumer ──
  consentRequest: (token: string) => rpc('get_consent_request', { p_token: token }),
  approve: (token: string, scopes: string[]) => rpc('approve_consent', { p_token: token, p_granted: scopes }),
  deny: (token: string) => rpc('deny_consent', { p_token: token }),
  myBrands: () => rpc<any[]>('my_connected_brands'),
  revoke: (grantId: string) => rpc('revoke_grant', { p_grant_id: grantId }),

  async wallet() {
    const [items, receipts, warranties] = await Promise.all([
      supabase.from('wallet_items').select('*').order('created_at', { ascending: false }),
      supabase.from('receipts').select('*').order('purchased_at', { ascending: false }),
      supabase.from('warranties').select('*').order('expires_at'),
    ]);
    return { items: items.data ?? [], receipts: receipts.data ?? [], warranties: warranties.data ?? [] };
  },
  async notifications() {
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false });
    return data ?? [];
  },
  markRead: (id: string) => supabase.from('notifications').update({ read: true }).eq('id', id),
  async profile() {
    const { data } = await supabase.from('consumer_profiles').select('*').maybeSingle();
    return data;
  },
  async saveProfile(patch: Record<string, unknown>) {
    const id = await uid();
    return supabase.from('consumer_profiles').update(patch).eq('profile_id', id!);
  },
  async transparency() {
    const { data } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(50);
    return data ?? [];
  },
  myMemberships: () => rpc<any[]>('my_memberships'),
  exportMyData: () => rpc('export_my_data'),
  revokeAll: () => rpc('revoke_all_consents'),
  eraseMyData: () => rpc('delete_my_data'),
  async myMalls() {
    const grants = await rpc<any[]>('my_connected_brands');
    if (!grants?.length) return [];
    const { data: brands } = await supabase.from('merchants').select('id').in('slug', grants.map((g) => g.brand.slug));
    const ids = (brands ?? []).map((b) => b.id);
    if (!ids.length) return [];
    const { data: stores } = await supabase.from('mall_stores').select('mall_id').in('merchant_id', ids);
    const mallIds = [...new Set((stores ?? []).map((s) => s.mall_id))];
    if (!mallIds.length) return [];
    const { data: malls } = await supabase.from('malls').select('*').in('id', mallIds);
    return malls ?? [];
  },

  // ── brand: org, team, roles ──
  createBrand: (name: string, slug: string) => rpc('create_brand', { p_name: name, p_slug: slug }),
  myMembership: () => rpc('my_membership'),
  teamMembers: () => rpc<any[]>('team_members'),
  createInvite: (email: string, role: string, branchId?: string) =>
    rpc('create_invite', { p_email: email, p_role: role, p_branch_id: branchId ?? null }),
  listInvites: () => rpc<any[]>('list_invites'),
  revokeInvite: (id: string) => rpc('revoke_invite', { p_id: id }),
  acceptInvite: (token: string) => rpc('accept_invite', { p_token: token }),
  updateMember: (profileId: string, role: string, branchId?: string) =>
    rpc('update_member', { p_profile_id: profileId, p_role: role, p_branch_id: branchId ?? null }),
  removeMember: (profileId: string) => rpc('remove_member', { p_profile_id: profileId }),

  // ── brand ──
  myMerchant,
  dashboard: () => rpc('merchant_dashboard'),
  customers: () => rpc<any[]>('list_customers'),
  customer: (grantId: string) => rpc('get_customer', { p_grant_id: grantId }),
  createRequest: (branchId?: string) => rpc('create_identity_request', { p_branch_id: branchId ?? null, p_reference: 'web' }),
  requestResult: (id: string) => rpc('get_request_result', { p_request_id: id }),
  async branches() {
    const { data } = await supabase.from('branches').select('*').order('created_at');
    return data ?? [];
  },
  async addBranch(b: { name: string; code: string; city?: string }) {
    const m = await myMerchant();
    const { error } = await supabase.from('branches').insert({ merchant_id: m!.id, ...b });
    if (error) throw new Error(error.message);
  },
  async updateBranding(patch: Record<string, unknown>) {
    const m = await myMerchant();
    const { error } = await supabase.from('merchants').update(patch).eq('id', m!.id);
    if (error) throw new Error(error.message);
  },
  async scopes() {
    const { data } = await supabase.from('scopes').select('*').order('sort');
    return data ?? [];
  },
  async consentConfig() {
    const { data } = await supabase.from('merchant_requested_fields').select('*');
    return data ?? [];
  },
  async setConsentConfig(fields: { scope_key: string; required: boolean }[]) {
    const m = await myMerchant();
    await supabase.from('merchant_requested_fields').delete().eq('merchant_id', m!.id);
    if (fields.length) {
      const { error } = await supabase.from('merchant_requested_fields').insert(fields.map((f) => ({ merchant_id: m!.id, ...f })));
      if (error) throw new Error(error.message);
    }
  },
  async connectors() {
    const { data } = await supabase.from('connectors').select('*').order('created_at', { ascending: false });
    return data ?? [];
  },
  async addConnector(c: { kind: string; adapter: string; name: string; config?: any; is_primary?: boolean }) {
    const m = await myMerchant();
    if (c.is_primary) await supabase.from('connectors').update({ is_primary: false }).eq('merchant_id', m!.id);
    const { error } = await supabase.from('connectors').insert({ merchant_id: m!.id, ...c });
    if (error) throw new Error(error.message);
  },
  setPrimaryConnector: (id: string) => rpc('set_primary_connector', { p_id: id }),
  sendCampaign: (title: string, body?: string, scope = 'permission:marketing') =>
    rpc('send_campaign', { p_title: title, p_body: body ?? null, p_require_scope: scope }),
  async campaigns() {
    const { data } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false });
    return data ?? [];
  },
  async malls() {
    const { data } = await supabase.from('malls').select('*, mall_stores!inner(merchant_id)');
    return data ?? [];
  },
  mallDashboard: (id: string) => rpc('mall_dashboard', { p_mall_id: id }),

  // ── billing ──
  billingSummary: () => rpc('billing_summary'),
  listPlans: () => rpc<any[]>('list_plans'),
  async upgrade(planCode: string) {
    // Try Stripe checkout; fall back to an immediate plan change in dev.
    const { data } = await supabase.functions.invoke('create-checkout', { body: { plan_code: planCode } }).catch(() => ({ data: null } as any));
    if (data?.configured && data.url) { window.location.href = data.url; return { redirected: true }; }
    return rpc('change_plan', { p_code: planCode });
  },
};

// Static catalogue for the Integrations screen.
export const CONNECTOR_CATALOG = [
  { key: 'salesforce', name: 'Salesforce', kind: 'crm' },
  { key: 'hubspot', name: 'HubSpot', kind: 'crm' },
  { key: 'dynamics', name: 'Microsoft Dynamics', kind: 'crm' },
  { key: 'sap', name: 'SAP', kind: 'erp' },
  { key: 'nebim', name: 'Nebim', kind: 'erp' },
  { key: 'ncr', name: 'NCR', kind: 'pos' },
  { key: 'cloud_pos', name: 'Cloud POS', kind: 'pos' },
  { key: 'custom_rest', name: 'Custom REST', kind: 'crm' },
];
