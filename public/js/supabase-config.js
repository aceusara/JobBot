// public/js/supabase-config.js
// Replace BOTH values below with your real Supabase project credentials.
// Get them from: supabase.com → your project → Settings → API
// These are SAFE to be public (anon/public key only — never the service_role key).

const SUPABASE_URL      = 'YOUR_SUPABASE_URL';       // e.g. https://abcxyz.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // starts with eyJ...

(function () {
  // Guard: don't crash the whole app if credentials haven't been filled in yet.
  if (SUPABASE_URL.includes('YOUR_') || SUPABASE_ANON_KEY.includes('YOUR_')) {
    console.warn('[JobBot] Supabase credentials not set in supabase-config.js — auth is disabled.');
    // Provide a no-op stub so auth.js doesn't throw
    window._supabase = {
      auth: {
        onAuthStateChange: (cb) => { cb('SIGNED_OUT', null); return { data: { subscription: { unsubscribe: () => {} } } }; },
        signUp: async () => ({ error: { message: 'Auth not configured. Set your Supabase credentials.' } }),
        signInWithPassword: async () => ({ error: { message: 'Auth not configured. Set your Supabase credentials.' } }),
        signInWithOAuth: async () => ({ error: { message: 'Auth not configured. Set your Supabase credentials.' } }),
        resetPasswordForEmail: async () => ({ error: { message: 'Auth not configured.' } }),
        updateUser: async () => ({ error: { message: 'Auth not configured.' } }),
        signOut: async () => ({}),
      }
    };
    return;
  }

  const { createClient } = supabase;
  window._supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
})();
