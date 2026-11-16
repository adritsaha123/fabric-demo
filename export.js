/* Turns the patient-approved packet into standard files a records system (EHR) can take in:
   - FHIR R4 Bundle (JSON): what EHR APIs and integration middleware speak.
   - C-CDA Continuity of Care Document (XML): what every certified EHR can receive
     (e.g. over Direct Secure Messaging) and reconcile into the chart.
   Only sections the patient chose to share are included.

   DEMO LIMITS: entries use plain text instead of standard codes (RxNorm, SNOMED, CVX),
   and the C-CDA has readable narrative sections only. A production version needs
   coded entries and a pass through ONC's C-CDA validator / a FHIR validator. */
(function () {
  "use strict";
  var D = window.FABRIC_DATA;
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // "Oct 12, 2026" -> "2026-10-12", "Aug 2021" -> "2021-08", "2019" -> "2019"
  function isoDate(s) {
    var m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
    if (m) return m[3] + "-" + pad(MONTHS[m[1].toLowerCase()]) + "-" + pad(+m[2]);
    m = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(s.trim());
    if (m) return m[2] + "-" + pad(MONTHS[m[1].toLowerCase()]);
    m = /^(\d{4})$/.exec(s.trim());
    return m ? m[1] : null;
  }
  function dobIso() { if (!D.patient.dob) return undefined; var p = D.patient.dob.split("/"); return p[2] + "-" + p[0] + "-" + p[1]; }
  function hl7(iso) { return iso ? iso.replace(/-/g, "") : ""; } // C-CDA date format: YYYYMMDD
  function nameParts() { var n = D.patient.name.trim().split(/\s+/); return { given: n.slice(0, -1), family: n[n.length - 1] }; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function xml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }
  function has(keys, k) { return keys.indexOf(k) !== -1; }

  // ---------------- FHIR R4 ----------------
  function fhirBundle(keys) {
    var entries = [];
    function add(resource) {
      var id = uuid();
      resource.id = id;
      entries.push({ fullUrl: "urn:uuid:" + id, resource: resource });
      return "urn:uuid:" + id;
    }
    var n = nameParts();
    var patientRef = add({
      resourceType: "Patient",
      identifier: [{ system: "https://fabric.example/fabric-id", value: D.fabricId }],
      name: [{ use: "official", family: n.family, given: n.given }],
      gender: D.patient.sex === "M" ? "male" : D.patient.sex === "F" ? "female" : "unknown",
      birthDate: dobIso(),
      telecom: [{ system: "phone", value: D.patient.phone }, { system: "email", value: D.patient.email }]
        .filter(function (t) { return t.value; }),
      address: D.patient.address ? [{ text: D.patient.address }] : undefined
    });

    if (has(keys, "insurance")) {
      var payerRef = add({ resourceType: "Organization", name: D.insurance.payer });
      add({
        resourceType: "Coverage", status: "active",
        subscriberId: D.insurance.memberId,
        beneficiary: { reference: patientRef },
        payor: [{ reference: payerRef }],
        class: [
          { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/coverage-class", code: "group" }] }, value: D.insurance.group },
          { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/coverage-class", code: "plan" }] }, value: D.insurance.plan }
        ]
      });
    }
    if (has(keys, "allergies")) {
      D.allergies.forEach(function (a) {
        add({
          resourceType: "AllergyIntolerance",
          clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
          verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "unconfirmed" }] },
          code: { text: a.name },
          patient: { reference: patientRef },
          reaction: [{ manifestation: [{ text: a.reaction }], severity: a.severity.toLowerCase() }]
        });
      });
    }
    if (has(keys, "medications")) {
      D.medications.forEach(function (m) {
        add({
          resourceType: "MedicationStatement", status: "active",
          medicationCodeableConcept: { text: m.name },
          subject: { reference: patientRef },
          effectivePeriod: { start: isoDate(m.since) },
          dosage: [{ text: m.sig }],
          informationSource: { reference: patientRef }
        });
      });
    }
    if (has(keys, "conditions")) {
      D.conditions.forEach(function (c) {
        add({
          resourceType: "Condition",
          clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }] }],
          code: { text: c.name },
          subject: { reference: patientRef },
          onsetDateTime: isoDate(c.since)
        });
      });
    }
    if (has(keys, "immunizations")) {
      D.immunizations.forEach(function (i) {
        add({
          resourceType: "Immunization", status: "completed",
          vaccineCode: { text: i.name },
          patient: { reference: patientRef },
          occurrenceDateTime: isoDate(i.date),
          primarySource: false
        });
      });
    }
    if (has(keys, "records")) {
      D.records.forEach(function (r) {
        if (r.type === "LAB RESULT") {
          add({
            resourceType: "DiagnosticReport", status: "final",
            code: { text: r.title }, subject: { reference: patientRef },
            effectiveDateTime: isoDate(r.date), conclusion: r.summary,
            performer: [{ display: r.provider }]
          });
        } else {
          add({
            resourceType: "Encounter", status: "finished",
            class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
            type: [{ text: r.title }], subject: { reference: patientRef },
            period: { start: isoDate(r.date) },
            participant: [{ individual: { display: r.provider } }],
            serviceProvider: { display: r.location },
            reasonCode: [{ text: r.summary }]
          });
        }
      });
    }
    if (has(keys, "intake")) {
      add({
        resourceType: "QuestionnaireResponse", status: "completed",
        subject: { reference: patientRef }, authored: new Date().toISOString(),
        item: [
          { linkId: "reason", text: "Reason for visit", answer: [{ valueString: D.intake.reason }] },
          { linkId: "symptoms", text: "Current symptoms", answer: [{ valueString: D.intake.symptoms }] },
          { linkId: "pharmacy", text: "Preferred pharmacy", answer: [{ valueString: D.intake.pharmacy }] },
          { linkId: "consent", text: "Consent to treat signed", answer: [{ valueBoolean: !!D.intake.consentSigned }] }
        ]
      });
    }
    return {
      resourceType: "Bundle",
      id: uuid(),
      meta: { lastUpdated: new Date().toISOString(), tag: [{ system: "https://fabric.example/tags", code: "patient-shared", display: "Shared by patient via Fabric (demo data)" }] },
      type: "collection",
      timestamp: new Date().toISOString(),
      entry: entries
    };
  }

  // ---------------- C-CDA (CCD) ----------------
  function table(head, rows) {
    return "<table border=\"1\" width=\"100%\"><thead><tr>" + head.map(function (h) { return "<th>" + xml(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (r) {
        return "<tr>" + r.map(function (c) { return "<td>" + xml(c) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }
  function section(templateId, loinc, title, body) {
    return "<component><section>" +
      "<templateId root=\"" + templateId + "\"/>" +
      "<code code=\"" + loinc + "\" codeSystem=\"2.16.840.1.113883.6.1\" codeSystemName=\"LOINC\" displayName=\"" + xml(title) + "\"/>" +
      "<title>" + xml(title) + "</title><text>" + body + "</text></section></component>";
  }
  function ccda(keys) {
    var n = nameParts(), now = new Date();
    var ts = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    var s = [];
    if (has(keys, "allergies")) s.push(section("2.16.840.1.113883.10.20.22.2.6", "48765-2", "Allergies and Adverse Reactions",
      table(["Substance", "Reaction", "Severity"], D.allergies.map(function (a) { return [a.name, a.reaction, a.severity]; }))));
    if (has(keys, "medications")) s.push(section("2.16.840.1.113883.10.20.22.2.1", "10160-0", "Medications",
      table(["Medication", "Directions", "Since"], D.medications.map(function (m) { return [m.name, m.sig, m.since]; }))));
    if (has(keys, "conditions")) s.push(section("2.16.840.1.113883.10.20.22.2.5", "11450-4", "Problems",
      table(["Condition", "Since", "Status"], D.conditions.map(function (c) { return [c.name, c.since, "Active"]; }))));
    if (has(keys, "immunizations")) s.push(section("2.16.840.1.113883.10.20.22.2.2", "11369-6", "Immunizations",
      table(["Vaccine", "Date"], D.immunizations.map(function (i) { return [i.name, i.date]; }))));
    if (has(keys, "records")) {
      var labs = D.records.filter(function (r) { return r.type === "LAB RESULT"; });
      var visits = D.records.filter(function (r) { return r.type !== "LAB RESULT"; });
      s.push(section("2.16.840.1.113883.10.20.22.2.22", "46240-8", "Encounters",
        table(["Date", "Visit", "Provider", "Location", "Summary"], visits.map(function (r) { return [r.date, r.title, r.provider, r.location, r.summary]; }))));
      if (labs.length) s.push(section("2.16.840.1.113883.10.20.22.2.3", "30954-2", "Results",
        table(["Date", "Test", "Performed by", "Result"], labs.map(function (r) { return [r.date, r.title, r.provider, r.summary]; }))));
    }
    if (has(keys, "insurance")) s.push(section("2.16.840.1.113883.10.20.22.2.18", "48768-6", "Payers",
      table(["Payer", "Plan", "Member ID", "Group", "Subscriber"], [[D.insurance.payer, D.insurance.plan, D.insurance.memberId, D.insurance.group, D.insurance.subscriber]])));

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      "<!-- Fabric demo export. Narrative sections only; DEMO DATA, not a real patient. -->\n" +
      '<ClinicalDocument xmlns="urn:hl7-org:v3">' +
      '<realmCode code="US"/>' +
      '<typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>' +
      '<templateId root="2.16.840.1.113883.10.20.22.1.1" extension="2015-08-01"/>' +
      '<templateId root="2.16.840.1.113883.10.20.22.1.2" extension="2015-08-01"/>' +
      '<id root="' + uuid() + '"/>' +
      '<code code="34133-9" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC" displayName="Summary of episode note"/>' +
      "<title>Patient-shared health summary (Fabric)</title>" +
      '<effectiveTime value="' + ts + '"/>' +
      '<confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>' +
      '<languageCode code="en-US"/>' +
      "<recordTarget><patientRole>" +
        '<id root="2.16.840.1.113883.19.5" extension="' + xml(D.fabricId) + '" assigningAuthorityName="Fabric"/>' +
        "<addr><streetAddressLine>" + xml(D.patient.address) + "</streetAddressLine></addr>" +
        '<telecom use="HP" value="tel:' + xml(D.patient.phone) + '"/>' +
        "<patient><name>" + n.given.map(function (g) { return "<given>" + xml(g) + "</given>"; }).join("") + "<family>" + xml(n.family) + "</family></name>" +
        '<administrativeGenderCode code="' + xml(D.patient.sex) + '" codeSystem="2.16.840.1.113883.5.1"/>' +
        '<birthTime value="' + hl7(dobIso()) + '"/></patient>' +
      "</patientRole></recordTarget>" +
      '<author><time value="' + ts + '"/><assignedAuthor><id root="2.16.840.1.113883.19.5" extension="fabric-app"/>' +
        "<assignedAuthoringDevice><softwareName>Fabric (patient-shared)</softwareName></assignedAuthoringDevice></assignedAuthor></author>" +
      "<custodian><assignedCustodian><representedCustodianOrganization>" +
        '<id root="2.16.840.1.113883.19.5" extension="fabric"/><name>Fabric</name>' +
      "</representedCustodianOrganization></assignedCustodian></custodian>" +
      "<component><structuredBody>" + s.join("") + "</structuredBody></component>" +
      "</ClinicalDocument>";
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function fileBase() {
    var d = new Date();
    return "fabric-" + D.patient.name.toLowerCase().replace(/\s+/g, "-") + "-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  window.FabricExport = {
    fhirBundle: fhirBundle,
    ccda: ccda,
    download: download,
    fileBase: fileBase
  };
})();
