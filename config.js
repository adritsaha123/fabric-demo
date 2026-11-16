/* Supabase connection. Both values are safe to publish: row-level security in
   supabase/schema.sql decides what each user can read or write.
   Leave them empty to run the offline demo (fake sign-in, data stays in this browser). */
window.FABRIC_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: ""
};
