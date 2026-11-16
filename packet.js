/* Renders the patient packet a clinic sees after the patient approves.
   Used by the free clinic view (view.html) and the paid portal (clinic.html). */
(function () {
  "use strict";
  var D = window.FABRIC_DATA;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function age(dob) {
    var p = dob.split("/"), b = new Date(+p[2], +p[0] - 1, +p[1]), n = new Date();
    var a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }
  function time(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function list(items, left, right) {
    return '<ul class="list">' + items.map(function (i) {
      return "<li><span>" + esc(left(i)) + "</span><span>" + esc(right(i)) + "</span></li>";
    }).join("") + "</ul>";
  }
  function card(key, keys, title, inner, cls) {
    if (keys.indexOf(key) === -1) {
      return '<div class="card is-locked ' + (cls || "") + '"><p class="label">' + esc(title.toUpperCase()) +
        '</p><p class="small">The patient chose not to share this.</p></div>';
    }
    return '<div class="card ' + (cls || "") + '">' + inner + "</div>";
  }

  function render(opts) {
    var keys = opts.keys, pro = !!opts.pro, p = D.patient, ins = D.insurance;
    var sharedAt = opts.sharedAt || new Date();
    var expires = opts.expires || new Date(sharedAt.getTime() + 24 * 3600 * 1000);
    var initials = p.name.split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2);
    var h = [];

    // Header
    h.push(
      '<div class="pkt-head">' +
        '<div class="avatar h-m">' + esc(initials) + "</div>" +
        '<div class="pkt-head__main">' +
          '<p class="h-m">' + esc(p.name) + "</p>" +
          '<p class="body pkt-head__meta">DOB ' + esc(p.dob) + " · " + age(p.dob) + " y · " + esc(p.sex) + " · " + esc(D.fabricId) + "</p>" +
          '<p class="small">Shared by the patient at ' + time(sharedAt) + " · access ends " +
            expires.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time(expires) + "</p>" +
        "</div>" +
        '<span class="verified label">✓ Identity verified by Fabric</span>' +
      "</div>"
    );

    // Alerts
    var alerts = [];
    if (keys.indexOf("allergies") !== -1) {
      alerts.push('<div class="alert alert--danger"><span class="alert__icon">!</span><p class="alert__text body"><strong>Allergy:</strong> ' +
        D.allergies.map(function (a) { return esc(a.name) + " (" + esc(a.reaction.toLowerCase()) + ")"; }).join(", ") + "</p></div>");
    }
    if (keys.indexOf("insurance") !== -1 && pro) {
      alerts.push(opts.insuranceFixed
        ? '<div class="alert alert--ok"><span class="alert__icon">✓</span><p class="alert__text body">Member ID updated in your system. This claim won’t bounce for an old ID.</p></div>'
        : '<div class="alert alert--warn"><span class="alert__icon">⚠</span><p class="alert__text body"><strong>Insurance on file is out of date.</strong> On file: <code>' +
          esc(ins.onFileMemberId) + "</code> → patient’s current card: <code>" + esc(ins.memberId) +
          '</code>. A claim with the old ID would likely be denied.</p><button class="btn btn--primary btn--sm" type="button" data-action="fix-insurance">Update record</button></div>');
    }
    if (!pro) {
      alerts.push('<div class="alert alert--ok"><span class="alert__icon">i</span><p class="alert__text small">Free view for any clinic. ' +
        'With <strong>Fabric for Clinics</strong>, this arrives in your records system automatically, insurance is verified, and intake is pre-filled. ' +
        '<a class="link" href="clinic.html">See how it works</a></p></div>');
    }
    h.push('<div class="alerts">' + alerts.join("") + "</div>");

    // Cards
    var g = [];
    g.push(card("insurance", keys, "Insurance",
      '<div class="card__head"><p class="label card__kicker">INSURANCE</p>' +
        (pro ? '<span class="pill pill--done">Coverage active · checked now</span>' : '<span class="pill pill--paper">Not verified · free view</span>') + "</div>" +
      '<div class="ins"><div class="ins__row"><span class="title">' + esc(ins.payer) + '</span><span class="label">' + esc(ins.plan) + " · DEMO</span></div>" +
        '<div><p class="label">MEMBER</p><p class="title">' + esc(ins.subscriber) + "</p></div>" +
        '<div class="ins__row"><div><p class="label">MEMBER ID</p><p class="body">' + esc(ins.memberId) + '</p></div><div><p class="label">GROUP</p><p class="body">' + esc(ins.group) + "</p></div></div></div>" +
      '<p class="small muted">Copay: ' + esc(ins.copay) + "</p>"));
    g.push(card("allergies", keys, "Allergies",
      '<p class="label card__kicker">ALLERGIES</p>' + list(D.allergies, function (a) { return a.name; }, function (a) { return a.reaction + " · " + a.severity; })));
    g.push(card("medications", keys, "Medications",
      '<p class="label card__kicker">MEDICATIONS</p>' + list(D.medications, function (m) { return m.name; }, function (m) { return m.sig; })));
    g.push(card("conditions", keys, "Health conditions",
      '<p class="label card__kicker">HEALTH CONDITIONS</p>' + list(D.conditions, function (c) { return c.name; }, function (c) { return "since " + c.since; })));
    g.push(card("immunizations", keys, "Immunizations",
      '<p class="label card__kicker">IMMUNIZATIONS</p>' + list(D.immunizations, function (i) { return i.name; }, function (i) { return i.date; })));
    g.push(card("intake", keys, "Intake form",
      '<div class="card__head"><p class="label card__kicker">INTAKE FORM</p>' + (pro ? '<span class="pill pill--done">Pre-filled</span>' : "") + "</div>" +
      '<dl class="kv"><dt>Reason for visit</dt><dd>' + esc(D.intake.reason) + "</dd>" +
      "<dt>Current symptoms</dt><dd>" + esc(D.intake.symptoms) + "</dd>" +
      "<dt>Address</dt><dd>" + esc(D.patient.address) + "</dd>" +
      "<dt>Phone</dt><dd>" + esc(D.patient.phone) + "</dd>" +
      "<dt>Pharmacy</dt><dd>" + esc(D.intake.pharmacy) + "</dd>" +
      "<dt>Consent to treat</dt><dd>" + (D.intake.consentSigned ? "Signed in Fabric" : "Not signed") + "</dd></dl>", "card--wide"));
    g.push(card("records", keys, "Visit history & outside records",
      '<div class="card__head"><p class="label card__kicker">VISIT HISTORY &amp; OUTSIDE RECORDS</p><span class="small muted">' +
        D.records.length + " records from " + uniq(D.records.map(function (r) { return r.clinic; })).length + " providers</span></div>" +
      D.records.map(function (r) {
        return '<details class="rec"><summary><span class="label rec__date">' + esc(r.date) + '</span><span class="title">' + esc(r.title) +
          '</span><span class="small muted">' + esc(r.clinic) + '</span><span class="tag label">' + esc(r.type) + "</span></summary>" +
          '<div class="rec__body body">' + esc(r.summary) + '<p class="small muted">' + esc(r.provider) + " · " + esc(r.location) + "</p></div></details>";
      }).join(""), "card--full"));
    h.push('<div class="grid">' + g.join("") + "</div>");
    return h.join("");
  }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  // Open every record when printing so the PDF has the full history.
  window.addEventListener("beforeprint", function () {
    Array.prototype.forEach.call(document.querySelectorAll("details.rec"), function (d) { d.open = true; });
  });

  window.FabricPacket = { render: render, esc: esc };
})();
