// public/js/supabase-config.js
// Get supabase credentials from: supabase.com → your project → Settings → API
// These are SAFE to be public (anon/public key only — never the service_role key).

const SUPABASE_URL      = 'https://pafkclelijvmhejyvykz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZmtjbGVsaWp2bWhlanl2eWt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTQ4NzgsImV4cCI6MjA5NDc5MDg3OH0.XZGvxpkPG4REQ0RcMB_viZKdx3TY6fmLIBGbuAuIqg8';

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
