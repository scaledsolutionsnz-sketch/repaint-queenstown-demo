/* Repaint Queenstown CMS — public configuration.

   Repaint's content lives in Supabase project bffddgypusotsdwpaliy, in its own
   table (repaint_site_content) and its own bucket (repaint-site-images); see
   supabase/schema.sql.

   The key below is a publishable key. It is safe in the browser: what it can
   actually do is fixed by row level security — anyone may read the content,
   only a user listed in repaint_site_editors may write it.
   Do NOT put the service_role key here. */
window.CMS_CONFIG = {
  url: 'https://bffddgypusotsdwpaliy.supabase.co',
  anonKey: 'sb_publishable_p1PXdYSrDVuqopFeO0HWTA_CG7-l-WV',
  bucket: 'repaint-site-images'
};
