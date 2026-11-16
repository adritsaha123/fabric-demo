/* Fabric for Clinics — paid front-desk portal (demo). */
(function () {
  "use strict";
  var D = window.FABRIC_DATA, Api = window.FabricApi, esc = window.FabricPacket.esc;
  var CLINIC = "Riverside Family Practice", clinicId = null;
  var MIN_PER_CHECKIN = 8;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- State ----------
  var stats = { fabricCheckins: 1, minutesSaved: MIN_PER_CHECKIN, issuesCaught: 0, outsideRecords: 3 };
  var schedule = [
    { time: "9:00 AM", name: "Maya Thompson", reason: "Follow-up, blood pressure", status: "done", via: "paper" },
    { time: "9:30 AM", name: "Jordan Lee", reason: "Sports physical", status: "done", via: "fabric" },
    { time: "10:30 AM", name: D.patient.name, reason: "New patient visit", status: "arriving", via: "", fabric: true },
    { time: "11:00 AM", name: "Priya Nair", reason: "Sore throat", status: "scheduled", via: "" },
    { time: "11:30 AM", name: "Sam Rivera", reason: "Annual physical", status: "scheduled", via: "" }
  ];
  var requests = [
    { patient: "Jordan Lee", to: "Campus Health Services", what: "All visits and immunizations, 2024–2026", signed: "Nov 10", sent: false },
    { patient: "Maya Thompson", to: "Dr. Okafor, Cardiology", what: "Labs and EKG from the last 12 months", signed: "Nov 11", sent: false },
    { patient: "Sam Rivera", to: "Patient (own copy)", what: "Complete record", signed: "Nov 12", sent: false }
  ];
  var current = null; // { keys, sharedAt, insuranceFixed }

  // ---------- Helpers ----------
  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg; t.hidden = false;
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }
  function bump(key, by) {
    stats[key] += by;
    renderStats();
    var el = $('[data-stat="' + key + '"]').closest(".stat");
    el.classList.remove("is-bumped"); void el.offsetWidth; el.classList.add("is-bumped");
  }
  function show(view) {
    $$(".view").forEach(function (v) { v.classList.toggle("is-active", v.getAttribute("data-view") === view); });
    $$(".nav__item").forEach(function (n) {
      n.classList.toggle("is-active", n.getAttribute("data-view") === (view === "packet" ? "checkin" : view));
    });
    var bar = $("#actions");
    if (bar) bar.hidden = view !== "packet";
    window.scrollTo(0, 0);
  }

  // ---------- Render ----------
  function renderStats() {
    Object.keys(stats).forEach(function (k) { $('[data-stat="' + k + '"]').textContent = stats[k]; });
  }
  function statusPill(r) {
    if (r.status === "done") return r.via === "fabric"
      ? '<span class="pill pill--fabric">✓ Checked in with Fabric</span>'
      : '<span class="pill pill--paper">✓ Checked in on paper</span>';
    if (r.status === "arriving") return '<span class="pill pill--wait">Arriving · has Fabric ID</span>';
    return '<span class="pill pill--paper">Scheduled</span>';
  }
  function renderSchedule() {
    $("#schedule").innerHTML = schedule.map(function (r, i) {
      var action = r.status === "arriving"
        ? '<button class="btn btn--primary btn--sm" type="button" data-scan>Scan Fabric ID</button>'
        : r.status === "scheduled" ? '<span class="small muted">Not here yet</span>' : "";
      return '<tr class="' + (r.fabric && r.status !== "done" ? "is-highlight" : "") + '">' +
        '<td class="label">' + esc(r.time) + "</td><td><strong>" + esc(r.name) + "</strong></td><td>" + esc(r.reason) + "</td>" +
        "<td>" + statusPill(r) + "</td><td>" + action + "</td></tr>";
    }).join("");
  }
  function renderRequests() {
    $("#requests").innerHTML = requests.map(function (q, i) {
      return '<div class="req' + (q.sent ? " is-sent" : "") + '">' +
        '<div class="req__col"><p class="label muted">PATIENT</p><p class="title">' + esc(q.patient) + '</p><span class="verified label">✓ Identity verified</span></div>' +
        '<div class="req__col"><p class="label muted">SEND TO</p><p class="body">' + esc(q.to) + '</p><p class="small muted">' + esc(q.what) + "</p></div>" +
        '<div class="req__col"><p class="label muted">AUTHORIZATION</p><p class="small">✓ Signed in Fabric, ' + esc(q.signed) + "</p></div>" +
        (q.sent
          ? '<span class="pill pill--done">✓ Sent just now</span>'
          : '<button class="btn btn--primary btn--sm" type="button" data-send="' + i + '">Review &amp; send</button>') +
        "</div>";
    }).join("");
    var open = requests.filter(function (q) { return !q.sent; }).length;
    var badge = $("#req-badge");
    badge.textContent = open; badge.hidden = !open;
  }
  function renderPacket() {
    $("#packet").innerHTML = window.FabricPacket.render({
      keys: current.keys, pro: true, sharedAt: current.sharedAt, expires: current.expires, insuranceFixed: current.insuranceFixed
    });
    if (!$("#actions")) {
      var bar = document.createElement("div");
      bar.className = "actions"; bar.id = "actions";
      bar.innerHTML =
        '<p class="small muted actions__note">Paid plan: imports straight to your records system.</p>' +
        '<button class="btn btn--light" type="button" data-action="pdf">Download PDF</button>' +
        '<button class="btn btn--secondary" type="button" data-action="import">Import to chart</button>' +
        '<button class="btn btn--primary" type="button" data-action="complete">Complete check-in</button>';
      document.body.appendChild(bar);
    }
    $('[data-action="import"]').textContent = "Import to chart"; // reset for each new patient
  }

  // ---------- Scan flow ----------
  var pendingRequest = null, stopWatch = null;
  function openScan() {
    if (!clinicId) return gate();
    $("#scan-scrim").hidden = false; $("#scan-modal").hidden = false;
    step(1); $("#scan-error").hidden = true;
    setTimeout(function () { $("#fabric-id").focus(); }, 50);
  }
  function closeScan() {
    $("#scan-scrim").hidden = true; $("#scan-modal").hidden = true;
    if (stopWatch) { stopWatch(); stopWatch = null; }
    if (pendingRequest) { Api.cancelRequest(pendingRequest).catch(function () {}); pendingRequest = null; }
  }
  function step(n) { [1, 2, 3].forEach(function (i) { $("#scan-step-" + i).hidden = i !== n; }); }
  function scanError(msg) { var err = $("#scan-error"); err.textContent = msg; err.hidden = false; }

  function startScan(rawId) {
    var id = String(rawId || "").trim();
    if (!id) return scanError("Enter a Fabric ID.");
    $("#scan-error").hidden = true;
    Api.requestConsent(clinicId, id).then(function (r) {
      if (!r.found) return scanError("No Fabric member with that ID.");
      pendingRequest = r.id;
      $("#waiting-text").textContent = "Sent to " + r.firstName + "’s phone. They choose what you can see.";
      $("#approve-error").hidden = true;
      step(2);
      stopWatch = Api.watchRequest(r.id, function (status) {
        stopWatch = null;
        if (status === "approved") loadPacket(r.id);
        else { pendingRequest = null; step(3); }
      });
    }).catch(function (err) { scanError(err.message); });
  }
  $("#scan-form").addEventListener("submit", function (e) {
    e.preventDefault();
    startScan($("#fabric-id").value);
  });

  // Demo: no camera, so "scanning" reads the Fabric ID of the patient signed in on this browser.
  function simulateScan() {
    Api.myFabricId().then(function (fid) {
      if (!fid) return scanError("Create a patient account in the patient app first, or type a Fabric ID.");
      $("#fabric-id").value = fid;
      startScan(fid);
    }).catch(function (err) { scanError(err.message); });
  }
  $("#simulate-scan").addEventListener("click", simulateScan);
  $("#simulate-scan-qr").addEventListener("click", simulateScan);

  function loadPacket(id) {
    pendingRequest = null;
    if (stopWatch) { stopWatch(); stopWatch = null; }
    Api.packet(id).then(function (p) {
      window.FabricData.load(p.data);
      closeScan();
      current = { keys: p.keys, sharedAt: p.sharedAt, expires: p.expires, insuranceFixed: false };
      var row = schedule.filter(function (r) { return r.fabric; })[0];
      if (row && row.status !== "done") { row.name = D.patient.name; renderSchedule(); }
      renderPacket();
      show("packet");
      toast(D.patient.name + " shared " + p.keys.length + " of " + D.shareItems.length + " sections.");
    }).catch(function (err) { closeScan(); toast(err.message); });
  }

  $("#simulate-approve").addEventListener("click", function () {
    var id = pendingRequest, btn = this;
    if (!id) return;
    btn.disabled = true;
    Api.approveAsPatient(id).then(function () { btn.disabled = false; loadPacket(id); })
      .catch(function (err) { btn.disabled = false; var e = $("#approve-error"); e.textContent = err.message; e.hidden = false; });
  });

  // ---------- Import to chart ----------
  var files = null;
  function exportFiles() {
    if (!files) {
      files = {
        fhir: JSON.stringify(window.FabricExport.fhirBundle(current.keys), null, 2),
        ccda: window.FabricExport.ccda(current.keys)
      };
    }
    return files;
  }
  function kb(s) { return (new Blob([s]).size / 1024).toFixed(1) + " KB"; }
  function openImport() {
    files = null;
    var f = exportFiles(), n = JSON.parse(f.fhir).entry.length;
    $("#fhir-meta").textContent = n + " resources · " + kb(f.fhir);
    $("#ccda-meta").textContent = (f.ccda.match(/<section>/g) || []).length + " sections · " + kb(f.ccda);
    $("#import-preview").hidden = true;
    $("#import-scrim").hidden = false; $("#import-modal").hidden = false;
  }
  function closeImport() { $("#import-scrim").hidden = true; $("#import-modal").hidden = true; }
  function showPreview(kind) {
    var f = exportFiles(), pre = $("#import-preview");
    pre.textContent = kind === "fhir" ? f.fhir : f.ccda.replace(/></g, ">\n<");
    pre.hidden = false; pre.scrollTop = 0;
  }
  function markImported(msg) {
    var btn = $('[data-action="import"]');
    if (btn) { btn.textContent = "✓ Imported"; }
    toast(msg);
  }

  // ---------- Clicks ----------
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("#open-scan") || t.closest("[data-scan]")) { openScan(); return; }
    if (t.closest("#scan-close") || t.closest("#scan-scrim") || t.closest("#declined-ok")) { closeScan(); return; }
    var nav = t.closest(".nav__item");
    if (nav) { show(nav.getAttribute("data-view")); return; }
    if (t.closest("#back-to-desk")) { show("checkin"); return; }

    if (t.closest("[data-close-import]") || t.closest("#import-scrim")) { closeImport(); return; }
    var prev = t.closest("[data-preview]");
    if (prev) { showPreview(prev.getAttribute("data-preview")); return; }
    var dl = t.closest("[data-download]");
    if (dl) {
      var kind = dl.getAttribute("data-download"), f = exportFiles();
      if (kind === "fhir") window.FabricExport.download(window.FabricExport.fileBase() + ".fhir.json", f.fhir, "application/fhir+json");
      else window.FabricExport.download(window.FabricExport.fileBase() + ".ccda.xml", f.ccda, "application/xml");
      markImported("Downloaded. Upload it to the patient’s chart.");
      return;
    }
    if (t.closest("#send-direct")) {
      closeImport();
      markImported("Sent to your chart inbox for a clinician to confirm (simulated).");
      return;
    }

    var send = t.closest("[data-send]");
    if (send) {
      var q = requests[+send.getAttribute("data-send")];
      q.sent = true; renderRequests();
      toast("Records sent to " + q.to + ". No fax needed.");
      return;
    }

    var act = t.closest("[data-action]");
    if (!act) return;
    var a = act.getAttribute("data-action");
    if (a === "fix-insurance") {
      current.insuranceFixed = true; renderPacket(); bump("issuesCaught", 1);
      toast("Member ID updated. One likely denial avoided.");
    } else if (a === "pdf") {
      window.print();
    } else if (a === "import") {
      openImport();
    } else if (a === "complete") {
      var row = schedule.filter(function (r) { return r.fabric; })[0];
      row.status = "done"; row.via = "fabric";
      renderSchedule(); show("checkin");
      bump("fabricCheckins", 1); bump("minutesSaved", MIN_PER_CHECKIN);
      if (current.keys.indexOf("records") !== -1) bump("outsideRecords", D.records.length);
      toast(D.patient.name + " is checked in. ~" + MIN_PER_CHECKIN + " min saved.");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("#import-modal").hidden) closeImport();
    else if (!$("#scan-modal").hidden) closeScan();
  });

  // ---------- Init ----------
  $("#today").textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  renderStats(); renderSchedule(); renderRequests();

  // ---------- Staff sign-in (cloud mode) ----------
  function joined(c) {
    clinicId = c.id; CLINIC = c.name;
    $("#clinic-name").textContent = c.name;
    $("#gate-scrim").hidden = true; $("#gate").hidden = true;
    $("#staff-signout").hidden = Api.mode !== "cloud";
  }
  function gate(msg) {
    $("#gate-scrim").hidden = false; $("#gate").hidden = false;
    var err = $("#gate-error"); err.textContent = msg || ""; err.hidden = !msg;
    setTimeout(function () { $("#gate-email").focus(); }, 50);
  }
  function gateSubmit(signUp) {
    var email = $("#gate-email").value.trim(), pw = $("#gate-pw").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return gate("Enter a valid email address.");
    if (pw.length < 8) return gate("Password must be at least 8 characters.");
    $$("#gate button").forEach(function (b) { b.disabled = true; });
    var run = signUp
      ? Api.signUp({ name: "Front Desk", dob: null, email: email, password: pw }).then(function (r) {
          if (r.needsConfirm) throw new Error("Check your email to confirm, then sign in.");
        })
      : Api.signIn(email, pw);
    run.then(function () { return Api.joinClinic(); }).then(joined)
      .catch(function (err) { gate(err.message); })
      .then(function () { $$("#gate button").forEach(function (b) { b.disabled = false; }); });
  }
  $("#gate-form").addEventListener("submit", function (e) { e.preventDefault(); gateSubmit(false); });
  $("#gate-signup").addEventListener("click", function () { gateSubmit(true); });
  $("#staff-signout").addEventListener("click", function () { Api.signOut().then(function () { location.reload(); }); });

  Api.ready.then(function () {
    if (Api.mode === "cloud" && !Api.signedIn()) return gate();
    return Api.joinClinic().then(joined);
  }).catch(function (err) { gate(err.message); });
})();
