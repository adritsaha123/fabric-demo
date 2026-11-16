# Fabric — mobile web demo

A clickable demo of the Fabric mobile app, built from the Figma design doc (Logo and Design page).
Plain HTML/CSS/JS, with no build step and no dependencies.

## Open it

- **Quickest:** double-click `index.html` to open it in Chrome.
- **Local server** (optional): `python -m http.server 5173`, then open http://localhost:5173
- **Put it on the web:** upload the whole folder (`index.html`, `styles.css`, `app.js`, `assets/`) to any static host, such as GitHub Pages, Netlify Drop or Vercel.

## iPhone 16 format

- Sized for **iPhone 16 (393 × 852 pt)**. The Figma frames are 402 × 874 (iPhone 16 Pro), so layouts were adjusted to fit the narrower screen.
- **Desktop Chrome:** shows inside an iPhone 16 frame with the Dynamic Island, status bar and home indicator.
- **On an iPhone:** fills the screen and respects the real safe areas (Dynamic Island and home bar). Text fields don't zoom in when you tap them.
- **Add to Home Screen** (Safari → Share): opens full-screen like a native app, with the Fabric icon.
- To test in Chrome: DevTools → device toolbar → set **393 × 852**, or pick iPhone 16 if it's listed.

## Clinic side

Fabric works at **every** clinic, and clinics pay only for speed and integration:

| Page | Who it's for | What it shows |
| --- | --- | --- |
| `view.html` (free) | Any clinic, no account | The patient-approved summary from a 24-hour link, with a PDF download |
| `clinic.html` (paid) | Clinics on Fabric for Clinics | Front-desk check-in, QR scan, insurance checks, import to chart, records-request inbox, time-saved stats |

**Demo the handshake:** open `clinic.html` and `index.html` (signed in) in two tabs of the same browser. Click **Scan Fabric ID** on the clinic tab and the request appears on the phone. The patient chooses what to share, and the clinic gets exactly that. If the phone tab isn't open, use "Approve on their behalf (demo)".
Use `http://localhost:5173` for this. Some browsers don't pass messages between tabs for files opened by double-click.

**Import to chart:** in the paid portal, after a scan, **Import to chart** creates two standard files from only what the patient approved:
- **FHIR R4 bundle** (`.json`): the format records-system APIs and integration services use.
- **C-CDA summary** (`.xml`): the document every certified records system can receive (e.g. by Direct Secure Messaging) and reconcile into the chart.
The free view also offers the C-CDA download. Sample output is in [`samples/`](samples). The generators are in `export.js`.
*Demo limits:* entries are plain text, not standard medical codes (RxNorm, SNOMED, CVX), and the files haven't been through ONC's C-CDA validator or a FHIR validator. "Send to chart inbox" is simulated.

**Free link:** on the phone's Fabric ID screen, tap **Share a link with any clinic** to choose sections and open the free view.

## What's in it

| Screen | Interactions |
| --- | --- |
| Opening | Sign In / Sign Up |
| Sign In | Email and password validation, then Home |
| Sign Up | Name, date of birth (auto-formats), email, password (8+ characters), terms checkbox |
| Home | Search jumps to a filtered Timeline. "View transfer" opens the transfer steps. Insurance card opens the member card |
| Timeline | Tap a record to open the record sheet (tap the scrim, grabber or Esc to close) |
| Profile | QR button opens Fabric ID. Log out |
| QR Code | 5-minute refresh countdown |

All data is fake demo data. Any email and password signs in. The signed-in name is kept in `localStorage` for that browser only.
