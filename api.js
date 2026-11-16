/* Fabric data layer. Pages call FabricApi the same way in both modes:
   - cloud: Supabase, when config.js has a URL and anon key
   - local: offline demo, nothing leaves this browser
   Every call returns a Promise. Errors carry a message that is safe to show. */
(function () {
  "use strict";
  var CFG = window.FABRIC_CONFIG || {};
  var CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  var SB_SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  var D = window.FABRIC_DATA, Bus = window.FabricBus;
  var ALL_KEYS = D.shareItems.map(function (i) { return i.key; });
  var DAY = 24 * 3600 * 1000;

  function base() { return location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, ""); }
  function usDate(iso) { if (!iso) return ""; var p = String(iso).slice(0, 10).split("-"); return p[1] + "/" + p[2] + "/" + p[0]; }
  function store(key, val) {
    try {
      if (val === undefined) { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* storage blocked */ }
    return val;
  }
  function friendly(err) {
    var m = (err && (err.message || err.error_description)) || String(err || "Something went wrong");
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/already registered|already exists/i.test(m)) return "An account with this email already exists. Sign in instead.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first, then sign in.";
    if (/failed to fetch|network|load failed/i.test(m)) return "Couldn’t reach Fabric. Check your connection and try again.";
    if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
    return m;
  }
  function fail(err) { throw new Error(friendly(err)); }

  // =========================================================== cloud (Supabase)
  function cloudApi() {
    var sb = null, uid = null, openRequest = null;
    function unwrap(r) { if (r.error) fail(r.error); return r.data; }
    function rpc(name, args) { return sb.rpc(name, args || {}).then(unwrap); }
    function toData(row) {
      var h = row.health || {};
      var d = JSON.parse(JSON.stringify(h));
      d.fabricId = row.fabric_id;
      d.patient = Object.assign({}, h.patient, { name: row.full_name, dob: usDate(row.dob) });
      if (d.insurance) d.insurance.subscriber = row.full_name;
      return d;
    }
    function packet(p) {
      return {
        data: Object.assign({}, p, { insurance: p.insurance && Object.assign({}, p.insurance, { subscriber: p.patient.name }) }),
        keys: p.items || [], sharedAt: new Date(p.sharedAt), expires: new Date(p.expires)
      };
    }
    var ready = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = SB_SRC;
      s.onload = resolve;
      s.onerror = function () { reject(new Error(friendly("Failed to fetch"))); };
      document.head.appendChild(s);
    }).then(function () {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      sb.auth.onAuthStateChange(function (ev, session) { uid = session ? session.user.id : null; });
      return sb.auth.getSession().then(function (r) { uid = r.data.session ? r.data.session.user.id : null; });
    });

    return {
      mode: "cloud",
      ready: ready,
      signedIn: function () { return !!uid; },
      signUp: function (o) {
        return sb.auth.signUp({ email: o.email, password: o.password,
          options: { data: { full_name: o.name, dob: o.dob }, emailRedirectTo: base() + "index.html" } })
          .then(unwrap).then(function (d) { return { needsConfirm: !d.session }; });
      },
      signIn: function (email, pw) { return sb.auth.signInWithPassword({ email: email, password: pw }).then(unwrap); },
      signOut: function () { return sb.auth.signOut(); },
      resetPassword: function (email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: base() + "index.html" }).then(unwrap); },
      updatePassword: function (pw) { return sb.auth.updateUser({ password: pw }).then(unwrap); },
      onRecovery: function (cb) { sb.auth.onAuthStateChange(function (ev) { if (ev === "PASSWORD_RECOVERY") cb(); }); },

      // ---- patient
      loadMyData: function () {
        var cols = "fabric_id, full_name, dob, health";
        return sb.from("patients").select(cols).eq("id", uid).maybeSingle().then(unwrap).then(function (row) {
          if (row) return row;
          // First sign-in: create the patient row, seeded with fictional demo records.
          return sb.auth.getUser().then(unwrap).then(function (d) {
            var meta = d.user.user_metadata || {}, health = window.FabricData.demo();
            delete health.fabricId; delete health.patient.name; delete health.patient.dob;
            health.patient.email = d.user.email;
            return sb.from("patients").insert({
              id: d.user.id, full_name: meta.full_name || d.user.email.split("@")[0], dob: meta.dob || null, health: health
            }).select(cols).single().then(unwrap);
          });
        }).then(toData);
      },
      createShareLink: function (items) {
        return sb.from("share_links").insert({ items: items }).select("token").single().then(unwrap)
          .then(function (r) { return base() + "view.html?s=" + r.token; });
      },
      watchRequests: function (cb) {
        function poll() {
          if (document.hidden || !uid) return;
          sb.from("consent_requests").select("id, clinic_name, created_at")
            .eq("patient_id", uid).eq("status", "pending")
            .gt("created_at", new Date(Date.now() - 15 * 60000).toISOString())
            .order("created_at", { ascending: false }).limit(1)
            .then(function (r) {
              if (r.error) return;
              var row = r.data[0];
              if (row && (!openRequest || openRequest !== row.id)) { openRequest = row.id; cb({ type: "request", id: row.id, clinic: row.clinic_name }); }
              else if (!row && openRequest) { cb({ type: "gone", id: openRequest }); openRequest = null; }
            });
        }
        poll();
        var t = setInterval(poll, 3000);
        return function () { clearInterval(t); };
      },
      respond: function (id, approve, items) {
        return rpc("respond_consent", { p_request: id, p_approve: approve, p_items: items })
          .then(function () { openRequest = null; });
      },
      myAccess: function () {
        var now = new Date().toISOString();
        return Promise.all([
          sb.from("consent_requests").select("id, clinic_name, expires_at").eq("patient_id", uid).eq("status", "approved").gt("expires_at", now).then(unwrap),
          sb.from("share_links").select("token, expires_at").eq("revoked", false).gt("expires_at", now).then(unwrap),
          sb.from("access_log").select("actor, detail, at").order("at", { ascending: false }).limit(5).then(unwrap)
        ]).then(function (r) {
          return {
            // One row per clinic, even after several check-ins. "End now" ends them all.
            active: r[0].reduce(function (rows, c) {
              var row = rows.filter(function (x) { return x.who === c.clinic_name; })[0], exp = new Date(c.expires_at);
              if (row) { row.id += "," + c.id; if (exp > row.expires) row.expires = exp; }
              else rows.push({ kind: "clinic", id: c.id, who: c.clinic_name, expires: exp });
              return rows;
            }, [])
              .concat(r[1].map(function (l) { return { kind: "link", id: l.token, who: "Shared link", expires: new Date(l.expires_at) }; })),
            log: r[2].map(function (l) { return { who: l.actor, detail: l.detail, at: new Date(l.at) }; })
          };
        });
      },
      endAccess: function (kind, id) {
        return kind === "clinic"
          ? Promise.all(String(id).split(",").map(function (one) { return rpc("end_consent", { p_request: one }); }))
          : sb.from("share_links").update({ revoked: true }).eq("token", id).then(unwrap);
      },
      sharedSummary: function (params) {
        var token = params.get("s");
        if (!token) return Promise.resolve({ ok: false, reason: "invalid" });
        return rpc("get_shared_summary", { p_token: token }).then(function (p) {
          return p.ok ? Object.assign({ ok: true }, packet(p)) : p;
        });
      },

      // ---- clinic
      joinClinic: function () { return rpc("join_demo_clinic"); },
      myFabricId: function () {
        return sb.from("patients").select("fabric_id").eq("id", uid).maybeSingle().then(unwrap)
          .then(function (r) { return r ? r.fabric_id : null; });
      },
      requestConsent: function (clinicId, fabricId) { return rpc("request_consent", { p_clinic: clinicId, p_fabric_id: fabricId }); },
      watchRequest: function (id, cb) {
        var stopped = false;
        function poll() {
          if (stopped) return;
          sb.from("consent_requests").select("status").eq("id", id).maybeSingle().then(function (r) {
            if (stopped || r.error || !r.data) return;
            if (r.data.status !== "pending") { stopped = true; clearInterval(t); cb(r.data.status); }
          });
        }
        var t = setInterval(poll, 2000);
        return function () { stopped = true; clearInterval(t); };
      },
      cancelRequest: function (id) { return rpc("cancel_consent", { p_request: id }); },
      approveAsPatient: function (id) {
        return rpc("respond_consent", { p_request: id, p_approve: true, p_items: ALL_KEYS }).catch(function () {
          throw new Error("Only the patient can approve, from their Fabric app.");
        });
      },
      packet: function (id) { return rpc("get_consented_packet", { p_request: id }).then(packet); }
    };
  }

  // =========================================================== local (offline demo)
  function localApi() {
    var USER = "fabric-demo-user", ACCESS = "fabric-demo-access";
    var approvedItems = {};
    function user() { return store(USER); }
    function access() { return store(ACCESS) || { active: [], log: [] }; }
    function addAccess(entry, logLine) {
      var a = access(), now = Date.now();
      a.active = a.active.filter(function (x) { return x.expires > now; });
      a.active.unshift(entry);
      a.log.unshift(logLine);
      a.log = a.log.slice(0, 5);
      store(ACCESS, a);
    }
    var ok = function (v) { return Promise.resolve(v); };

    return {
      mode: "local",
      ready: Promise.resolve(),
      signedIn: function () { return !!user(); },
      signUp: function (o) { store(USER, { name: o.name, email: o.email, dob: o.dob }); return ok({ needsConfirm: false }); },
      signIn: function (email) {
        var u = user();
        store(USER, u && u.email === email ? u : { name: D.patient.name, email: email });
        return ok();
      },
      signOut: function () { store(USER, null); return ok(); },
      resetPassword: function () { return ok(); },
      updatePassword: function () { return ok(); },
      onRecovery: function () {},

      loadMyData: function () {
        var u = user() || {}, d = window.FabricData.demo();
        if (u.name) { d.patient.name = u.name; d.insurance.subscriber = u.name; }
        if (u.dob) d.patient.dob = usDate(u.dob);
        return ok(d);
      },
      createShareLink: function (items) {
        var t = Date.now();
        addAccess({ kind: "link", id: String(t), who: "Shared link", expires: t + DAY }, { who: "Shared link", detail: "Created", at: t });
        return ok(base() + "view.html?k=" + items.join(",") + "&t=" + t);
      },
      watchRequests: function (cb) {
        Bus.on(function (msg) {
          if (msg.type === "consent-request") cb({ type: "request", id: msg.id, clinic: msg.clinic });
          if (msg.type === "consent-cancel") cb({ type: "gone", id: msg.requestId });
        });
        return function () {};
      },
      respond: function (id, approve, items, clinic) {
        Bus.send({ type: "consent-response", requestId: id, approved: approve, items: items });
        if (approve) addAccess({ kind: "clinic", id: id, who: clinic, expires: Date.now() + DAY },
          { who: clinic, detail: "Viewed your records at check-in", at: Date.now() });
        return ok();
      },
      myAccess: function () {
        var a = access(), now = Date.now();
        return ok({
          active: a.active.filter(function (x) { return x.expires > now; }).map(function (x) { return Object.assign({}, x, { expires: new Date(x.expires) }); }),
          log: a.log.map(function (x) { return Object.assign({}, x, { at: new Date(x.at) }); })
        });
      },
      endAccess: function (kind, id) {
        var a = access();
        a.active = a.active.filter(function (x) { return x.id !== id; });
        store(ACCESS, a);
        return ok();
      },
      sharedSummary: function (params) {
        var keys = (params.get("k") || "").split(",").filter(function (k) { return ALL_KEYS.indexOf(k) !== -1; });
        var t = +params.get("t") || 0;
        if (!keys.length || !t) return ok({ ok: false, reason: "invalid" });
        if (Date.now() > t + DAY) return ok({ ok: false, reason: "expired" });
        return ok({ ok: true, data: window.FabricData.demo(), keys: keys, sharedAt: new Date(t), expires: new Date(t + DAY) });
      },

      joinClinic: function () { return ok({ id: "local", name: "Riverside Family Practice" }); },
      myFabricId: function () { return ok(D.fabricId); },
      requestConsent: function (clinicId, fabricId) {
        var id = String(fabricId || "").trim().toUpperCase().replace(/\s+/g, "");
        if (id !== window.FabricData.demo().fabricId) return ok({ found: false });
        var reqId = Bus.send({ type: "consent-request", clinic: "Riverside Family Practice", items: ALL_KEYS });
        return ok({ found: true, id: reqId, firstName: D.patient.name.split(" ")[0] });
      },
      watchRequest: function (id, cb) {
        var stopped = false;
        Bus.on(function (msg) {
          if (stopped || msg.type !== "consent-response" || msg.requestId !== id) return;
          stopped = true;
          approvedItems[id] = msg.items;
          cb(msg.approved ? "approved" : "declined");
        });
        return function () { stopped = true; };
      },
      cancelRequest: function (id) { Bus.send({ type: "consent-cancel", requestId: id }); return ok(); },
      approveAsPatient: function (id) {
        Bus.send({ type: "consent-cancel", requestId: id }); // close the prompt if a patient tab is open
        approvedItems[id] = ALL_KEYS;
        return ok();
      },
      packet: function (id) {
        return ok({ data: window.FabricData.demo(), keys: approvedItems[id] || ALL_KEYS, sharedAt: new Date(), expires: new Date(Date.now() + DAY) });
      }
    };
  }

  window.FabricApi = CLOUD ? cloudApi() : localApi();
})();
