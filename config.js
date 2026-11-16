/* Supabase connection. Both values are safe to publish: row-level security in
   supabase/schema.sql decides what each user can read or write.
   Leave them empty to run the offline demo (fake sign-in, data stays in this browser). */
window.FABRIC_CONFIG = {
  supabaseUrl: "https://nozmocmdmebfzqymkjii.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vem1vY21kbWViZnpxeW1ramlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4Njg4MjEsImV4cCI6MjExMDQ0NDgyMX0.PvoS0S4ICe8Ti9ux4bY4tZi0bEQXBPyA4ilc4b-PfCc"
};
