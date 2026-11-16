# Fabric — mobile web demo

Patients carry their health records on their phone and choose what each clinic sees.
Plain HTML/CSS/JS with no build step.

- **Patient app:** https://adritsaha123.github.io/fabric-demo/patient/
- **Clinic (doctor) portal:** https://adritsaha123.github.io/fabric-demo/clinic/

| Page | Who | What |
| --- | --- | --- |
| `index.html` | Patients | Sign up, timeline, Fabric ID (QR), share links, approve clinic requests, see who has access |
| `clinic.html` | Clinics on the paid plan | Front desk check-in, scan, insurance check, import to chart (FHIR / C-CDA) |
| `view.html` | Any clinic, free | The summary from a patient's 24-hour link, with PDF and C-CDA download |

## Two modes

- **Offline demo** (default, `config.js` empty): fake sign-in, data stays in the browser, tabs talk to each other directly.
- **Cloud** (Supabase): real accounts, a Postgres database, and access rules enforced on the server.

### Turn on the cloud backend

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Authentication → Sign In / Providers → Email:** for a quick demo, turn off **Confirm email**. (Leave it on and new users confirm by email first.)
4. **Authentication → URL Configuration:** set **Site URL** to `https://adritsaha123.github.io/fabric-demo/` (or `http://localhost:5173` while testing).
5. **Project Settings → API:** copy the **Project URL** and the **anon public** key into `config.js`.

The anon key is meant to be public. It can only do what the database rules allow.

## How the data is protected

- **Row-level security on every table.** A patient can read and edit only their own record.
- **Clinics never query the patients table.** A clinic gets data only through `get_consented_packet()`, only after the patient taps **Share**, only the sections they ticked, and only for 24 hours.
- **Shared links** use a 244-bit random token, expire after 24 hours, and the patient can end them early.
- **Every view is logged.** The patient's Profile shows who can see their records (with **End now**) and recent activity.
- Fabric IDs can't be chosen or changed by users, and clinic requests are rate-limited.

**Not HIPAA-ready.** Use made-up data only. Real patient data needs a paid plan with a signed BAA, audit retention, and a security review.

## Try the handshake

1. Open `index.html` and create an account. You start with fictional demo records.
2. In another tab of the same browser, open `clinic.html` (cloud mode: sign in or create a staff account; it joins the demo clinic).
3. **Scan Fabric ID → Simulate scan.** The request appears on the patient tab. Tick what to share.
4. The clinic sees exactly that. **Import to chart** makes FHIR R4 and C-CDA files.

Use `http://localhost:5173` (run `python -m http.server 5173`) rather than double-clicking files.

## iPhone 16 format

Sized for iPhone 16 (393 × 852). On desktop it shows inside a phone frame. On an iPhone it fills the screen, respects the safe areas, and can be added to the Home Screen.

## Demo limits

- Export entries are plain text, not coded (RxNorm, SNOMED, CVX), and haven't been through official validators.
- "Send to chart inbox", records transfers and the clinic's schedule and stats are simulated.
- There's no camera scanning. "Simulate scan" reads the Fabric ID of the patient signed in on that browser.
