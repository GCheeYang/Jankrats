/* Jankrats — deployment config.
   Fill these in with your own Supabase project's values (see SETUP.md).
   The anon key is meant to be public/client-side — Supabase's row-level
   security policies (in supabase/schema.sql) are what actually protect
   the data, not secrecy of this key. Never put the service_role key here.
   POSTHOG_KEY is the same kind of public, client-side-safe key (a
   PostHog "project API key", not a secret). */
window.__JV_CONFIG__ = {
  SUPABASE_URL: "https://tatghpukfjsbcaktvbms.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_PF8ZgT9IE2jHAJ1AjCwNpw_tcW4ciH_",
  VAPID_PUBLIC_KEY: "BAwYun70PDv6YsgAxhHNV71UZ1EgPa-6vOkCLbp8sOOmFzh0BisIp_hynHSG1WZNs2ueQf6R7NuhmaW8f_kMIaM",
  POSTHOG_KEY: "phc_mSJSDioTypVTNmSYWrQMtmfAhkdriZe9GfJ8b92qrP2o",
  POSTHOG_HOST: "https://us.i.posthog.com"
};
