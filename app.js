(function () {
  "use strict";

  // ---------- Demo data ----------
  var RECORDS = window.FABRIC_DATA.records; // shared with the clinic portal (shared.js)

  var DEFAULT_USER = { name: "Adrit Saha", email: "adrit@example.com" };
  var APP_SCREENS = ["home", "timeline", "profile", "qr"];
  var STORAGE_KEY = "fabric-demo-user";

  // ---------- Helpers ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function loadUser() {
    try { var raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return memUser; }
  }
  var memUser = null;
  function saveUser(u) {
    memUser = u;
    try { if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); else localStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage blocked: keep in memory */ }
  }
  function currentUser() { return loadUser() || memUser; }

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  // ---------- User binding ----------
  function bindUser() {
    var u = currentUser() || DEFAULT_USER;
    var parts = u.name.trim().split(/\s+/);
    var first = parts[0];
    var rest = parts.slice(1).join(" ");
    $$('[data-bind="firstName"]').forEach(function (el) { el.textContent = first; });
    $$('[data-bind="fullName"]').forEach(function (el) { el.textContent = u.name; });
    $$('[data-bind="fullNameStacked"]').forEach(function (el) {
      el.innerHTML = esc(first) + (rest ? "<br />" + esc(rest) : "");
    });
  }

  // ---------- Timeline ----------
  var filterQuery = "";
  function renderTimeline() {
    var list = $("#entries");
    $$(".entry, .empty", list).forEach(function (n) { n.remove(); });
    var q = filterQuery.toLowerCase();
    var items = RECORDS.filter(function (r) {
      if (!q) return true;
      return [r.title, r.provider, r.clinic, r.location, r.type, r.date].join(" ").toLowerCase().indexOf(q) !== -1;
    });
    list.classList.toggle("entries--filtered", !!q);
    var filterBar = $(".filter");
    filterBar.hidden = !q;
    $("span", filterBar).textContent = items.length + " result" + (items.length === 1 ? "" : "s") + " for “" + filterQuery + "”";

    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "empty body";
      empty.textContent = "No records match your search.";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "entry";
      b.setAttribute("data-record", r.id);
      var sub = r.providerShort ? r.providerShort + " · " + r.clinic : r.clinic;
      b.innerHTML =
        '<span class="entry__text">' +
          '<span class="label entry__date">' + esc(r.date) + "</span>" +
          '<span class="title">' + esc(r.title) + "</span>" +
          '<span class="small">' + esc(sub) + "</span>" +
        "</span>" +
        '<img src="assets/icon-chevron-right.svg" width="20" height="20" alt="" />';
      list.appendChild(b);
    });
  }

  // ---------- Bottom sheet ----------
  var sheetHideTimer;
  function openSheet(html) {
    clearTimeout(sheetHideTimer);
    $("#sheet-body").innerHTML = html;
    var scrim = $("#scrim"), sheet = $("#sheet");
    scrim.hidden = false; sheet.hidden = false;
    requestAnimationFrame(function () {
      scrim.classList.add("is-open"); sheet.classList.add("is-open");
    });
  }
  function closeSheet() {
    var scrim = $("#scrim"), sheet = $("#sheet");
    if (sheet.hidden) return;
    scrim.classList.remove("is-open"); sheet.classList.remove("is-open");
    sheetHideTimer = setTimeout(function () { scrim.hidden = true; sheet.hidden = true; }, 300);
  }

  // ---------- Sharing with clinics ----------
  // Patients choose what each clinic sees, whether or not the clinic pays for Fabric.
  function shareChecklist() {
    return '<div class="share-list">' + window.FABRIC_DATA.shareItems.map(function (i) {
      return '<label class="share-item"><input type="checkbox" name="share" value="' + i.key + '" checked />' +
        '<span class="checkbox"><img src="assets/icon-check.svg" width="16" height="16" alt="" /></span>' +
        "<span>" + esc(i.label) + "</span></label>";
    }).join("") + "</div>";
  }
  function checkedKeys() {
    return $$('#sheet-body input[name="share"]:checked').map(function (c) { return c.value; });
  }
  var pendingConsent = null;
  function consentSheet(msg) {
    return (
      '<div class="sheet__title"><p class="label sheet__kicker">SHARE REQUEST</p><p class="h-m">' + esc(msg.clinic) + " wants to see your records</p></div>" +
      '<p class="small">They scanned your Fabric ID at check-in. Choose what they can see. Access ends in 24 hours.</p>' +
      shareChecklist() +
      '<div class="sheet__actions"><button class="btn btn--primary" type="button" data-consent="approve">Share selected</button>' +
      '<button class="btn btn--secondary" type="button" data-consent="decline">Don’t share</button></div>'
    );
  }
  function shareLinkSheet() {
    return (
      '<div class="sheet__title"><p class="label sheet__kicker">SHARE WITH ANY CLINIC</p><p class="h-m">Create a secure link</p></div>' +
      '<p class="small">Works at any clinic, even one that doesn’t use Fabric. They open it in a browser, with no account. It expires in 24 hours.</p>' +
      shareChecklist() +
      '<div class="sheet__actions"><button class="btn btn--primary" type="button" data-share-link>Create link and open it</button></div>'
    );
  }
  window.FabricBus.on(function (msg) {
    if (msg.type === "consent-request") {
      if (!currentUser()) return; // signed out: the clinic can still use its demo fallback
      pendingConsent = msg;
      openSheet(consentSheet(msg));
    } else if (msg.type === "consent-cancel" && pendingConsent && msg.requestId === pendingConsent.id) {
      pendingConsent = null;
      closeSheet();
      toast("The clinic finished check-in");
    }
  });

  function recordSheet(r) {
    return (
      '<div class="sheet__title"><p class="label sheet__kicker">' + esc(r.type) + '</p><p class="h-m">' + esc(r.title) + "</p></div>" +
      '<div class="kv small">' +
        '<div class="kv__row"><span>Date</span><span>' + esc(r.date) + " · " + esc(r.time) + "</span></div>" +
        '<div class="kv__row"><span>Provider</span><span>' + esc(r.provider) + "</span></div>" +
        '<div class="kv__row"><span>Location</span><span>' + esc(r.location) + "</span></div>" +
      "</div>" +
      '<p class="title">Visit summary</p>' +
      '<p class="body">' + esc(r.summary) + "</p>" +
      '<button class="btn btn--primary" type="button" data-toast="Full record viewer coming soon (demo)">View full record</button>'
    );
  }

  function transferSheet() {
    var steps = [
      ["done", "Request sent", "Nov 4 · Sent to Brown Health records office"],
      ["current", "Clinic reviewing", "Typically 2–5 business days. We’ll follow up for you."],
      ["todo", "Delivered to RI Hospital", "You’ll get a notification when records arrive."]
    ];
    return (
      '<div class="sheet__title"><p class="label sheet__kicker">RECORDS TRANSFER</p><p class="h-m">Brown Health → RI Hospital</p></div>' +
      '<div class="progress"><div class="progress__fill"></div></div>' +
      '<div class="steps">' +
        steps.map(function (s, i) {
          return '<div class="step step--' + s[0] + '"><span class="step__dot">' + (s[0] === "done" ? "✓" : i + 1) + "</span>" +
            '<span><p class="title">' + s[1] + '</p><p class="small">' + s[2] + "</p></span></div>";
        }).join("") +
      "</div>" +
      '<div class="kv small">' +
        '<div class="kv__row"><span>Records</span><span>All visits, labs, imaging</span></div>' +
        '<div class="kv__row"><span>Requested</span><span>Nov 4, 2026</span></div>' +
      "</div>" +
      '<button class="btn btn--primary" type="button" data-toast="We nudged Brown Health for you (demo)">Send a reminder</button>'
    );
  }

  function insuranceSheet() {
    var u = currentUser() || DEFAULT_USER;
    return (
      '<div class="sheet__title"><p class="label sheet__kicker">INSURANCE</p><p class="h-m">Insurance card</p></div>' +
      '<div class="ins-card">' +
        '<div class="ins-card__row"><span class="title">Blue Cross Blue Shield</span><span class="label">PPO</span></div>' +
        '<div><p class="label">MEMBER</p><p class="title">' + esc(u.name) + "</p></div>" +
        '<div class="ins-card__row">' +
          '<div><p class="label">MEMBER ID</p><p class="body">XYZ 8842 1093</p></div>' +
          '<div><p class="label">GROUP</p><p class="body">00417</p></div>' +
        "</div>" +
      "</div>" +
      '<p class="small">Show this card at the front desk. Demo data only.</p>' +
      '<button class="btn btn--primary" type="button" data-close>Done</button>'
    );
  }

  // ---------- QR refresh countdown ----------
  var qrInterval, qrRemaining = 300;
  function startQrTimer() {
    stopQrTimer();
    qrRemaining = 300;
    tickQr();
    qrInterval = setInterval(function () {
      qrRemaining -= 1;
      if (qrRemaining <= 0) {
        var code = $(".qr__code");
        code.classList.add("is-refreshing");
        setTimeout(function () { code.classList.remove("is-refreshing"); }, 400);
        qrRemaining = 300;
      }
      tickQr();
    }, 1000);
  }
  function tickQr() {
    var m = Math.floor(qrRemaining / 60), s = qrRemaining % 60;
    $("#qr-timer").textContent = m + ":" + (s < 10 ? "0" : "") + s;
  }
  function stopQrTimer() { clearInterval(qrInterval); }

  // ---------- Router ----------
  function route() {
    var name = (location.hash || "").replace(/^#/, "") || (currentUser() ? "home" : "opening");
    if (!$('[data-screen="' + name + '"]')) name = "opening";
    if (APP_SCREENS.indexOf(name) !== -1 && !currentUser()) name = "signin";
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);

    closeSheet();
    $$(".screen").forEach(function (s) { s.classList.toggle("is-active", s.getAttribute("data-screen") === name); });

    var screen = $('[data-screen="' + name + '"]');
    var tab = screen.getAttribute("data-tab");
    var nav = $("#navbar");
    nav.hidden = !tab;
    $$("a", nav).forEach(function (a) {
      var active = a.getAttribute("data-tab") === tab;
      a.classList.toggle("is-active", active);
      if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });

    if (name === "timeline") renderTimeline();
    if (name === "qr") startQrTimer(); else stopQrTimer();
    var scroller = $(".content", screen) || screen;
    scroller.scrollTop = 0;
    bindUser();
  }

  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }

  // ---------- Forms ----------
  function showError(form, msg, input) {
    var err = $(".form__error", form);
    err.textContent = msg;
    err.hidden = false;
    $$(".input", form).forEach(function (i) { i.classList.remove("is-invalid"); });
    if (input) { input.closest(".input").classList.add("is-invalid"); input.focus(); }
  }
  function clearError(form) {
    $(".form__error", form).hidden = true;
    $$(".input", form).forEach(function (i) { i.classList.remove("is-invalid"); });
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  $("#signin-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, email = f.email.value.trim(), pw = f.password.value;
    if (!EMAIL_RE.test(email)) return showError(f, "Enter a valid email address.", f.email);
    if (!pw) return showError(f, "Enter your password.", f.password);
    clearError(f);
    var existing = currentUser();
    var name = existing && existing.email === email ? existing.name : DEFAULT_USER.name;
    saveUser({ name: name, email: email });
    f.reset();
    go("#home");
  });

  var dobInput = $('#signup-form [name="dob"]');
  dobInput.addEventListener("input", function () {
    var d = dobInput.value.replace(/\D/g, "").slice(0, 8);
    var out = d.slice(0, 2);
    if (d.length > 2) out += " / " + d.slice(2, 4);
    if (d.length > 4) out += " / " + d.slice(4);
    dobInput.value = out;
  });

  $("#signup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    var name = f.name.value.trim(), email = f.email.value.trim(), pw = f.password.value;
    var dob = f.dob.value.replace(/\D/g, "");
    if (name.split(/\s+/).length < 2) return showError(f, "Enter your first and last name.", f.name);
    var mm = +dob.slice(0, 2), dd = +dob.slice(2, 4), yyyy = +dob.slice(4);
    if (dob.length !== 8 || mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900 || yyyy > 2026)
      return showError(f, "Enter your date of birth as MM / DD / YYYY.", f.dob);
    if (!EMAIL_RE.test(email)) return showError(f, "Enter a valid email address.", f.email);
    if (pw.length < 8) return showError(f, "Password must be at least 8 characters.", f.password);
    if (!f.terms.checked) return showError(f, "Please agree to the Terms and Privacy Policy.");
    clearError(f);
    saveUser({ name: name, email: email });
    f.reset();
    go("#home");
    toast("Welcome to Fabric, " + name.split(/\s+/)[0] + "!");
  });

  // ---------- Global clicks ----------
  document.addEventListener("click", function (e) {
    var t = e.target;

    var rec = t.closest("[data-record]");
    if (rec) {
      var r = RECORDS.filter(function (x) { return x.id === rec.getAttribute("data-record"); })[0];
      if (r) openSheet(recordSheet(r));
      return;
    }
    var opener = t.closest("[data-open]");
    if (opener) {
      var which = opener.getAttribute("data-open");
      openSheet(which === "transfer" ? transferSheet() : which === "share-link" ? shareLinkSheet() : insuranceSheet());
      return;
    }
    var consent = t.closest("[data-consent]");
    if (consent && pendingConsent) {
      var ok = consent.getAttribute("data-consent") === "approve";
      var keys = checkedKeys();
      if (ok && !keys.length) { toast("Choose at least one thing to share"); return; }
      window.FabricBus.send({ type: "consent-response", requestId: pendingConsent.id, approved: ok, items: keys });
      toast(ok ? "Shared with " + pendingConsent.clinic : "Nothing was shared");
      pendingConsent = null;
      closeSheet();
      return;
    }
    if (t.closest("[data-share-link]")) {
      var linkKeys = checkedKeys();
      if (!linkKeys.length) { toast("Choose at least one thing to share"); return; }
      var url = "view.html?k=" + linkKeys.join(",") + "&t=" + Date.now();
      window.open(url, "_blank", "noopener");
      try { navigator.clipboard.writeText(new URL(url, location.href).href); } catch (err) { /* clipboard unavailable */ }
      closeSheet();
      toast("Link created. It works at any clinic for 24 hours.");
      return;
    }
    var toaster = t.closest("[data-toast]");
    if (toaster) { e.preventDefault(); toast(toaster.getAttribute("data-toast")); return; }

    if (t.closest("#scrim") || t.closest(".sheet__grabber") || t.closest("[data-close]")) { closeSheet(); return; }

    if (t.closest("#logout")) {
      saveUser(null);
      go("#opening");
      return;
    }
    if (t.closest("#emergency")) { toast("Emergency contacts coming soon (demo)"); return; }
    if (t.closest("#clear-filter")) { filterQuery = ""; renderTimeline(); }
  });

  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

  $("#home-search").addEventListener("submit", function (e) {
    e.preventDefault();
    filterQuery = e.target.q.value.trim();
    e.target.reset();
    if (location.hash === "#timeline") renderTimeline(); else location.hash = "#timeline";
  });

  // Nav tab clicks clear any timeline search
  $$("#navbar a").forEach(function (a) {
    a.addEventListener("click", function () { if (a.getAttribute("data-tab") === "timeline") filterQuery = ""; });
  });

  window.addEventListener("hashchange", route);
  route();
})();
