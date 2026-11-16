/* Shared by the patient app (index.html) and the clinic portal (clinic.html).
   Demo data only — no real patient information. */
(function () {
  "use strict";

  var DATA = {
    fabricId: "FAB-7Q2K-91",
    patient: { name: "Adrit Saha", dob: "04/15/2003", sex: "M", phone: "(401) 555-0142", email: "adrit@example.com",
               address: "123 Example St, Providence, RI 02906" },
    insurance: {
      payer: "Blue Cross Blue Shield", plan: "PPO", memberId: "XYZ 8842 1093", group: "00417",
      subscriber: "Adrit Saha", copay: "$25 primary care",
      onFileMemberId: "XYZ 8842 1001" // what the clinic has on file (out of date) — Fabric catches it
    },
    allergies: [{ name: "Penicillin", reaction: "Hives", severity: "Moderate" }],
    medications: [
      { name: "Cetirizine 10 mg", sig: "1 tablet daily", since: "2024" },
      { name: "Albuterol HFA 90 mcg", sig: "2 puffs as needed for wheezing", since: "2019" }
    ],
    conditions: [
      { name: "Mild intermittent asthma", since: "2019" },
      { name: "Seasonal allergic rhinitis", since: "2015" }
    ],
    immunizations: [
      { name: "Influenza (seasonal)", date: "Jan 8, 2026" },
      { name: "Tdap", date: "Aug 2021" },
      { name: "MenACWY (meningococcal)", date: "Jul 2021" },
      { name: "COVID-19 (2025–26)", date: "Oct 2025" }
    ],
    intake: {
      reason: "New patient visit — establish primary care near campus",
      symptoms: "None currently. Occasional wheezing with exercise.",
      pharmacy: "CVS · Thayer St, Providence",
      emergencyContact: "Not provided",
      consentSigned: true
    },
    records: [
      {
        id: "physical", date: "Oct 12, 2026", time: "9:30 AM", title: "Annual Physical",
        type: "APPOINTMENT", provider: "Dr. Patel, MD", providerShort: "Dr. Patel",
        clinic: "Brown Health", location: "Brown Health, Providence",
        summary: "Routine checkup. Vitals normal, labs ordered. Follow up in 12 months."
      },
      {
        id: "blood", date: "Aug 3, 2026", time: "7:45 AM", title: "Blood Panel Results",
        type: "LAB RESULT", provider: "Quest Diagnostics", providerShort: "",
        clinic: "Quest Diagnostics", location: "Quest Diagnostics, Providence",
        summary: "Complete blood count and metabolic panel. All values within normal range. Cholesterol slightly elevated — discuss at next visit."
      },
      {
        id: "derm", date: "May 20, 2026", time: "2:15 PM", title: "Dermatology Visit",
        type: "APPOINTMENT", provider: "Dr. Chen, MD", providerShort: "Dr. Chen",
        clinic: "RI Hospital", location: "RI Hospital, Providence",
        summary: "Skin check. One mole photographed for monitoring. No biopsy needed. Return in 6 months."
      },
      {
        id: "flu", date: "Jan 8, 2026", time: "11:00 AM", title: "Flu Vaccine",
        type: "IMMUNIZATION", provider: "CVS Pharmacist", providerShort: "",
        clinic: "CVS MinuteClinic", location: "CVS MinuteClinic, Thayer St",
        summary: "Seasonal influenza vaccine (quadrivalent) administered, left arm. No adverse reaction observed."
      }
    ],
    // What a clinic can ask to see. The patient can switch any of these off.
    shareItems: [
      { key: "insurance", label: "Insurance card" },
      { key: "allergies", label: "Allergies" },
      { key: "medications", label: "Medications" },
      { key: "conditions", label: "Health conditions" },
      { key: "immunizations", label: "Immunizations" },
      { key: "records", label: "Visit history & outside records" },
      { key: "intake", label: "Intake form" }
    ]
  };

  /* Tiny message bus between tabs/windows of the same site.
     BroadcastChannel where available, localStorage "storage" events as a fallback. */
  var listeners = [];
  var seen = {};
  var CHANNEL = "fabric-demo";
  var bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) { bc = null; }

  function deliver(msg) {
    if (!msg || !msg.id || seen[msg.id]) return;
    seen[msg.id] = true;
    listeners.forEach(function (fn) { try { fn(msg); } catch (e) { /* ignore */ } });
  }
  if (bc) bc.onmessage = function (e) { deliver(e.data); };
  window.addEventListener("storage", function (e) {
    if (e.key !== CHANNEL || !e.newValue) return;
    try { deliver(JSON.parse(e.newValue)); } catch (err) { /* ignore */ }
  });

  var Bus = {
    send: function (msg) {
      msg.id = msg.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
      seen[msg.id] = true; // don't echo to ourselves
      if (bc) { try { bc.postMessage(msg); } catch (e) { /* ignore */ } }
      try { localStorage.setItem(CHANNEL, JSON.stringify(msg)); } catch (e) { /* storage blocked */ }
      return msg.id;
    },
    on: function (fn) { listeners.push(fn); }
  };

  var SHARE_ITEMS = DATA.shareItems;
  var DEMO = JSON.parse(JSON.stringify(DATA));
  delete DEMO.shareItems;

  /* FABRIC_DATA is the working copy every page renders from. In cloud mode it is
     replaced with the signed-in patient's data, or with only what a patient shared. */
  window.FABRIC_DATA = DATA;
  window.FabricData = {
    demo: function () { return JSON.parse(JSON.stringify(DEMO)); },
    load: function (obj) {
      Object.keys(DATA).forEach(function (k) { if (k !== "shareItems") delete DATA[k]; });
      Object.keys(obj || {}).forEach(function (k) { if (k !== "shareItems") DATA[k] = obj[k]; });
      DATA.shareItems = SHARE_ITEMS;
      return DATA;
    }
  };
  window.FabricBus = Bus;
})();
