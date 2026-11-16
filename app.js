(function () {
  "use strict";
  var Api = window.FabricApi, D = window.FABRIC_DATA;
  var APP_SCREENS = ["home", "timeline", "profile", "qr"];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ---------- Helpers ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function when(d) {
    var mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    if (mins < 1440) return Math.round(mins / 60) + " h ago";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function until(d) {
    var h = Math.max(0, Math.round((d - Date.now()) / 3600000));
    return h < 1 ? "Ends within the hour" : "Ends in " + h + " h";
  }

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function busy(btn, label) {
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    return function () { btn.disabled = false; btn.textContent = old; };
  }

  // ---------- Session ----------
  var loaded = false, stopWatching = null;
  function signedIn() { return Api.signedIn() && loaded; }
  function afterSignIn() {
    return Api.loadMyData().then(function (data) {
      window.FabricData.load(data);
      loaded = true;
      qrFor = null;
      if (!stopWatching) stopWatching = Api.watchRequests(onRequest);
    });
  }
  function signOut() {
    if (stopWatching) { stopWatching(); stopWatching = null; }
    loaded = false;
    return Api.signOut();
  }

  // ---------- Binding ----------
  function bindUser() {
    if (!D.patient) return;
    var parts = D.patient.name.trim().split(/\s+/), first = parts[0], rest = parts.slice(1).join(" ");
    var set = function (name, text) { $$('[data-bind="' + name + '"]').forEach(function (el) { el.textContent = text; }); };
    set("firstName", first);
    set("fullName", D.patient.name);
    set("fabricId", D.fabricId);
    set("insurer", D.insurance ? D.insurance.payer : "Not added");
    set("pharmacy", D.intake ? D.intake.pharmacy.split(",")[0] : "Not added");
    $$('[data-bind="fullNameStacked"]').forEach(function (el) {
      el.innerHTML = esc(first) + (rest ? "<br />" + esc(rest) : "");
    });
  }

  var qrFor = null;
  function renderQr() {
    var box = $("#qr-code");
    if (!window.QRCode || qrFor === D.fabricId) return;
    box.innerHTML = "";
    new window.QRCode(box, { text: D.fabricId, width: 250, height: 250, colorDark: "#31354a", colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M });
    box.removeAttribute("title");
    qrFor = D.fabricId;
  }

  // ---------- Timeline ----------
  var filterQuery = "";
  function renderTimeline() {
    var list = $("#entries");
    $$(".entry, .empty", list).forEach(function (n) { n.remove(); });
    var q = filterQuery.toLowerCase();
    var items = (D.records || []).filter(function (r) {
      return !q || [r.title, r.provider, r.clinic, r.location, r.type, r.date].join(" ").toLowerCase().indexOf(q) !== -1;
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
      b.innerHTML =
        '<span class="entry__text">' +
          '<span class="label entry__date">' + esc(r.date) + "</span>" +
          '<span class="title">' + esc(r.title) + "</span>" +
          '<span class="small">' + esc(r.providerShort ? r.providerShort + " · " + r.clinic : r.clinic) + "</span>" +
        "</span>" +
        '<img src="assets/icon-chevron-right.svg" width="20" height="20" alt="" />';
      list.appendChild(b);
    });
  }

  // ---------- Profile: who can see your records ----------
  function renderAccess() {
    Api.myAccess().then(function (a) {
      $("#access-active").innerHTML = a.active.length
        ? a.active.map(function (x) {
            return '<div class="details__row"><span class="access__who"><span>' + esc(x.who) + '</span><span class="small muted">' +
              until(x.expires) + '</span></span><button type="button" class="link small access__end" data-end="' + esc(x.kind) +
              '" data-id="' + esc(x.id) + '">End now</button></div>';
          }).join("")
        : '<div class="details__row"><span class="muted">No one right now</span></div>';
      $("#access-log").innerHTML = a.log.length
        ? a.log.map(function (l) {
            return '<div class="details__row"><span class="access__who"><span>' + esc(l.who) + '</span><span class="small muted">' +
              esc(l.detail) + "</span></span><span class=\"small muted\">" + when(l.at) + "</span></div>";
          }).join("")
        : '<div class="details__row"><span class="muted">Nothing yet</span></div>';
    }).catch(function () {
      $("#access-active").innerHTML = '<div class="details__row"><span class="muted">Couldn’t load right now.</span></div>';
    });
  }

  // ---------- Bottom sheet ----------
  var sheetHideTimer;
  function openSheet(html) {
    clearTimeout(sheetHideTimer);
    $("#sheet-body").innerHTML = html;
    var scrim = $("#scrim"), sheet = $("#sheet");
    scrim.hidden = false; sheet.hidden = false;
    requestAnimationFrame(function () { scrim.classList.add("is-open"); sheet.classList.add("is-open"); });
  }
  function closeSheet() {
    var scrim = $("#scrim"), sheet = $("#sheet");
    if (sheet.hidden) return;
    scrim.classList.remove("is-open"); sheet.classList.remove("is-open");
    sheetHideTimer = setTimeout(function () { scrim.hidden = true; sheet.hidden = true; }, 300);
  }
  function sheetHead(kicker, title) {
    return '<div class="sheet__title"><p class="label sheet__kicker">' + esc(kicker) + '</p><p class="h-m">' + esc(title) + "</p></div>";
  }

  // ---------- Sharing ----------
  function shareChecklist() {
    return '<div class="share-list">' + D.shareItems.map(function (i) {
      return '<label class="share-item"><input type="checkbox" name="share" value="' + i.key + '" checked />' +
        '<span class="checkbox"><img src="assets/icon-check.svg" width="16" height="16" alt="" /></span>' +
        "<span>" + esc(i.label) + "</span></label>";
    }).join("") + "</div>";
  }
  function checkedKeys() {
    return $$('#sheet-body input[name="share"]:checked').map(function (c) { return c.value; });
  }

  var pendingConsent = null;
  function onRequest(ev) {
    if (ev.type === "request") {
      if (!signedIn()) return;
      pendingConsent = ev;
      openSheet(
        sheetHead("SHARE REQUEST", ev.clinic + " wants your records") +
        '<p class="small">Choose what they can see. Access ends in 24 hours.</p>' +
        shareChecklist() +
        '<div class="sheet__actions"><button class="btn btn--primary" type="button" data-consent="approve">Share selected</button>' +
        '<button class="btn btn--secondary" type="button" data-consent="decline">Don’t share</button></div>'
      );
    } else if (ev.type === "gone" && pendingConsent && ev.id === pendingConsent.id) {
      pendingConsent = null;
      closeSheet();
      toast("The clinic finished check-in");
    }
  }

  function shareLinkSheet() {
    return sheetHead("SHARE WITH ANY CLINIC", "Create a secure link") +
      '<p class="small">Opens in any browser, no account needed. Expires in 24 hours.</p>' +
      shareChecklist() +
      '<div class="sheet__actions"><button class="btn btn--primary" type="button" data-share-link>Create link</button></div>';
  }
  function linkReadySheet(url) {
    return sheetHead("LINK READY", "Send this to the clinic") +
      '<p class="share-url" id="share-url">' + esc(url) + "</p>" +
      '<div class="sheet__actions"><button class="btn btn--primary" type="button" data-copy-link>Copy link</button>' +
      '<a class="btn btn--secondary" href="' + esc(url) + '" target="_blank" rel="noopener">Open it</a></div>';
  }

  function recordSheet(r) {
    return sheetHead(r.type, r.title) +
      '<div class="kv small">' +
        '<div class="kv__row"><span>Date</span><span>' + esc(r.date) + " · " + esc(r.time) + "</span></div>" +
        '<div class="kv__row"><span>Provider</span><span>' + esc(r.provider) + "</span></div>" +
        '<div class="kv__row"><span>Location</span><span>' + esc(r.location) + "</span></div>" +
      "</div>" +
      '<p class="body">' + esc(r.summary) + "</p>" +
      '<button class="btn btn--light" type="button" data-close>Close</button>';
  }

  function transferSheet() {
    var steps = [
      ["done", "Request sent", "Nov 4 · Brown Health records office"],
      ["current", "Clinic reviewing", "Usually 2–5 business days"],
      ["todo", "Delivered to RI Hospital", "We’ll notify you"]
    ];
    return sheetHead("RECORDS TRANSFER", "Brown Health → RI Hospital") +
      '<div class="progress"><div class="progress__fill"></div></div>' +
      '<div class="steps">' + steps.map(function (s, i) {
        return '<div class="step step--' + s[0] + '"><span class="step__dot">' + (s[0] === "done" ? "✓" : i + 1) + "</span>" +
          '<span><p class="title">' + s[1] + '</p><p class="small">' + s[2] + "</p></span></div>";
      }).join("") + "</div>" +
      '<button class="btn btn--primary" type="button" data-toast="Reminder sent to Brown Health">Send a reminder</button>';
  }

  function insuranceSheet() {
    var i = D.insurance;
    return sheetHead("INSURANCE", "Insurance card") +
      '<div class="ins-card">' +
        '<div class="ins-card__row"><span class="title">' + esc(i.payer) + '</span><span class="label">' + esc(i.plan) + "</span></div>" +
        '<div><p class="label">MEMBER</p><p class="title">' + esc(D.patient.name) + "</p></div>" +
        '<div class="ins-card__row">' +
          '<div><p class="label">MEMBER ID</p><p class="body">' + esc(i.memberId) + "</p></div>" +
          '<div><p class="label">GROUP</p><p class="body">' + esc(i.group) + "</p></div>" +
        "</div>" +
      "</div>" +
      '<button class="btn btn--primary" type="button" data-close>Done</button>';
  }

  function newPasswordSheet() {
    return sheetHead("ACCOUNT", "Set a new password") +
      '<form class="form" id="new-password-form" novalidate>' +
        '<label class="field"><span class="label">New password</span><span class="input">' +
          '<img src="assets/icon-lock.svg" width="20" height="20" alt="" />' +
          '<input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required /></span></label>' +
        '<p class="form__error small" hidden></p>' +
        '<button class="btn btn--primary" type="submit">Save password</button>' +
      "</form>";
  }

  // ---------- Router ----------
  function route() {
    var name = (location.hash || "").replace(/^#/, "") || (signedIn() ? "home" : "opening");
    if (!$('[data-screen="' + name + '"]')) name = "opening";
    if (APP_SCREENS.indexOf(name) !== -1 && !signedIn()) name = "signin";
    if ((name === "signin" || name === "signup" || name === "opening") && signedIn()) name = "home";
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);

    if (!pendingConsent) closeSheet();
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

    bindUser();
    if (name === "timeline") renderTimeline();
    if (name === "qr") renderQr();
    if (name === "profile") renderAccess();
    ($(".content", screen) || screen).scrollTop = 0;
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  // ---------- Forms ----------
  function showError(form, msg, input, isNote) {
    var err = $(".form__error", form);
    err.textContent = msg;
    err.hidden = false;
    err.classList.toggle("form__note", !!isNote);
    $$(".input", form).forEach(function (i) { i.classList.remove("is-invalid"); });
    if (input) { input.closest(".input").classList.add("is-invalid"); input.focus(); }
  }
  function clearError(form) {
    $(".form__error", form).hidden = true;
    $$(".input", form).forEach(function (i) { i.classList.remove("is-invalid"); });
  }

  $("#signin-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, email = f.email.value.trim(), pw = f.password.value;
    if (!EMAIL_RE.test(email)) return showError(f, "Enter a valid email address.", f.email);
    if (!pw) return showError(f, "Enter your password.", f.password);
    clearError(f);
    var done = busy($('button[type="submit"]', f), "Signing in…");
    Api.signIn(email, pw).then(afterSignIn).then(function () {
      done(); f.reset(); go("#home");
    }).catch(function (err) { done(); showError(f, err.message); });
  });

  $("#forgot").addEventListener("click", function () {
    var f = $("#signin-form"), email = f.email.value.trim();
    if (!EMAIL_RE.test(email)) return showError(f, "Enter your email above, then tap Forgot password.", f.email);
    Api.resetPassword(email).then(function () {
      showError(f, Api.mode === "cloud" ? "If that email has an account, a reset link is on its way." : "Demo mode: no email is sent.", null, true);
    }).catch(function (err) { showError(f, err.message); });
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
    var mm = +dob.slice(0, 2), dd = +dob.slice(2, 4), yyyy = +dob.slice(4);
    if (name.split(/\s+/).length < 2) return showError(f, "Enter your first and last name.", f.name);
    if (dob.length !== 8 || mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900 || yyyy > new Date().getFullYear())
      return showError(f, "Enter your date of birth as MM / DD / YYYY.", f.dob);
    if (!EMAIL_RE.test(email)) return showError(f, "Enter a valid email address.", f.email);
    if (pw.length < 8) return showError(f, "Password must be at least 8 characters.", f.password);
    if (!f.terms.checked) return showError(f, "Please agree to the Terms and Privacy Policy.");
    clearError(f);
    var done = busy($('button[type="submit"]', f), "Creating account…");
    var iso = dob.slice(4) + "-" + dob.slice(0, 2) + "-" + dob.slice(2, 4);
    Api.signUp({ name: name, dob: iso, email: email, password: pw }).then(function (r) {
      if (r.needsConfirm) {
        done(); f.reset();
        go("#signin");
        showError($("#signin-form"), "Check your email to confirm your account, then sign in.", null, true);
        return;
      }
      return afterSignIn().then(function () {
        done(); f.reset(); go("#home");
        toast("Welcome to Fabric, " + name.split(/\s+/)[0] + "!");
      });
    }).catch(function (err) { done(); showError(f, err.message); });
  });

  // ---------- Clicks ----------
  document.addEventListener("click", function (e) {
    var t = e.target;

    var rec = t.closest("[data-record]");
    if (rec) {
      var r = (D.records || []).filter(function (x) { return x.id === rec.getAttribute("data-record"); })[0];
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
      var ok = consent.getAttribute("data-consent") === "approve", keys = checkedKeys(), req = pendingConsent;
      if (ok && !keys.length) { toast("Choose at least one thing to share"); return; }
      var done = busy(consent, ok ? "Sharing…" : "One moment…");
      Api.respond(req.id, ok, ok ? keys : [], req.clinic).then(function () {
        pendingConsent = null;
        closeSheet();
        toast(ok ? "Shared with " + req.clinic : "Nothing was shared");
        if (location.hash === "#profile") renderAccess();
      }).catch(function (err) { done(); pendingConsent = null; closeSheet(); toast(err.message); });
      return;
    }
    var mk = t.closest("[data-share-link]");
    if (mk) {
      var linkKeys = checkedKeys();
      if (!linkKeys.length) { toast("Choose at least one thing to share"); return; }
      var doneLink = busy(mk, "Creating…");
      Api.createShareLink(linkKeys).then(function (url) {
        openSheet(linkReadySheet(url));
      }).catch(function (err) { doneLink(); toast(err.message); });
      return;
    }
    if (t.closest("[data-copy-link]")) {
      var url = $("#share-url").textContent;
      var copied = navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject();
      copied.then(function () { toast("Link copied"); }, function () { toast("Press and hold the link to copy it"); });
      return;
    }
    var end = t.closest("[data-end]");
    if (end) {
      end.disabled = true;
      Api.endAccess(end.getAttribute("data-end"), end.getAttribute("data-id")).then(function () {
        toast("Access ended"); renderAccess();
      }).catch(function (err) { end.disabled = false; toast(err.message); });
      return;
    }
    var toaster = t.closest("[data-toast]");
    if (toaster) { e.preventDefault(); toast(toaster.getAttribute("data-toast")); return; }

    if (t.closest("#scrim") || t.closest(".sheet__grabber") || t.closest("[data-close]")) {
      if (!pendingConsent) closeSheet();
      return;
    }
    if (t.closest("#logout")) { signOut().then(function () { go("#opening"); }); return; }
    if (t.closest("#clear-filter")) { filterQuery = ""; renderTimeline(); }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.id !== "new-password-form") return;
    e.preventDefault();
    var f = e.target, pw = f.password.value;
    if (pw.length < 8) return showError(f, "Password must be at least 8 characters.", f.password);
    Api.updatePassword(pw).then(function () { closeSheet(); toast("Password updated"); })
      .catch(function (err) { showError(f, err.message); });
  });

  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pendingConsent) closeSheet(); });

  $("#home-search").addEventListener("submit", function (e) {
    e.preventDefault();
    filterQuery = e.target.q.value.trim();
    e.target.reset();
    if (location.hash === "#timeline") renderTimeline(); else location.hash = "#timeline";
  });
  $$("#navbar a").forEach(function (a) {
    a.addEventListener("click", function () { if (a.getAttribute("data-tab") === "timeline") filterQuery = ""; });
  });

  // ---------- Boot ----------
  window.addEventListener("hashchange", route);
  window.addEventListener("load", function () { if (location.hash === "#qr") renderQr(); });
  Api.ready
    .then(function () { return Api.signedIn() ? afterSignIn() : null; })
    .catch(function (err) { toast(err.message); })
    .then(function () {
      route();
      Api.onRecovery(function () { openSheet(newPasswordSheet()); });
    });
})();
