/* ============================================================
   Jankrats — app logic (no build step, no dependencies)
   Persistence: localStorage, namespaced per browser/viewer.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- constants ---------------- */

  var STORAGE_PREFIX = "jankvault:v1:";
  var KEYS = {
    cards: STORAGE_PREFIX + "cards",
    collection: STORAGE_PREFIX + "collection",
    decks: STORAGE_PREFIX + "decks",
    profile: STORAGE_PREFIX + "profile",
    theme: STORAGE_PREFIX + "theme",
    lastAuthProvider: STORAGE_PREFIX + "lastAuthProvider"
  };

  var DOMAINS = {
    Fury: { color: "var(--d-fury)" },
    Calm: { color: "var(--d-calm)" },
    Mind: { color: "var(--d-mind)" },
    Chaos: { color: "var(--d-chaos)" },
    Body: { color: "var(--d-body)" },
    Order: { color: "var(--d-order)" }
  };
  var DOMAIN_NAMES = Object.keys(DOMAINS);

  var CARD_TYPES = ["Legend", "Unit", "Spell", "Gear", "Battlefield", "Rune", "Token"];

  // Riftbound's real card data has no distinct "Champion" type — a Chosen
  // Champion is a deckbuilding role you assign to a Unit card (one whose
  // name follows the "Name, Epithet" pattern, e.g. "Ahri, Alluring") that
  // matches your Legend's identity and domains. This heuristic mirrors that.
  function isChampionEligible(card) {
    return !!card && card.type === "Unit" && /,/.test(card.name || "");
  }

  var RULES = {
    mainDeckSize: 40,
    maxCopies: 3,
    runeDeckSize: 12,
    battlefieldCount: 3,
    sideboardSizes: [0, 8]
  };

  /* ---------------- tiny helpers ---------------- */

  function uid(prefix) {
    return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function safeParse(str, fallback) {
    try { var v = JSON.parse(str); return v === undefined ? fallback : v; }
    catch (e) { return fallback; }
  }

  function loadJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      return safeParse(raw, fallback);
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast("Couldn't save — your browser storage may be full or blocked.");
      return false;
    }
  }

  // Bilgewater Market's card URLs use the same id as ours minus the
  // "/<setSize>" suffix, e.g. our "OGN-066a/298" -> their "/cards/OGN-066a".
  // Bilgewater 404s on a bare id whenever the card's only printing is a
  // special variant -- it needs an explicit ?print_variation matching the
  // suffix on our own id (verified against their live pages): "*" is their
  // "signature" parallel, a lone "a" is their "showcase"/alt-art print.
  function bilgewaterUrl(card) {
    var base = "https://bilgewatermarket.com/cards/" + encodeURIComponent(String(card.id).split("/")[0]);
    var suf = variantSuffixOf(card);
    if (suf === "*") return base + "?print_variation=signature";
    if (suf === "a") return base + "?print_variation=showcase";
    return base;
  }

  function domainColor(name) {
    return (DOMAINS[name] && DOMAINS[name].color) || "var(--d-none)";
  }

  // Domain chips show a small rune-glyph icon (pre-cropped, transparent
  // PNGs in assets/domains/) instead of a flat color dot.
  var DOMAIN_RUNE_ICONS = {
    Fury: "assets/domains/fury.png",
    Calm: "assets/domains/calm.png",
    Mind: "assets/domains/mind.png",
    Chaos: "assets/domains/chaos.png",
    Body: "assets/domains/body.png",
    Order: "assets/domains/order.png"
  };

  function domainChip(name) {
    var img = DOMAIN_RUNE_ICONS[name];
    var icon = img
      ? '<span class="domain-rune-icon" style="background-image:url(\'' + escapeHtml(img) + '\')"></span>'
      : '<span class="dot" style="background:' + domainColor(name) + '"></span>';
    return '<span class="domain-chip">' + icon + escapeHtml(name) + "</span>";
  }

  function domainChips(list) {
    if (!list || !list.length) return '<span class="domain-chip"><span class="dot" style="background:var(--d-none)"></span>Colorless</span>';
    return list.map(domainChip).join(" ");
  }

  /* ---------------- card data ----------------
     REAL_CARDS is the full official Riftbound card database (name, set,
     type, rarity, domain, energy cost, power, and tags for every printed
     card) pulled from Riot's own card gallery. Ability/rules text is
     intentionally NOT included at this scale, and card art is linked to
     Riot's CDN rather than re-hosted here. This is what the app loads by
     default. DEMO_CARDS below is a small set of invented placeholder
     cards kept around as an offline fallback and as an Import example. */

  var REAL_CARDS = (window.__RIFTBOUND_CARDS__ || []).map(function (c) {
    return {
      id: c.id, name: c.name, set: c.set, setName: c.setName,
      collectorNumber: c.collectorNumber, type: c.type, domains: c.domains || [],
      rarity: c.rarity, cost: c.cost, power: c.power, tags: c.tags || [],
      imageUrl: c.imageUrl || null, text: "", isPlaceholder: false
    };
  });

  var DEMO_CARDS = [
    { id: "JANK-001", name: "Bargain-Bin Baron", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "001", type: "Legend", domains: ["Body", "Chaos"], rarity: "Legend", cost: null, power: null, text: "Legend. Grants access to Body and Chaos. Once per turn, you may swap a card in your hand for a random one from your sideboard, free of charge, no refunds.", isPlaceholder: true },
    { id: "JANK-002", name: "Sir Reginald, Duct-Taped", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "002", type: "Unit", domains: ["Body"], rarity: "Epic", cost: 4, power: 5, text: "Chosen Champion. Held together by hope and adhesive. When Sir Reginald blocks, he gains +1/+1 until the mechanism fails.", isPlaceholder: true },
    { id: "JANK-003", name: "Clearance Rack Golem", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "003", type: "Unit", domains: ["Body"], rarity: "Common", cost: 3, power: 3, text: "Was 6 energy, now 3 energy. Ask about our other deals.", isPlaceholder: true },
    { id: "JANK-004", name: "Overclocked Bilgerat", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "004", type: "Unit", domains: ["Chaos"], rarity: "Uncommon", cost: 2, power: 3, text: "When played, deal 1 damage to a random target. Including, occasionally, its own team.", isPlaceholder: true },
    { id: "JANK-005", name: "Receipt of Doom", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "005", type: "Spell", domains: ["Chaos"], rarity: "Common", cost: 1, power: null, text: "Deal 2 damage to an enemy unit. It's non-refundable.", isPlaceholder: true },
    { id: "JANK-006", name: "Warranty Void Ritual", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "006", type: "Spell", domains: ["Body", "Chaos"], rarity: "Rare", cost: 5, power: null, text: "Destroy target Gear. Draw a card. The manufacturer is not liable for damages.", isPlaceholder: true },
    { id: "JANK-007", name: "Half-Price Cutlass", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "007", type: "Gear", domains: ["Chaos"], rarity: "Common", cost: 2, power: null, text: "Equipped unit gets +2/+0. Blade sold separately from handle.", isPlaceholder: true },
    { id: "JANK-008", name: "Dockside Discount", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "008", type: "Unit", domains: ["Body"], rarity: "Common", cost: 1, power: 1, text: "When played, gain 1 energy next turn if you haven't spent any this turn.", isPlaceholder: true },
    { id: "JANK-009", name: "Anchor Dump", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "009", type: "Battlefield", domains: [], rarity: "Common", cost: null, power: null, text: "Battlefield. Units here gain +0/+1. The tide smells faintly of regret.", isPlaceholder: true },
    { id: "JANK-010", name: "Rune of Body", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "R-BODY", type: "Rune", domains: ["Body"], rarity: "Rune", cost: null, power: null, text: "Rune. Provides Body energy.", isPlaceholder: true },
    { id: "JANK-011", name: "Rune of Chaos", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "R-CHAOS", type: "Rune", domains: ["Chaos"], rarity: "Rune", cost: null, power: null, text: "Rune. Provides Chaos energy.", isPlaceholder: true },
    { id: "JANK-012", name: "Big Discount Brawler, Clearance Special", set: "JANK", setName: "Jankrats Demo Set", collectorNumber: "010", type: "Unit", domains: ["Chaos"], rarity: "Epic", cost: 6, power: 8, text: "Chosen Champion. Everything about this card was too expensive except this card.", isPlaceholder: true }
  ];

  /* ---------------- state ---------------- */

  var state = {
    cards: [],
    cardsById: {},
    collection: {},
    decks: [],
    profile: { name: "" },
    route: "dashboard",
    builder: { deckId: null, tab: "main", cardFilter: "" },
    sharedDeck: null,
    social: {
      session: null,           // Supabase auth session, or null when signed out
      myProfile: null,         // row from public.profiles for the signed-in user
      followingIds: [],        // ids the signed-in user follows
      feedPosts: null,         // null = not loaded yet, [] = loaded & empty
      feedComposer: "deck",    // "deck" | "pull" — which composer tab is open
      openComments: {},        // postId -> comments array, once expanded/loaded
      topCards: null,
      profileTargetId: null,   // whose profile the Profile view is showing
      profileData: null,
      profilePosts: null,
      myActivityPosts: null,   // signed-in user's own posts, shown on the Dashboard
      pushEnabled: false,
      friendsProfiles: null,        // null = not loaded yet, [] = loaded & empty
      friendsMode: "mine",          // "mine" = added friends only, "add" = browse everyone
      friendsTargetId: null,        // whose collection/decks the Friends view is showing
      friendsTargetProfile: null,
      friendsTargetCollection: null, // cardId -> {qty, foil} for friendsTargetId
      friendsTargetDecks: null,      // that friend's decks, or [] once loaded & empty
      friendsDetailTab: "collection", // "collection" | "decks", within a friend's page
      friendsViewingDeckId: null     // set once you drill into one of their decks
    }
  };

  function rebuildCardIndex() {
    state.cardsById = {};
    state.cards.forEach(function (c) { state.cardsById[c.id] = c; });
  }

  function loadAll() {
    state.cards = loadJSON(KEYS.cards, null) || (REAL_CARDS.length ? REAL_CARDS.slice() : DEMO_CARDS.slice());
    if (!loadJSON(KEYS.cards, null)) saveJSON(KEYS.cards, state.cards);
    rebuildCardIndex();
    state.collection = loadJSON(KEYS.collection, {});
    state.decks = loadJSON(KEYS.decks, []);
    state.profile = loadJSON(KEYS.profile, { name: "" });
  }

  function persistCards() { saveJSON(KEYS.cards, state.cards); }
  function persistCollection() { saveJSON(KEYS.collection, state.collection); }
  function persistDecks() {
    saveJSON(KEYS.decks, state.decks);
    syncDecksToCloud();
  }

  // Fire-and-forget, mirroring syncCollectionEntryToCloud: keeps the
  // signed-in player's cloud decks (what the Friends tab reads) in step
  // with every local deck edit.
  function syncDecksToCloud() {
    if (!JVBackend.isConfigured() || !JVBackend.currentUserId() || !state.decks.length) return;
    JVBackend.bulkUpsertDecks(state.decks).catch(function () {
      toast("Couldn't sync your decks to your account.");
    });
  }
  function persistProfile() { saveJSON(KEYS.profile, state.profile); }

  /* ---------------- collection helpers ---------------- */

  function getOwned(cardId) {
    var e = state.collection[cardId];
    return e ? (e.qty || 0) : 0;
  }
  function getOwnedFoil(cardId) {
    var e = state.collection[cardId];
    return e ? (e.foil || 0) : 0;
  }
  function setOwned(cardId, qty, foil) {
    qty = clamp(qty, 0, 999);
    foil = clamp(foil, 0, 999);
    if (qty === 0 && foil === 0) { delete state.collection[cardId]; }
    else { state.collection[cardId] = { qty: qty, foil: foil }; }
    persistCollection();
    syncCollectionEntryToCloud(cardId, qty, foil);
  }

  // Fire-and-forget: keeps the signed-in player's cloud collection (which
  // the Friends tab reads) in step with every local qty/foil change.
  function syncCollectionEntryToCloud(cardId, qty, foil) {
    if (!JVBackend.isConfigured() || !JVBackend.currentUserId()) return;
    JVBackend.upsertCollectionEntry(cardId, qty, foil).catch(function () {
      toast("Couldn't sync that to your account — saved locally only.");
    });
  }

  /* ---------------- toast ---------------- */

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ---------------- router ---------------- */

  var VIEWS = ["dashboard", "cards", "collection", "friends", "decks", "profile", "import", "shared"];

  // Maps a route name to/from a clean URL path, e.g. "collection" <->
  // "/collection", with "dashboard" living at the bare root "/".
  function pathToView(pathname) {
    var seg = (pathname || "").replace(/^\/+|\/+$/g, "");
    if (!seg) return "dashboard";
    return VIEWS.indexOf(seg) !== -1 ? seg : null;
  }
  function viewToPath(view) {
    return view === "dashboard" ? "/" : "/" + view;
  }

  function navigate(view) {
    if (VIEWS.indexOf(view) === -1) view = "dashboard";
    if (view !== "import" && voiceImportState.listening) stopVoiceListening();
    state.route = view;
    var path = viewToPath(view);
    if (window.location.pathname !== path) window.history.pushState({ view: view }, "", path);
    render();
  }

  function openProfile(userId) {
    var selfId = JVBackend.currentUserId ? JVBackend.currentUserId() : null;
    if (!userId || userId === selfId) { navigate("dashboard"); return; }
    state.social.profileTargetId = userId;
    state.social.profileData = null;
    state.social.profilePosts = null;
    navigate("profile");
  }

  function currentDeck() {
    if (!state.builder.deckId) return null;
    var d = state.decks.filter(function (d) { return d.id === state.builder.deckId; })[0];
    return d || null;
  }

  /* ================================================================
     RENDER: shell
     ================================================================ */

  function render() {
    renderRail();
    VIEWS.forEach(function (v) {
      var el = document.getElementById("view-" + v);
      if (el) el.classList.toggle("active", v === state.route);
    });
    if (state.route === "dashboard") renderDashboard();
    if (state.route === "cards") renderCardsView();
    if (state.route === "collection") renderCollectionView();
    if (state.route === "friends") renderFriendsView();
    if (state.route === "decks") renderDecksView();
    if (state.route === "profile") renderProfileView();
    if (state.route === "import") renderImportView();
    if (state.route === "shared") renderSharedView();
  }

  function renderRail() {
    document.querySelectorAll(".nav button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === state.route);
    });
    var nameInput = document.getElementById("profile-name");
    if (nameInput && document.activeElement !== nameInput) nameInput.value = state.profile.name || "";
    var authHost = document.getElementById("social-auth-host");
    if (authHost) { authHost.innerHTML = authRailHtml(); wireAuthRail(authHost); }
  }

  /* ================================================================
     RENDER: dashboard
     ================================================================ */

  function renderDashboard() {
    var el = document.getElementById("view-dashboard");
    var uniqueOwned = Object.keys(state.collection).length;
    var totalOwned = 0;
    Object.keys(state.collection).forEach(function (k) {
      totalOwned += (state.collection[k].qty || 0) + (state.collection[k].foil || 0);
    });

    var recentDecks = state.decks.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, 5);

    var banner = state.profile.banner;

    var html = "";
    html += '<div class="profile-banner">' +
      (banner ? '<img class="profile-banner-img" src="' + splashUrl(banner.champ, banner.num) + '" data-fallback="' + splashUrlFallback(banner.champ, banner.num) + '" alt="">' : "") +
      '<div class="profile-banner-overlay"><h1>Welcome' + (state.profile.name ? ", " + escapeHtml(state.profile.name) : "") + '.</h1>' +
      '<button class="btn small" id="change-banner-btn">' + (banner ? "Change banner" : "Choose a banner") + "</button></div></div>";

    html += '<div class="view-head"><div><p>Your ledger for tracking the Riftbound cards you own and the jank decks you keep building instead of the meta ones.</p></div>' +
      '<button class="btn primary" data-action="new-deck">+ New deck</button></div>';

    html += '<div class="stat-row">' +
      statCard(totalOwned, "Total cards owned") +
      statCard(uniqueOwned, "Unique cards owned") +
      statCard(state.decks.length, "Decks brewed") +
      "</div>";

    html += '<div class="section-block"><h2>Recent decks</h2>';
    if (!recentDecks.length) {
      html += '<div class="empty-state"><h3>No decks yet</h3><p>Pick a Legend and start brewing — even a bad idea deserves a decklist.</p></div>';
    } else {
      html += '<div class="deck-row-list">' + recentDecks.map(deckRowHtml).join("") + "</div>";
    }
    html += "</div>";

    var showActivity = JVBackend.isConfigured() && state.social.session;
    if (showActivity) html += myActivityHtml();

    el.innerHTML = html;

    wireImgFallback(el.querySelector(".profile-banner-img"));
    el.querySelector('[data-action="new-deck"]').addEventListener("click", function () { navigate("decks"); startNewDeck(); });
    el.querySelectorAll("[data-open-deck]").forEach(function (row) {
      row.addEventListener("click", function () { openDeck(row.getAttribute("data-open-deck")); navigate("decks"); });
    });
    el.querySelector("#change-banner-btn").addEventListener("click", openBannerPicker);

    if (showActivity) {
      wirePostCards(el);
      var pushBtn = el.querySelector("#push-toggle-btn");
      if (pushBtn) pushBtn.addEventListener("click", function () {
        if (state.social.pushEnabled) {
          JVBackend.disablePush().then(function () { state.social.pushEnabled = false; renderDashboard(); });
        } else {
          JVBackend.enablePush().then(function () { state.social.pushEnabled = true; toast("Notifications enabled."); renderDashboard(); })
            .catch(function () { toast("Couldn't enable notifications — check your browser's notification permission."); });
        }
      });
      if (state.social.myActivityPosts === null) {
        JVBackend.listPosts({ authorId: JVBackend.currentUserId(), limit: 50 }).then(function (posts) {
          state.social.myActivityPosts = posts;
          if (state.route === "dashboard") renderDashboard();
        });
      }
    }
  }

  function myActivityHtml() {
    var html = "";
    if (JVBackend.pushSupported()) {
      html += '<div class="callout" style="margin-bottom:16px;">Get notified when someone you follow posts, or when someone comments on your post. ' +
        '<button class="btn small" id="push-toggle-btn" style="margin-left:8px;">' + (state.social.pushEnabled ? "Notifications on" : "Enable notifications") + "</button></div>";
    }
    html += '<div class="section-block"><h2>Your activity</h2><div id="my-activity-host">';
    if (state.social.myActivityPosts === null) {
      html += '<p style="font-size:13px;color:var(--ink-faint);">Loading…</p>';
    } else if (!state.social.myActivityPosts.length) {
      html += '<div class="empty-state"><h3>No posts yet</h3><p>Nothing posted yet.</p></div>';
    } else {
      html += state.social.myActivityPosts.map(postCardHtml).join("");
    }
    html += "</div></div>";
    return html;
  }

  /* ---- League of Legends champion splash banner picker ---- */

  // "Centered" splash art keeps the champion in frame regardless of how the
  // banner crops it — the original splash art varies wildly in composition
  // (subject off to one side, high/low, etc.) so a fixed background-position
  // can't reliably keep the character visible across thousands of images.
  //
  // Community Dragon's champion keys occasionally differ from Data Dragon's
  // `id` field for historic reasons (e.g. Fiddlesticks was renamed at the
  // API level but Community Dragon still keys it under the old spelling).
  var CENTERED_ID_OVERRIDES = { Fiddlesticks: "FiddleSticks" };

  function splashUrl(champId, num) {
    var cdId = CENTERED_ID_OVERRIDES[champId] || champId;
    return CHAMPION_SPLASH_CENTERED_BASE + cdId + "/splash-art/centered/skin/" + num;
  }

  // A small (128x128) square portrait instead of full splash art — used for
  // the first-step champion grid (173 of them) so it doesn't have to pull
  // down ~170 multi-hundred-KB splash images just to list the champions.
  // Full splash art is still used once you're picking a specific skin.
  function splashSquareUrl(champId) {
    var cdId = CENTERED_ID_OVERRIDES[champId] || champId;
    return CHAMPION_SPLASH_CENTERED_BASE + cdId + "/square";
  }

  // Community Dragon's centered-art generation lags behind brand-new skin
  // releases by a bit, so very recent skins can 404 there even though the
  // skin itself is live. Data Dragon's regular (uncentered) splash art is
  // generated straight from the client patch, so it's always present as a
  // fallback — the crop just isn't guaranteed to be centered.
  function splashUrlFallback(champId, num) {
    return CHAMPION_SPLASH_BASE + champId + "_" + num + ".jpg";
  }

  function wireImgFallback(img) {
    if (!img) return;
    img.addEventListener("error", function () {
      var fb = img.getAttribute("data-fallback");
      if (fb && img.src !== fb) img.src = fb;
    }, { once: true });
  }

  function findChampSplashEntry(id) {
    for (var i = 0; i < CHAMPION_SPLASHES.length; i++) if (CHAMPION_SPLASHES[i][0] === id) return CHAMPION_SPLASHES[i];
    return null;
  }

  var bannerPickerState = { search: "", champId: null };

  function openBannerPicker() {
    bannerPickerState = { search: "", champId: null };
    renderBannerPickerModal();
  }

  function renderBannerPickerModal() {
    var root = document.getElementById("modal-root");
    var html = '<div class="modal-backdrop" id="banner-modal"><div class="modal modal-wide">';
    var entry = bannerPickerState.champId ? findChampSplashEntry(bannerPickerState.champId) : null;

    if (!entry) {
      html += '<div class="modal-head"><h2 style="font-size:19px;">Choose a banner — pick a champion</h2><button class="modal-close" data-close>&times;</button></div>';
      html += '<input type="search" id="banner-champ-search" placeholder="Search champions…" value="' + escapeHtml(bannerPickerState.search) + '" style="margin-bottom:12px;width:100%;">';
      var q = bannerPickerState.search.toLowerCase();
      var champs = CHAMPION_SPLASHES.filter(function (c) { return !q || c[1].toLowerCase().indexOf(q) !== -1; });
      html += '<div class="champ-picker-grid">' + champs.map(function (c) {
        return '<button class="champ-tile" data-pick-champ="' + c[0] + '">' +
          '<span class="champ-tile-img"><img src="' + splashSquareUrl(c[0]) + '" data-fallback="' + splashUrlFallback(c[0], 0) + '" alt="" loading="lazy"></span>' +
          '<span class="champ-tile-name">' + escapeHtml(c[1]) + "</span></button>";
      }).join("") + "</div>";
    } else {
      html += '<div class="modal-head"><h2 style="font-size:19px;">' + escapeHtml(entry[1]) + ' — pick a skin</h2><button class="modal-close" data-close>&times;</button></div>';
      html += '<button class="btn small ghost" id="banner-back-btn" style="margin-bottom:12px;">&larr; All champions</button>';
      html += '<div class="champ-picker-grid skins">' + entry[2].map(function (s) {
        return '<button class="champ-tile" data-pick-skin="' + s[0] + '">' +
          '<span class="champ-tile-img"><img src="' + splashUrl(entry[0], s[0]) + '" data-fallback="' + splashUrlFallback(entry[0], s[0]) + '" alt="" loading="lazy"></span>' +
          '<span class="champ-tile-name">' + escapeHtml(s[1]) + "</span></button>";
      }).join("") + "</div>";
    }

    html += "</div></div>";
    root.innerHTML = html;

    root.querySelectorAll(".champ-tile-img img").forEach(wireImgFallback);
    root.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeModal); });
    var backdrop = root.querySelector("#banner-modal");
    backdrop.addEventListener("click", function (e) { if (e.target.id === "banner-modal") closeModal(); });

    var search = root.querySelector("#banner-champ-search");
    if (search) {
      search.focus();
      var caret = search.value.length;
      search.setSelectionRange(caret, caret);
      search.addEventListener("input", function () {
        bannerPickerState.search = search.value;
        rerenderSoft(null, renderBannerPickerModal);
      });
    }
    root.querySelectorAll("[data-pick-champ]").forEach(function (b) {
      b.addEventListener("click", function () { bannerPickerState.champId = b.getAttribute("data-pick-champ"); renderBannerPickerModal(); });
    });
    var backBtn = root.querySelector("#banner-back-btn");
    if (backBtn) backBtn.addEventListener("click", function () { bannerPickerState.champId = null; bannerPickerState.search = ""; renderBannerPickerModal(); });
    root.querySelectorAll("[data-pick-skin]").forEach(function (b) {
      b.addEventListener("click", function () {
        var num = parseInt(b.getAttribute("data-pick-skin"), 10);
        state.profile.banner = { champ: entry[0], num: num };
        persistProfile();
        closeModal();
        renderDashboard();
      });
    });
  }

  function statCard(num, label) {
    return '<div class="stat-card"><div class="num tabular">' + escapeHtml(num) + '</div><div class="label">' + escapeHtml(label) + "</div></div>";
  }

  function deckRowHtml(d) {
    var issues = computeLegality(d);
    var legal = issues.every(function (i) { return i.ok; });
    return '<div class="deck-row" data-open-deck="' + d.id + '">' +
      '<div class="drn">' + escapeHtml(d.name || "Unnamed deck") + "</div>" +
      '<div class="drdomains">' + (d.domains || []).map(domainChip).join("") + "</div>" +
      '<div class="drspacer"></div>' +
      '<div class="drmeta">' + mainDeckCount(d) + "/" + RULES.mainDeckSize + " main</div>" +
      '<span class="pill ' + (legal ? "good" : "warn") + '">' + (legal ? "Legal" : issues.filter(function(i){return !i.ok;}).length + " issue(s)") + "</span>" +
      "</div>";
  }

  /* ================================================================
     RENDER: card database
     ================================================================ */

  function filteredCards(opts) {
    opts = opts || {};
    var q = (opts.q || "").toLowerCase();
    return state.cards.filter(function (c) {
      if (q && (c.name + " " + (c.text || "")).toLowerCase().indexOf(q) === -1) return false;
      if (opts.domain && (c.domains || []).indexOf(opts.domain) === -1) return false;
      if (opts.type && c.type !== opts.type) return false;
      if (opts.rarity && c.rarity !== opts.rarity) return false;
      if (opts.set && c.set !== opts.set) return false;
      return true;
    });
  }

  function uniqueValues(field) {
    var seen = {}; var out = [];
    state.cards.forEach(function (c) {
      var v = c[field];
      if (v && !seen[v]) { seen[v] = true; out.push(v); }
    });
    return out.sort();
  }

  var cardsFilterState = { q: "", domain: "", type: "", rarity: "", set: "", sort: "name", limit: 60 };
  var CARDS_PAGE_SIZE = 60;

  function renderCardsView() {
    var el = document.getElementById("view-cards");
    var list = filteredCards(cardsFilterState);
    list = sortCards(list, cardsFilterState.sort);
    var total = list.length;
    var shown = Math.min(cardsFilterState.limit || CARDS_PAGE_SIZE, total);
    var page = list.slice(0, shown);

    var html = '<div class="view-head"><div><h1>Explore Cards</h1><p>' + state.cards.length + ' cards loaded. Search, filter, and click a card to see the full text or log how many you own.</p></div></div>';

    html += '<div class="toolbar">' +
      field("Search", '<input type="search" id="cf-q" placeholder="Name or text…" value="' + escapeHtml(cardsFilterState.q) + '">') +
      field("Domain", selectHtml("cf-domain", optionList(["", "Any"], DOMAIN_NAMES, cardsFilterState.domain))) +
      field("Type", selectHtml("cf-type", optionList(["", "Any"], CARD_TYPES, cardsFilterState.type))) +
      field("Rarity", selectHtml("cf-rarity", optionList(["", "Any"], uniqueValues("rarity"), cardsFilterState.rarity))) +
      field("Set", selectHtml("cf-set", optionList(["", "Any"], uniqueValues("set"), cardsFilterState.set))) +
      field("Sort", selectHtml("cf-sort", explicitOptions([["name", "Name"], ["cost", "Cost"]], cardsFilterState.sort))) +
      "</div>";

    if (!total) {
      html += '<div class="empty-state"><h3>No cards match</h3><p>Try clearing a filter, or head to Import to add cards.</p></div>';
    } else {
      html += '<p style="font-size:12.5px;color:var(--ink-faint);margin-bottom:10px;">Showing ' + shown + ' of ' + total + "</p>";
      html += '<div class="card-grid">' + page.map(cardTileHtml).join("") + "</div>";
      if (shown < total) html += '<div style="text-align:center;margin-top:18px;"><button class="btn" id="cf-load-more">Show ' + Math.min(CARDS_PAGE_SIZE, total - shown) + ' more (' + (total - shown) + ' left)</button></div>';
    }

    el.innerHTML = html;
    wireCardFilterToolbar(el, renderCardsView);
    el.querySelectorAll("[data-card-id]").forEach(function (t) {
      t.addEventListener("click", function () { openCardDetail(t.getAttribute("data-card-id")); });
    });
    var loadMoreBtn = document.getElementById("cf-load-more");
    if (loadMoreBtn) loadMoreBtn.addEventListener("click", function () { cardsFilterState.limit = (cardsFilterState.limit || CARDS_PAGE_SIZE) + CARDS_PAGE_SIZE; renderCardsView(); });
  }

  function sortCards(list, sort) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      if (sort === "cost") return (a.cost === null || a.cost === undefined ? 99 : a.cost) - (b.cost === null || b.cost === undefined ? 99 : b.cost) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return copy;
  }

  function field(label, inner) {
    return '<div class="field"><label>' + escapeHtml(label) + "</label>" + inner + "</div>";
  }

  // optionList(["", "Any"], ["Fury","Calm",...], currentValue) -> <option> list with a placeholder first
  function optionList(placeholder, values, current) {
    var html = '<option value="' + escapeHtml(placeholder[0]) + '">' + escapeHtml(placeholder[1]) + "</option>";
    (values || []).forEach(function (v) {
      html += '<option value="' + escapeHtml(v) + '"' + (v === current ? " selected" : "") + ">" + escapeHtml(v) + "</option>";
    });
    return html;
  }

  // explicitOptions([["value","Label"], ...], currentValue) -> <option> list, no placeholder
  function explicitOptions(pairs, current) {
    return pairs.map(function (p) {
      return '<option value="' + escapeHtml(p[0]) + '"' + (p[0] === current ? " selected" : "") + ">" + escapeHtml(p[1]) + "</option>";
    }).join("");
  }

  function selectHtml(id, optionsHtml) {
    return '<select id="' + id + '">' + optionsHtml + "</select>";
  }

  function wireCardFilterToolbar(el, rerender) {
    var q = el.querySelector("#cf-q");
    if (q) q.addEventListener("input", function () { cardsFilterState.q = q.value; cardsFilterState.limit = CARDS_PAGE_SIZE; rerenderSoft(el, rerender); });
    ["domain", "type", "rarity", "set", "sort"].forEach(function (k) {
      var sel = el.querySelector("#cf-" + k);
      if (sel) sel.addEventListener("change", function () { cardsFilterState[k] = sel.value; cardsFilterState.limit = CARDS_PAGE_SIZE; rerender(); });
    });
  }

  // avoid losing focus/caret on every keystroke: only re-render the grid portion
  var softTimer = null;
  function rerenderSoft(el, rerender) {
    clearTimeout(softTimer);
    softTimer = setTimeout(function () {
      var active = document.activeElement;
      var activeId = active && active.id ? active.id : null;
      var caret = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
      rerender();
      if (activeId) {
        var again = document.getElementById(activeId);
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) {} }
      }
    }, 120);
  }

  function formatUsd(n) {
    return "$" + Number(n).toFixed(2);
  }

  function cardTileHtml(c) {
    var primaryDomain = (c.domains && c.domains[0]) || null;
    var owned = getOwned(c.id) + getOwnedFoil(c.id);
    var priceLabel = (c.price && c.price.en !== null && c.price.en !== undefined)
      ? formatUsd(c.price.en) + " ↗"
      : "Price ↗";
    return '<div class="card-tile-wrap">' +
      '<button class="card-tile" style="border-left-color:' + domainColor(primaryDomain) + '" data-card-id="' + c.id + '">' +
      (owned ? '<span class="ct-owned">×' + owned + "</span>" : "") +
      (c.imageUrl ? '<div class="ct-img"><img src="' + escapeHtml(c.imageUrl) + '" alt="" loading="lazy"></div>' : "") +
      '<div class="ct-top"><span class="ct-name">' + escapeHtml(c.name) + "</span>" +
      (c.cost !== null && c.cost !== undefined ? '<span class="ct-cost">' + c.cost + "⚡</span>" : "") +
      "</div>" +
      '<div>' + domainChips(c.domains) + "</div>" +
      '<div class="ct-meta"><span>' + escapeHtml(c.type) + "</span><span>·</span><span>" + escapeHtml(c.rarity || "") + "</span>" +
      (c.power !== null && c.power !== undefined ? '<span class="ct-power">' + c.power + "★</span>" : "") +
      "</div>" +
      "</button>" +
      '<a class="ct-price-link" href="' + escapeHtml(bilgewaterUrl(c)) + '" target="_blank" rel="noopener noreferrer" title="Check price on Bilgewater Market">' + escapeHtml(priceLabel) + "</a>" +
      "</div>";
  }

  function cardDetailPriceHtml(c) {
    if (!c.price) return "";
    var parts = [];
    if (c.price.en !== null && c.price.en !== undefined) parts.push("EN " + formatUsd(c.price.en));
    if (c.price.enFoil !== null && c.price.enFoil !== undefined) parts.push("EN Foil " + formatUsd(c.price.enFoil));
    if (c.price.cn !== null && c.price.cn !== undefined) parts.push("CN ¥" + Number(c.price.cn).toFixed(2));
    if (c.price.cnFoil !== null && c.price.cnFoil !== undefined) parts.push("CN Foil ¥" + Number(c.price.cnFoil).toFixed(2));
    if (!parts.length) return "";
    return '<div style="font-size:13px;color:var(--ink-soft);margin-bottom:8px;">' + parts.map(escapeHtml).join(" · ") + "</div>";
  }

  function openCardDetail(cardId) {
    var c = state.cardsById[cardId];
    if (!c) return;
    var owned = getOwned(cardId), foil = getOwnedFoil(cardId);
    var locked = JVBackend.isConfigured() && !state.social.session;
    var trackingHtml = locked
      ? '<div style="flex:1;min-width:220px;"><p style="font-size:13px;color:var(--ink-faint);margin-bottom:10px;">Sign in to track how many you own.</p>' +
        providerSignInButtonsHtml("cd-signin", "cd-signin-discord", "btn small primary", false) + "</div>"
      : ownedStepperHtml(cardId, "Owned", owned, "qty") + ownedStepperHtml(cardId, "Foil", foil, "foil");
    var html = '<div class="modal-backdrop" id="card-modal"><div class="modal">' +
      '<div class="modal-head"><div><h2 style="font-size:19px;">' + escapeHtml(c.name) + "</h2>" +
      '<div style="margin-top:6px;">' + domainChips(c.domains) + "</div></div>" +
      '<button class="modal-close" data-close>&times;</button></div>' +
      '<div style="display:flex;gap:18px;flex-wrap:wrap;">' +
      (c.imageUrl ? '<div class="cd-img"><img src="' + escapeHtml(c.imageUrl) + '" alt=""></div>' : "") +
      '<div style="flex:1;min-width:200px;">' +
      '<div style="display:flex;gap:14px;margin-bottom:12px;font-size:13px;color:var(--ink-soft);flex-wrap:wrap;">' +
      "<span><b>" + escapeHtml(c.type) + "</b></span>" +
      (c.cost !== null && c.cost !== undefined ? "<span>Cost " + c.cost + "⚡</span>" : "") +
      (c.power !== null && c.power !== undefined ? "<span>Power " + c.power + "★</span>" : "") +
      "<span>" + escapeHtml(c.rarity || "") + "</span>" +
      "<span>" + escapeHtml(c.setName || c.set || "") + " " + escapeHtml(c.collectorNumber || "") + "</span>" +
      "</div>" +
      cardDetailPriceHtml(c) +
      '<a class="btn small ghost" href="' + escapeHtml(bilgewaterUrl(c)) + '" target="_blank" rel="noopener noreferrer" style="margin-bottom:12px;">Check price on Bilgewater Market ↗</a>' +
      (c.tags && c.tags.length ? '<div style="margin-bottom:12px;">' + c.tags.map(function (t) { return '<span class="pill neutral" style="margin:0 4px 4px 0;">' + escapeHtml(t) + "</span>"; }).join("") + "</div>" : "") +
      (c.text ? '<p style="color:var(--ink-soft);line-height:1.6;">' + escapeHtml(c.text) + "</p>" : "") +
      (c.isPlaceholder ? '<p class="pill neutral" style="margin-top:8px;">Demo card</p>' : "") +
      "</div></div>" +
      '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:center;gap:18px;flex-wrap:wrap;">' +
      trackingHtml +
      "</div>" +
      "</div></div>";
    document.getElementById("modal-root").innerHTML = html;
    wireModal(cardId);
  }

  function ownedStepperHtml(cardId, label, val, kind) {
    return '<div><div class="field"><label>' + label + '</label><div class="stepper">' +
      '<button data-step="-1" data-kind="' + kind + '">−</button>' +
      '<span class="val" id="stepper-' + kind + '-val">' + val + "</span>" +
      '<button data-step="1" data-kind="' + kind + '">+</button>' +
      "</div></div></div>";
  }

  function wireModal(cardId) {
    var root = document.getElementById("modal-root");
    root.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeModal); });
    root.querySelector("#card-modal").addEventListener("click", function (e) { if (e.target.id === "card-modal") closeModal(); });
    var cdSignin = root.querySelector("#cd-signin");
    if (cdSignin) cdSignin.addEventListener("click", function () { JVBackend.signInWithGoogle(); });
    var cdSigninDiscord = root.querySelector("#cd-signin-discord");
    if (cdSigninDiscord) cdSigninDiscord.addEventListener("click", function () { JVBackend.signInWithDiscord(); });
    root.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () {
        var kind = b.getAttribute("data-kind");
        var delta = parseInt(b.getAttribute("data-step"), 10);
        var qty = getOwned(cardId), foil = getOwnedFoil(cardId);
        if (kind === "qty") qty = clamp(qty + delta, 0, 999); else foil = clamp(foil + delta, 0, 999);
        setOwned(cardId, qty, foil);
        document.getElementById("stepper-" + kind + "-val").textContent = kind === "qty" ? qty : foil;
        renderRail();
        if (state.route === "collection") renderCollectionView();
        if (state.route === "cards") renderCardsView();
      });
    });
  }

  function closeModal() { document.getElementById("modal-root").innerHTML = ""; }

  /* ================================================================
     RENDER: collection
     ================================================================ */

  var collFilterState = { q: "", domain: "", type: "", rarity: "", set: "", sort: "name", limit: 100 };

  var COLL_PAGE_SIZE = 100;

  // opts.collection lets this render someone else's collection map instead
  // of your own (used by the Friends view); opts.editable = false swaps the
  // +/- steppers for plain read-only counts, since you can't edit a
  // friend's collection.
  function collectionTileHtml(c, opts) {
    opts = opts || {};
    var coll = opts.collection || state.collection;
    var editable = opts.editable !== false;
    var entry = coll[c.id];
    var owned = entry ? (entry.qty || 0) : 0;
    var foil = entry ? (entry.foil || 0) : 0;
    var totalOwned = owned + foil;
    var primaryDomain = (c.domains && c.domains[0]) || null;
    var steppersHtml = editable
      ? '<div class="coll-stepper-row"><span class="csr-label">Owned</span><div class="stepper" data-cid="' + c.id + '" data-kind="qty">' +
        '<button data-step="-1">−</button><span class="val">' + owned + "</span><button data-step=\"1\">+</button></div></div>" +
        '<div class="coll-stepper-row"><span class="csr-label">Foil</span><div class="stepper" data-cid="' + c.id + '" data-kind="foil">' +
        '<button data-step="-1">−</button><span class="val">' + foil + "</span><button data-step=\"1\">+</button></div></div>"
      : '<div class="coll-stepper-row"><span class="csr-label">Owned</span><span class="val">' + owned + "</span></div>" +
        '<div class="coll-stepper-row"><span class="csr-label">Foil</span><span class="val">' + foil + "</span></div>";
    return '<div class="coll-tile" data-card-id="' + c.id + '" style="border-left:4px solid ' + domainColor(primaryDomain) + ';">' +
      '<div class="ct-img" data-open-card="' + c.id + '">' +
      (c.imageUrl ? '<img src="' + escapeHtml(c.imageUrl) + '" alt="" loading="lazy">' : "") +
      '<span class="coll-owned-badge" style="' + (totalOwned ? "" : "display:none;") + '">×' + totalOwned + "</span>" +
      "</div>" +
      '<div class="coll-body">' +
      '<div class="ct-top"><span class="ct-name">' + escapeHtml(c.name) + escapeHtml(variantLabel(c)) + "</span>" +
      (c.cost !== null && c.cost !== undefined ? '<span class="ct-cost">' + c.cost + "⚡</span>" : "") +
      "</div>" +
      '<span class="coll-id-chip">' + escapeHtml(c.set) + " " + escapeHtml(c.collectorNumber || "") + "</span>" +
      "<div>" + domainChips(c.domains) + "</div>" +
      '<div class="coll-steppers">' + steppersHtml + "</div></div></div>";
  }

  function renderCollectionView() {
    var el = document.getElementById("view-collection");
    if (JVBackend.isConfigured() && !state.social.session) {
      el.innerHTML = socialSignInPromptHtml("Sign in to track your collection — it'll sync to your account and follow you across devices.");
      wireSignInPrompt(el);
      return;
    }
    var list = sortCards(filteredCards(collFilterState), collFilterState.sort).filter(function (c) {
      return getOwned(c.id) + getOwnedFoil(c.id) > 0;
    });
    var uniqueOwned = Object.keys(state.collection).length;
    var pct = state.cards.length ? Math.round((uniqueOwned / state.cards.length) * 100) : 0;
    var total = list.length;
    var shown = Math.min(collFilterState.limit || COLL_PAGE_SIZE, total);
    var page = list.slice(0, shown);

    var html = '<div class="view-head"><div><h1>Collection</h1><p>The cards you actually own — ' + uniqueOwned + " / " + state.cards.length + " unique cards (" + pct + '%). Browse <b>Explore Cards</b> to find and add new ones.</p></div></div>';

    html += '<div class="toolbar">' +
      field("Search", '<input type="search" id="cof-q" placeholder="Name or text…" value="' + escapeHtml(collFilterState.q) + '">') +
      field("Domain", selectHtml("cof-domain", optionList(["", "Any"], DOMAIN_NAMES, collFilterState.domain))) +
      field("Type", selectHtml("cof-type", optionList(["", "Any"], CARD_TYPES, collFilterState.type))) +
      field("Rarity", selectHtml("cof-rarity", optionList(["", "Any"], uniqueValues("rarity"), collFilterState.rarity))) +
      "</div>";

    if (!total) {
      html += uniqueOwned
        ? '<div class="empty-state"><h3>No owned cards match</h3><p>Adjust your filters.</p></div>'
        : '<div class="empty-state"><h3>Nothing owned yet</h3><p>Head to <b>Explore Cards</b>, click a card, and set an Owned/Foil count to add it here.</p></div>';
    } else {
      html += '<p style="font-size:12.5px;color:var(--ink-faint);margin-bottom:10px;">Showing ' + shown + ' of ' + total + "</p>";
      html += '<div class="coll-grid">' + page.map(function (c) { return collectionTileHtml(c); }).join("") + "</div>";
      if (shown < total) html += '<div style="text-align:center;margin-top:18px;"><button class="btn" id="cof-load-more">Show ' + Math.min(COLL_PAGE_SIZE, total - shown) + ' more (' + (total - shown) + ' left)</button></div>';
    }

    el.innerHTML = html;
    var q = el.querySelector("#cof-q");
    if (q) q.addEventListener("input", function () { collFilterState.q = q.value; collFilterState.limit = COLL_PAGE_SIZE; rerenderSoft(el, renderCollectionView); });
    ["domain", "type", "rarity"].forEach(function (k) {
      var sel = el.querySelector("#cof-" + k);
      if (sel) sel.addEventListener("change", function () { collFilterState[k] = sel.value; collFilterState.limit = COLL_PAGE_SIZE; renderCollectionView(); });
    });
    var loadMoreBtn2 = document.getElementById("cof-load-more");
    if (loadMoreBtn2) loadMoreBtn2.addEventListener("click", function () { collFilterState.limit = (collFilterState.limit || COLL_PAGE_SIZE) + COLL_PAGE_SIZE; renderCollectionView(); });
    el.querySelectorAll("[data-open-card]").forEach(function (img) {
      img.addEventListener("click", function () { openCardDetail(img.getAttribute("data-open-card")); });
    });
    el.querySelectorAll(".stepper[data-cid]").forEach(function (st) {
      var cid = st.getAttribute("data-cid"), kind = st.getAttribute("data-kind");
      st.querySelectorAll("[data-step]").forEach(function (b) {
        b.addEventListener("click", function () {
          var delta = parseInt(b.getAttribute("data-step"), 10);
          var qty = getOwned(cid), foil = getOwnedFoil(cid);
          if (kind === "qty") qty = clamp(qty + delta, 0, 999); else foil = clamp(foil + delta, 0, 999);
          setOwned(cid, qty, foil);
          st.querySelector(".val").textContent = kind === "qty" ? qty : foil;
          var badge = document.querySelector('.coll-tile[data-card-id="' + cid + '"] .coll-owned-badge');
          var totalOwned = qty + foil;
          if (badge) {
            if (totalOwned) { badge.textContent = "×" + totalOwned; badge.style.display = ""; }
            else badge.style.display = "none";
          }
          renderRail();
        });
      });
    });
  }

  /* ================================================================
     RENDER: friends (view other signed-in players' collections)
     ================================================================ */

  var friendsFilterState = { q: "", domain: "", type: "", rarity: "", sort: "name", limit: 100 };
  var FRIENDS_PAGE_SIZE = 100;

  function openFriend(userId) {
    state.social.friendsTargetId = userId;
    state.social.friendsTargetProfile = null;
    state.social.friendsTargetCollection = null;
    state.social.friendsTargetDecks = null;
    state.social.friendsDetailTab = "collection";
    state.social.friendsViewingDeckId = null;
    friendsFilterState.limit = FRIENDS_PAGE_SIZE;
    render();
  }

  function renderFriendsView() {
    if (!JVBackend.isConfigured()) {
      document.getElementById("view-friends").innerHTML = socialNotConfiguredHtml("Friends");
      return;
    }
    if (!state.social.session) {
      var el0 = document.getElementById("view-friends");
      el0.innerHTML = socialSignInPromptHtml("Sign in with Google to see your friends' collections.");
      wireSignInPrompt(el0);
      return;
    }
    if (!state.social.friendsTargetId) renderFriendsList();
    else renderFriendDetail();
  }

  function renderFriendsList() {
    var el = document.getElementById("view-friends");
    var s = state.social;
    if (s.friendsProfiles === null) {
      el.innerHTML = '<div class="view-head"><div><h1>Friends</h1><p>Loading…</p></div></div>';
      JVBackend.listProfiles().then(function (profiles) {
        s.friendsProfiles = profiles;
        if (state.route === "friends" && !s.friendsTargetId) renderFriendsList();
      });
      return;
    }

    var mode = s.friendsMode === "add" ? "add" : "mine";
    var myId = JVBackend.currentUserId();
    var others = s.friendsProfiles.filter(function (p) { return p.id !== myId; });
    var mine = others.filter(function (p) { return s.followingIds.indexOf(p.id) !== -1; });
    var list = mode === "add" ? others : mine;

    var html = '<div class="view-head"><div><h1>Friends</h1><p>' +
      (mode === "add" ? "Everyone signed in to this Vault. Add someone to start seeing their collection." : "People you've added. Pick someone to see what they own, side by side with your own collection.") +
      "</p></div></div>";

    html += '<div class="tabs" style="margin-bottom:16px;">' +
      '<button class="' + (mode === "mine" ? "active" : "") + '" data-friends-mode="mine">My friends</button>' +
      '<button class="' + (mode === "add" ? "active" : "") + '" data-friends-mode="add">Add friends</button>' +
      "</div>";

    if (!list.length) {
      html += mode === "add"
        ? '<div class="empty-state"><h3>No one else has signed in yet</h3><p>Once a friend signs in with Google, they\'ll show up here to add.</p></div>'
        : '<div class="empty-state"><h3>No friends added yet</h3><p>Switch to <b>Add friends</b> to find people who\'ve signed in.</p></div>';
    } else if (mode === "add") {
      html += '<div class="friends-grid">' + list.map(function (p) {
        var isFriend = s.followingIds.indexOf(p.id) !== -1;
        return '<div class="friend-tile">' +
          (p.avatar_url ? '<img class="social-avatar-sm" src="' + escapeHtml(p.avatar_url) + '" alt="">' : '<span class="social-avatar-sm placeholder"></span>') +
          '<span class="friend-name">' + escapeHtml(p.display_name || "Anonymous brewer") + "</span>" +
          '<button class="btn small ' + (isFriend ? "" : "primary") + '" data-toggle-friend="' + p.id + '">' + (isFriend ? "Remove" : "+ Add") + "</button>" +
          "</div>";
      }).join("") + "</div>";
    } else {
      html += '<div class="friends-grid">' + list.map(function (p) {
        return '<button class="friend-tile" data-open-friend="' + p.id + '">' +
          (p.avatar_url ? '<img class="social-avatar-sm" src="' + escapeHtml(p.avatar_url) + '" alt="">' : '<span class="social-avatar-sm placeholder"></span>') +
          '<span class="friend-name">' + escapeHtml(p.display_name || "Anonymous brewer") + "</span></button>";
      }).join("") + "</div>";
    }

    el.innerHTML = html;
    el.querySelectorAll("[data-friends-mode]").forEach(function (b) {
      b.addEventListener("click", function () { s.friendsMode = b.getAttribute("data-friends-mode"); renderFriendsList(); });
    });
    el.querySelectorAll("[data-open-friend]").forEach(function (b) {
      b.addEventListener("click", function () { openFriend(b.getAttribute("data-open-friend")); });
    });
    el.querySelectorAll("[data-toggle-friend]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-toggle-friend");
        var was = s.followingIds.indexOf(id) !== -1;
        JVBackend.toggleFollow(id, was).then(function () {
          if (was) s.followingIds = s.followingIds.filter(function (x) { return x !== id; });
          else s.followingIds.push(id);
          renderFriendsList();
        }).catch(function () { toast("Couldn't update your friends list."); });
      });
    });
  }

  function renderFriendDetail() {
    var el = document.getElementById("view-friends");
    var s = state.social;
    if (!s.friendsTargetProfile || !s.friendsTargetCollection || !s.friendsTargetDecks) {
      el.innerHTML = '<div class="view-head"><div><h1>Friends</h1><p>Loading…</p></div></div>';
      Promise.all([
        JVBackend.getProfile(s.friendsTargetId),
        JVBackend.listCollectionFor(s.friendsTargetId),
        JVBackend.listDecksFor(s.friendsTargetId)
      ]).then(function (r) {
        s.friendsTargetProfile = r[0] || { display_name: "Anonymous brewer" };
        s.friendsTargetCollection = r[1] || {};
        s.friendsTargetDecks = r[2] || [];
        if (state.route === "friends" && s.friendsTargetId) renderFriendDetail();
      });
      return;
    }

    var theirName = s.friendsTargetProfile.display_name || "Anonymous brewer";
    var tab = s.friendsDetailTab === "decks" ? "decks" : "collection";
    var viewingDeck = tab === "decks" && s.friendsViewingDeckId
      ? s.friendsTargetDecks.filter(function (d) { return d.id === s.friendsViewingDeckId; })[0]
      : null;

    var html = '<div class="view-head"><div><h1>' + escapeHtml(theirName) + "&rsquo;s " + (tab === "decks" ? "decks" : "collection") + "</h1>" +
      (tab === "collection"
        ? "<p>" + Object.keys(s.friendsTargetCollection).length + " unique cards owned.</p>"
        : "<p>" + s.friendsTargetDecks.length + " deck" + (s.friendsTargetDecks.length === 1 ? "" : "s") + " brewed.</p>") +
      '</div><div><button class="btn small ghost" id="friends-back">&larr; All friends</button></div></div>';

    if (!viewingDeck) {
      html += '<div class="tabs" style="margin-bottom:16px;">' +
        '<button class="' + (tab === "collection" ? "active" : "") + '" data-friend-tab="collection">Collection</button>' +
        '<button class="' + (tab === "decks" ? "active" : "") + '" data-friend-tab="decks">Decks</button>' +
        "</div>";
    }

    html += tab === "collection" ? friendCollectionSectionHtml(s) : friendDecksSectionHtml(s, viewingDeck);

    el.innerHTML = html;
    var back = el.querySelector("#friends-back");
    if (back) back.addEventListener("click", function () { openFriend(null); });
    el.querySelectorAll("[data-friend-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        s.friendsDetailTab = b.getAttribute("data-friend-tab");
        s.friendsViewingDeckId = null;
        renderFriendDetail();
      });
    });
    if (tab === "collection") wireFriendCollectionSection(el);
    else wireFriendDecksSection(el, viewingDeck);
  }

  function friendCollectionSectionHtml(s) {
    var theirCollection = s.friendsTargetCollection;
    var theirName = s.friendsTargetProfile.display_name || "Anonymous brewer";
    var uniqueOwned = Object.keys(theirCollection).length;

    var list = sortCards(filteredCards(friendsFilterState), friendsFilterState.sort).filter(function (c) {
      var e = theirCollection[c.id];
      return e && (e.qty || 0) + (e.foil || 0) > 0;
    });
    var total = list.length;
    var shown = Math.min(friendsFilterState.limit || FRIENDS_PAGE_SIZE, total);
    var page = list.slice(0, shown);

    var html = '<div class="toolbar">' +
      field("Search", '<input type="search" id="frf-q" placeholder="Name or text…" value="' + escapeHtml(friendsFilterState.q) + '">') +
      field("Domain", selectHtml("frf-domain", optionList(["", "Any"], DOMAIN_NAMES, friendsFilterState.domain))) +
      field("Type", selectHtml("frf-type", optionList(["", "Any"], CARD_TYPES, friendsFilterState.type))) +
      field("Rarity", selectHtml("frf-rarity", optionList(["", "Any"], uniqueValues("rarity"), friendsFilterState.rarity))) +
      "</div>";

    if (!total) {
      html += uniqueOwned
        ? '<div class="empty-state"><h3>No owned cards match</h3><p>Adjust your filters.</p></div>'
        : '<div class="empty-state"><h3>Nothing owned yet</h3><p>' + escapeHtml(theirName) + " hasn't logged any cards.</p></div>";
    } else {
      html += '<p style="font-size:12.5px;color:var(--ink-faint);margin-bottom:10px;">Showing ' + shown + ' of ' + total + "</p>";
      html += '<div class="coll-grid">' + page.map(function (c) { return collectionTileHtml(c, { collection: theirCollection, editable: false }); }).join("") + "</div>";
      if (shown < total) html += '<div style="text-align:center;margin-top:18px;"><button class="btn" id="frf-load-more">Show ' + Math.min(FRIENDS_PAGE_SIZE, total - shown) + ' more (' + (total - shown) + ' left)</button></div>';
    }
    return html;
  }

  function wireFriendCollectionSection(el) {
    var q = el.querySelector("#frf-q");
    if (q) q.addEventListener("input", function () { friendsFilterState.q = q.value; friendsFilterState.limit = FRIENDS_PAGE_SIZE; rerenderSoft(el, renderFriendDetail); });
    ["domain", "type", "rarity"].forEach(function (k) {
      var sel = el.querySelector("#frf-" + k);
      if (sel) sel.addEventListener("change", function () { friendsFilterState[k] = sel.value; friendsFilterState.limit = FRIENDS_PAGE_SIZE; renderFriendDetail(); });
    });
    var loadMore = el.querySelector("#frf-load-more");
    if (loadMore) loadMore.addEventListener("click", function () { friendsFilterState.limit = (friendsFilterState.limit || FRIENDS_PAGE_SIZE) + FRIENDS_PAGE_SIZE; renderFriendDetail(); });
    el.querySelectorAll("[data-open-card]").forEach(function (img) {
      img.addEventListener("click", function () { openCardDetail(img.getAttribute("data-open-card")); });
    });
  }

  function friendDecksSectionHtml(s, viewingDeck) {
    if (viewingDeck) return friendDeckDetailHtml(viewingDeck);
    var decks = s.friendsTargetDecks;
    var theirName = s.friendsTargetProfile.display_name || "Anonymous brewer";
    if (!decks.length) return '<div class="empty-state"><h3>No decks yet</h3><p>' + escapeHtml(theirName) + " hasn't brewed anything.</p></div>";
    return '<div class="deck-row-list">' + decks.map(function (d) {
      return '<div class="deck-row" data-view-friend-deck="' + d.id + '">' +
        '<div class="drn">' + escapeHtml(d.name) + "</div>" +
        '<div class="drdomains">' + (d.domains || []).map(domainChip).join("") + "</div>" +
        '<div class="drspacer"></div>' +
        '<div class="drmeta">' + mainDeckCount(d) + "/" + RULES.mainDeckSize + "</div>" +
        "</div>";
    }).join("") + "</div>";
  }

  function friendDeckDetailHtml(deck) {
    var legend = deck.legendId ? state.cardsById[deck.legendId] : null;
    var champion = deck.championId ? state.cardsById[deck.championId] : null;
    var issues = computeLegality(deck);
    var legal = issues.every(function (i) { return i.ok; });

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
      '<h2 style="font-family:\'Fraunces\',serif;font-weight:680;font-size:19px;">' + escapeHtml(deck.name) + "</h2>" +
      '<span class="pill ' + (legal ? "good" : "warn") + '">' + (legal ? "Tournament legal" : issues.filter(function (i) { return !i.ok; }).length + " issue(s)") + "</span>" +
      "</div>";
    html += '<p style="font-size:12.5px;color:var(--ink-faint);margin-bottom:14px;">' +
      (legend ? escapeHtml(legend.name) : "No legend") + (champion ? " · Champion: " + escapeHtml(champion.name) : "") + " · " + domainChips(deck.domains) +
      ' <button class="btn ghost small" id="friend-deck-back">&larr; All decks</button></p>';

    html += '<div class="builder-grid"><div>';
    html += '<h3 style="margin-bottom:10px;">Main deck (' + mainDeckCount(deck) + "/" + RULES.mainDeckSize + ")</h3>";
    var mainEntries = (deck.main || []).slice().sort(function (a, b) {
      var ca = state.cardsById[a.cardId], cb = state.cardsById[b.cardId];
      return (ca ? ca.cost || 0 : 0) - (cb ? cb.cost || 0 : 0);
    });
    if (!mainEntries.length) html += '<p style="font-size:12.5px;color:var(--ink-faint);">No cards yet.</p>';
    html += '<div class="deck-picker-list">' + mainEntries.map(function (e) {
      var c = state.cardsById[e.cardId];
      if (!c) return "";
      return '<div class="pick-row">' + pickRowImgHtml(c) + '<div class="pr-body"><span class="pr-name">' + escapeHtml(c.name) + escapeHtml(variantLabel(c)) +
        (deck.championId === c.id ? ' <span class="pill neutral" style="padding:0 5px;">CH</span>' : "") + "</span>" +
        '<span class="pr-meta"><span class="pr-cost">' + (c.cost === null || c.cost === undefined ? "—" : c.cost + "⚡") + "</span><span>" + escapeHtml(c.type) + "</span></span></div>" +
        '<span class="pill neutral" style="flex:none;">×' + e.qty + "</span></div>";
    }).join("") + "</div>";
    html += "</div>";
    html += deckPanelReadOnlyHtml(deck, issues);
    html += "</div>";
    return html;
  }

  function deckPanelReadOnlyHtml(deck, issues) {
    var html = '<div class="deck-panel">';
    html += "<div>" + curveChartHtml(deck) + "</div>";
    if (Object.keys(deck.runes || {}).length) {
      html += '<div><h3>Runes (' + runeCount(deck) + ")</h3>";
      Object.keys(deck.runes).forEach(function (d) {
        html += '<div class="slot-line"><span class="sl-qty">' + deck.runes[d] + "×</span><span class=\"sl-name\">" + domainChip(d) + "</span></div>";
      });
      html += "</div>";
    }
    if ((deck.battlefields || []).length) {
      html += '<div><h3>Battlefields</h3>';
      deck.battlefields.forEach(function (id) {
        var c = state.cardsById[id];
        html += '<div class="slot-line"><span class="sl-name">' + escapeHtml(c ? c.name : id) + (c ? escapeHtml(variantLabel(c)) : "") + "</span></div>";
      });
      html += "</div>";
    }
    if ((deck.sideboard || []).length) {
      html += '<div><h3>Sideboard (' + sideboardCount(deck) + ")</h3>";
      deck.sideboard.forEach(function (e) {
        var c = state.cardsById[e.cardId];
        html += '<div class="slot-line"><span class="sl-qty">' + e.qty + "×</span><span class=\"sl-name\">" + escapeHtml(c ? c.name : e.cardId) + (c ? escapeHtml(variantLabel(c)) : "") + "</span></div>";
      });
      html += "</div>";
    }
    html += '<div><h3>Legality</h3><div class="legality-list">' + issues.map(function (i) {
      return '<div class="leg-item ' + (i.ok ? "ok" : "bad") + '"><span class="li-icon">' + (i.ok ? "✓" : "✕") + "</span><span class=\"li-text\"><b>" + escapeHtml(i.label) + "</b>" + (i.detail ? " — " + escapeHtml(i.detail) : "") + "</span></div>";
    }).join("") + "</div></div>";
    html += "</div>";
    return html;
  }

  function wireFriendDecksSection(el, viewingDeck) {
    if (viewingDeck) {
      var back2 = el.querySelector("#friend-deck-back");
      if (back2) back2.addEventListener("click", function () { state.social.friendsViewingDeckId = null; renderFriendDetail(); });
      el.querySelectorAll("[data-open-card]").forEach(function (img) {
        img.addEventListener("click", function () { openCardDetail(img.getAttribute("data-open-card")); });
      });
      return;
    }
    el.querySelectorAll("[data-view-friend-deck]").forEach(function (row) {
      row.addEventListener("click", function () {
        state.social.friendsViewingDeckId = row.getAttribute("data-view-friend-deck");
        renderFriendDetail();
      });
    });
  }

  /* ================================================================
     DECK LOGIC
     ================================================================ */

  function newDeckObject() {
    return {
      id: uid("deck"),
      name: "New deck",
      legendId: null,
      championId: null,
      domains: [],
      main: [],       // [{cardId, qty}]
      runes: {},       // {domainName: count}
      battlefields: [], // [cardId,...] up to 3
      sideboard: [],   // [{cardId, qty}]
      notes: "",
      createdAt: Date.now ? Date.now() : 0,
      updatedAt: Date.now ? Date.now() : 0
    };
  }

  function mainDeckCount(deck) {
    return (deck.main || []).reduce(function (s, e) { return s + e.qty; }, 0);
  }
  function sideboardCount(deck) {
    return (deck.sideboard || []).reduce(function (s, e) { return s + e.qty; }, 0);
  }
  function runeCount(deck) {
    var t = 0; Object.keys(deck.runes || {}).forEach(function (k) { t += deck.runes[k] || 0; });
    return t;
  }
  // total copies of a card across main + sideboard (the champion's copy already
  // lives in deck.main, since wireChampionStep adds it there directly)
  function totalCopies(deck, cardId) {
    var m = (deck.main || []).filter(function (e) { return e.cardId === cardId; })[0];
    var s = (deck.sideboard || []).filter(function (e) { return e.cardId === cardId; })[0];
    return (m ? m.qty : 0) + (s ? s.qty : 0);
  }

  function computeLegality(deck) {
    var issues = [];
    var legend = deck.legendId ? state.cardsById[deck.legendId] : null;
    var champion = deck.championId ? state.cardsById[deck.championId] : null;

    issues.push({ ok: !!legend, label: "Legend selected", detail: legend ? legend.name : "Pick exactly one Legend." });

    issues.push({
      ok: !!champion && legend && cardDomainsSubset(champion.domains, deck.domains),
      label: "Chosen Champion selected",
      detail: champion ? champion.name + (legend && !cardDomainsSubset(champion.domains, deck.domains) ? " (wrong domain for this Legend)" : "") : "Pick exactly one Champion matching your Legend's domains."
    });

    var mdCount = mainDeckCount(deck);
    issues.push({ ok: mdCount === RULES.mainDeckSize, label: "Main deck is " + RULES.mainDeckSize + " cards", detail: mdCount + " / " + RULES.mainDeckSize + (mdCount === RULES.mainDeckSize ? "" : mdCount < RULES.mainDeckSize ? " — add " + (RULES.mainDeckSize - mdCount) + " more" : " — remove " + (mdCount - RULES.mainDeckSize)) });

    var domainOk = true, offenders = [];
    (deck.main || []).concat(deck.sideboard || []).forEach(function (e) {
      var c = state.cardsById[e.cardId];
      if (!c) return;
      if (!cardDomainsSubset(c.domains, deck.domains)) { domainOk = false; offenders.push(c.name); }
    });
    issues.push({ ok: domainOk, label: "All cards match Legend's domains", detail: domainOk ? "" : offenders.slice(0, 3).join(", ") + " outside " + (deck.domains || []).join("/") });

    var copyOk = true, copyOffenders = [];
    var counts = {};
    (deck.main || []).forEach(function (e) { counts[e.cardId] = (counts[e.cardId] || 0) + e.qty; });
    (deck.sideboard || []).forEach(function (e) { counts[e.cardId] = (counts[e.cardId] || 0) + e.qty; });
    Object.keys(counts).forEach(function (cid) {
      if (counts[cid] > RULES.maxCopies) { copyOk = false; copyOffenders.push((state.cardsById[cid] || {}).name || cid); }
    });
    issues.push({ ok: copyOk, label: "Max " + RULES.maxCopies + " copies per card", detail: copyOk ? "" : copyOffenders.join(", ") + " over the limit" });

    var rCount = runeCount(deck);
    var runeDomainsOk = Object.keys(deck.runes || {}).every(function (d) { return (deck.domains || []).indexOf(d) !== -1 || (deck.runes[d] || 0) === 0; });
    issues.push({ ok: rCount === RULES.runeDeckSize && runeDomainsOk, label: "Rune deck is " + RULES.runeDeckSize + " cards", detail: rCount + " / " + RULES.runeDeckSize + (runeDomainsOk ? "" : " — runes must be from your Legend's domains") });

    var bfCount = (deck.battlefields || []).length;
    var bfUnique = new Set(deck.battlefields || []).size === bfCount;
    issues.push({ ok: bfCount === RULES.battlefieldCount && bfUnique, label: RULES.battlefieldCount + " unique Battlefields", detail: bfCount + " / " + RULES.battlefieldCount + (bfUnique ? "" : " — duplicates not allowed") });

    var sbCount = sideboardCount(deck);
    issues.push({ ok: RULES.sideboardSizes.indexOf(sbCount) !== -1, label: "Sideboard is 0 or 8 cards", detail: sbCount + " / 0 or 8" });

    return issues;
  }

  function cardDomainsSubset(cardDomains, legendDomains) {
    if (!cardDomains || !cardDomains.length) return true; // colorless
    if (!legendDomains) return false;
    return cardDomains.every(function (d) { return legendDomains.indexOf(d) !== -1; });
  }

  function startNewDeck() {
    var d = newDeckObject();
    state.decks.push(d);
    persistDecks();
    state.builder.deckId = d.id;
    state.builder.tab = "main";
    renderDecksView();
  }

  function openDeck(id) {
    state.builder.deckId = id;
    state.builder.tab = "main";
    renderDecksView();
  }

  function deleteDeck(id) {
    state.decks = state.decks.filter(function (d) { return d.id !== id; });
    persistDecks();
    if (state.builder.deckId === id) state.builder.deckId = null;
    renderDecksView();
    if (JVBackend.isConfigured() && JVBackend.currentUserId()) {
      JVBackend.deleteDeckRemote(id).catch(function () {
        toast("Couldn't remove that deck from your account.");
      });
    }
  }

  function addToMain(deck, cardId) {
    var e = deck.main.filter(function (e) { return e.cardId === cardId; })[0];
    if (!e) { e = { cardId: cardId, qty: 0 }; deck.main.push(e); }
    e.qty++;
    deck.updatedAt = Date.now ? Date.now() : 0;
    persistDecks();
  }
  function removeFromMain(deck, cardId) {
    var e = deck.main.filter(function (e) { return e.cardId === cardId; })[0];
    if (!e) return;
    e.qty--;
    if (e.qty <= 0) deck.main = deck.main.filter(function (x) { return x.cardId !== cardId; });
    deck.updatedAt = Date.now ? Date.now() : 0;
    persistDecks();
  }
  function addToSideboard(deck, cardId) {
    var e = deck.sideboard.filter(function (e) { return e.cardId === cardId; })[0];
    if (!e) { e = { cardId: cardId, qty: 0 }; deck.sideboard.push(e); }
    e.qty++;
    persistDecks();
  }
  function removeFromSideboard(deck, cardId) {
    var e = deck.sideboard.filter(function (e) { return e.cardId === cardId; })[0];
    if (!e) return;
    e.qty--;
    if (e.qty <= 0) deck.sideboard = deck.sideboard.filter(function (x) { return x.cardId !== cardId; });
    persistDecks();
  }

  /* ================================================================
     RENDER: decks / builder
     ================================================================ */

  function renderDecksView() {
    var el = document.getElementById("view-decks");
    var deck = currentDeck();

    var html = '<div class="view-head"><div><h1>Deck builder</h1><p>Build against real Riftbound construction rules: one Legend, one Chosen Champion, a 40-card main deck, a 12-card rune deck, and 3 battlefields.</p></div>' +
      '<div style="display:flex;gap:8px;"><button class="btn" data-action="import-code">Import code</button><button class="btn primary" data-action="new-deck">+ New deck</button></div></div>';

    html += '<div class="deck-row-list" style="margin-bottom:20px;">';
    if (!state.decks.length) {
      html += '<div class="empty-state"><h3>No decks yet</h3><p>Start with a Legend, then add your Chosen Champion.</p></div>';
    } else {
      state.decks.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).forEach(function (d) {
        html += '<div class="deck-row' + (deck && deck.id === d.id ? "" : "") + '" data-open="' + d.id + '" style="' + (deck && deck.id === d.id ? "border-color:var(--accent);" : "") + '">' +
          '<div class="drn">' + escapeHtml(d.name) + "</div>" +
          '<div class="drdomains">' + (d.domains || []).map(domainChip).join("") + "</div>" +
          '<div class="drspacer"></div>' +
          '<div class="drmeta">' + mainDeckCount(d) + "/" + RULES.mainDeckSize + "</div>" +
          '<button class="btn small danger" data-del="' + d.id + '">Delete</button>' +
          "</div>";
      });
    }
    html += "</div>";
    html += '<div id="builder-host"></div>';

    el.innerHTML = html;
    el.querySelector('[data-action="new-deck"]').addEventListener("click", startNewDeck);
    el.querySelector('[data-action="import-code"]').addEventListener("click", promptImportShareCode);
    el.querySelectorAll("[data-open]").forEach(function (r) { r.addEventListener("click", function () { openDeck(r.getAttribute("data-open")); }); });
    el.querySelectorAll("[data-del]").forEach(function (r) {
      r.addEventListener("click", function (e) {
        e.stopPropagation();
        if (window.confirm("Delete this deck? This can't be undone.")) deleteDeck(r.getAttribute("data-del"));
      });
    });

    renderBuilder();
  }

  function renderBuilder() {
    var host = document.getElementById("builder-host");
    if (!host) return;
    var deck = currentDeck();
    if (!deck) { host.innerHTML = '<div class="empty-state"><h3>Select or create a deck</h3><p>Pick a deck on the left, or start a new one.</p></div>'; return; }

    if (!deck.legendId) { host.innerHTML = builderLegendStep(deck); wireLegendStep(deck, host); return; }
    if (!deck.championId) { host.innerHTML = builderChampionStep(deck); wireChampionStep(deck, host); return; }
    host.innerHTML = builderMain(deck);
    wireBuilderMain(deck, host);
  }

  function builderLegendStep(deck) {
    var legends = state.cards.filter(function (c) { return c.type === "Legend"; });
    var html = '<div><h3 style="margin-bottom:10px;">Step 1 — Choose a Legend</h3>';
    if (!legends.length) html += '<div class="empty-state"><h3>No Legends in your card database</h3><p>Import some Legend cards first.</p></div>';
    html += '<div class="legend-picker">' + legends.map(function (l) {
      var owned = getOwned(l.id) + getOwnedFoil(l.id);
      return '<div class="legend-card" data-legend="' + l.id + '">' +
        (l.imageUrl ? '<div class="lc-img"><img src="' + escapeHtml(l.imageUrl) + '" alt="" loading="lazy"></div>' : "") +
        '<div class="lc-name">' + escapeHtml(l.name) + escapeHtml(variantLabel(l)) + "</div>" +
        '<span class="coll-id-chip">' + escapeHtml(l.set) + " " + escapeHtml(l.collectorNumber || "") + "</span>" +
        domainChips(l.domains) +
        '<span class="pill ' + (owned ? "good" : "neutral") + '">' + (owned ? "Own " + owned : "Not owned") + "</span>" +
        "</div>";
    }).join("") + "</div></div>";
    return html;
  }
  function wireLegendStep(deck, host) {
    host.querySelectorAll("[data-legend]").forEach(function (b) {
      b.addEventListener("click", function () {
        var legend = state.cardsById[b.getAttribute("data-legend")];
        deck.legendId = legend.id;
        deck.domains = (legend.domains || []).slice();
        deck.runes = {};
        deck.domains.forEach(function (d) { deck.runes[d] = 6; });
        persistDecks();
        renderBuilder();
      });
    });
  }

  function builderChampionStep(deck) {
    var legend = state.cardsById[deck.legendId];
    var champs = state.cards.filter(function (c) { return isChampionEligible(c) && cardDomainsSubset(c.domains, deck.domains); });
    var html = '<div><h3 style="margin-bottom:4px;">Step 2 — Choose your Chosen Champion</h3>' +
      '<p style="font-size:12.5px;color:var(--ink-faint);margin-bottom:10px;">Legend: ' + escapeHtml(legend.name) + " · " + domainChips(deck.domains) + '</p>';
    if (!champs.length) html += '<div class="empty-state"><h3>No matching Champions</h3><p>Import Champion cards in ' + deck.domains.join("/") + ", or " + '<button class="btn small" data-back-legend>change Legend</button>.</p></div>';
    html += '<div class="legend-picker">' + champs.map(function (c) {
      var owned = getOwned(c.id) + getOwnedFoil(c.id);
      return '<div class="legend-card" data-champ="' + c.id + '">' +
        (c.imageUrl ? '<div class="lc-img"><img src="' + escapeHtml(c.imageUrl) + '" alt="" loading="lazy"></div>' : "") +
        '<div class="lc-name">' + escapeHtml(c.name) + escapeHtml(variantLabel(c)) + "</div><div class=\"ct-meta\">" + c.cost + "⚡ / " + c.power + "★</div>" +
        '<span class="coll-id-chip">' + escapeHtml(c.set) + " " + escapeHtml(c.collectorNumber || "") + "</span>" +
        domainChips(c.domains) +
        '<span class="pill ' + (owned ? "good" : "neutral") + '">' + (owned ? "Own " + owned : "Not owned") + "</span>" +
        "</div>";
    }).join("") + "</div>" +
      '<button class="btn ghost small" style="margin-top:12px;" data-back-legend>← change Legend</button>' +
      "</div>";
    return html;
  }
  function wireChampionStep(deck, host) {
    host.querySelectorAll("[data-champ]").forEach(function (b) {
      b.addEventListener("click", function () {
        var champ = state.cardsById[b.getAttribute("data-champ")];
        deck.championId = champ.id;
        addToMain(deck, champ.id);
        persistDecks();
        renderBuilder();
      });
    });
    host.querySelectorAll("[data-back-legend]").forEach(function (b) {
      b.addEventListener("click", function () { deck.legendId = null; deck.domains = []; persistDecks(); renderBuilder(); });
    });
  }

  function pickRowImgHtml(c) {
    return c.imageUrl
      ? '<div class="pr-img"><img src="' + escapeHtml(c.imageUrl) + '" alt="" loading="lazy"></div>'
      : '<div class="pr-img placeholder"></div>';
  }

  function sectionQty(list, cardId) {
    var e = (list || []).filter(function (e) { return e.cardId === cardId; })[0];
    return e ? e.qty : 0;
  }

  // "-" removes one from this specific section (main or sideboard); "+" is
  // disabled once the card hits the 3-copy limit across both sections.
  function pickRowStepperHtml(cardId, qty, atLimit, addAttr, rmAttr) {
    return '<div class="stepper" style="flex:none;">' +
      '<button ' + rmAttr + '="' + cardId + '"' + (qty === 0 ? " disabled" : "") + '>−</button>' +
      '<span class="val">' + qty + '</span>' +
      '<button ' + addAttr + '="' + cardId + '"' + (atLimit ? " disabled" : "") + ">+</button>" +
      "</div>";
  }

  function builderMain(deck) {
    var legend = state.cardsById[deck.legendId];
    var champion = state.cardsById[deck.championId];
    var issues = computeLegality(deck);
    var legal = issues.every(function (i) { return i.ok; });

    var pickPoolFull = state.cards.filter(function (c) {
      return ["Unit", "Spell", "Gear"].indexOf(c.type) !== -1 && cardDomainsSubset(c.domains, deck.domains) &&
        (!state.builder.cardFilter || c.name.toLowerCase().indexOf(state.builder.cardFilter.toLowerCase()) !== -1);
    }).sort(function (a, b) { return (a.cost || 0) - (b.cost || 0) || a.name.localeCompare(b.name); });
    var PICK_POOL_CAP = 150;
    var pickPool = pickPoolFull.slice(0, PICK_POOL_CAP);

    var battlefieldPool = state.cards.filter(function (c) { return c.type === "Battlefield"; });

    var html = '<div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
      '<input type="text" id="deck-name-input" value="' + escapeHtml(deck.name) + '" style="font-family:\'Fraunces\',serif;font-weight:680;font-size:19px;border:none;background:none;padding:2px 0;max-width:340px;">' +
      '<span class="pill ' + (legal ? "good" : "warn") + '">' + (legal ? "Tournament legal" : issues.filter(function(i){return !i.ok;}).length + " issue(s)") + "</span>" +
      "</div>";
    html += '<p style="font-size:12.5px;color:var(--ink-faint);margin-bottom:14px;">' + escapeHtml(legend.name) + " · Champion: " + escapeHtml(champion.name) + " · " + domainChips(deck.domains) +
      ' <button class="btn ghost small" data-restart>restart</button></p>';

    html += '<div class="builder-grid">';

    // left: card picker
    html += '<div>';
    html += '<div class="tabs">' +
      tabBtn("main", "Main deck (" + mainDeckCount(deck) + "/" + RULES.mainDeckSize + ")") +
      tabBtn("runes", "Runes (" + runeCount(deck) + "/" + RULES.runeDeckSize + ")") +
      tabBtn("battlefields", "Battlefields (" + (deck.battlefields || []).length + "/" + RULES.battlefieldCount + ")") +
      tabBtn("sideboard", "Sideboard (" + sideboardCount(deck) + ")") +
      tabBtn("share", "Share") +
      "</div>";

    if (state.builder.tab === "main") {
      html += '<div class="field" style="margin-bottom:10px;"><input type="search" id="deck-card-filter" placeholder="Filter cards to add…" value="' + escapeHtml(state.builder.cardFilter) + '"></div>';
      html += '<div class="deck-picker-list">' + pickPool.map(function (c) {
        var atLimit = totalCopies(deck, c.id) >= RULES.maxCopies;
        return '<div class="pick-row">' + pickRowImgHtml(c) + '<div class="pr-body"><span class="pr-name">' + escapeHtml(c.name) + escapeHtml(variantLabel(c)) + '</span>' +
          '<span class="pr-meta"><span class="pr-cost">' + (c.cost === null || c.cost === undefined ? "—" : c.cost + "⚡") + "</span><span>" + escapeHtml(c.type) + "</span><span>" + escapeHtml(c.set) + " " + escapeHtml(c.collectorNumber || "") + "</span><span>own " + (getOwned(c.id) + getOwnedFoil(c.id)) + "</span></span></div>" +
          pickRowStepperHtml(c.id, sectionQty(deck.main, c.id), atLimit, "data-add-main", "data-rm-main") +
          "</div>";
      }).join("") + "</div>";
      if (!pickPool.length) html += '<div class="empty-state"><h3>No cards in these domains</h3><p>Import more cards for ' + deck.domains.join("/") + ".</p></div>";
      else if (pickPoolFull.length > PICK_POOL_CAP) html += '<p style="font-size:11.5px;color:var(--ink-faint);margin-top:8px;">Showing first ' + PICK_POOL_CAP + ' of ' + pickPoolFull.length + ' — use the search box above to narrow it down.</p>';
    } else if (state.builder.tab === "runes") {
      html += '<p style="font-size:13px;color:var(--ink-soft);margin-bottom:12px;">Split ' + RULES.runeDeckSize + ' runes across your two domains. A 6/6 split is standard.</p>';
      deck.domains.forEach(function (d) {
        html += '<div class="rune-row">' + domainChip(d) + '<input type="number" min="0" max="' + RULES.runeDeckSize + '" data-rune="' + d + '" value="' + (deck.runes[d] || 0) + '"></div>';
      });
    } else if (state.builder.tab === "battlefields") {
      html += '<p style="font-size:13px;color:var(--ink-soft);margin-bottom:12px;">Choose ' + RULES.battlefieldCount + ' unique Battlefields.</p>';
      html += '<div class="deck-picker-list">' + battlefieldPool.map(function (c) {
        var chosen = (deck.battlefields || []).indexOf(c.id) !== -1;
        return '<div class="pick-row">' + pickRowImgHtml(c) + '<div class="pr-body"><span class="pr-name">' + escapeHtml(c.name) + escapeHtml(variantLabel(c)) + '</span><span class="pr-meta">' + escapeHtml(c.text || "") + '</span></div>' +
          '<button class="btn small' + (chosen ? " primary" : "") + '" data-toggle-bf="' + c.id + '">' + (chosen ? "✓ chosen" : "choose") + "</button></div>";
      }).join("") + "</div>";
      if (!battlefieldPool.length) html += '<div class="empty-state"><h3>No Battlefield cards yet</h3><p>Import some — Battlefields are colorless.</p></div>';
    } else if (state.builder.tab === "sideboard") {
      html += '<p style="font-size:13px;color:var(--ink-soft);margin-bottom:12px;">Optional: 0 or exactly 8 cards, same domain and copy-limit rules as your main deck.</p>';
      html += '<div class="deck-picker-list">' + pickPool.map(function (c) {
        var atLimit = totalCopies(deck, c.id) >= RULES.maxCopies;
        return '<div class="pick-row">' + pickRowImgHtml(c) + '<div class="pr-body"><span class="pr-name">' + escapeHtml(c.name) + escapeHtml(variantLabel(c)) + '</span>' +
          '<span class="pr-meta"><span class="pr-cost">' + (c.cost === null || c.cost === undefined ? "—" : c.cost + "⚡") + "</span><span>" + escapeHtml(c.type) + "</span><span>" + escapeHtml(c.set) + " " + escapeHtml(c.collectorNumber || "") + "</span></span></div>" +
          pickRowStepperHtml(c.id, sectionQty(deck.sideboard, c.id), atLimit, "data-add-sb", "data-rm-sb") + "</div>";
      }).join("") + "</div>";
    } else if (state.builder.tab === "share") {
      html += shareTabHtml(deck);
    }
    html += "</div>";

    // right: sticky deck panel
    html += deckPanelHtml(deck, issues, legal);

    html += "</div></div>";
    return html;
  }

  function tabBtn(key, label) {
    return '<button class="' + (state.builder.tab === key ? "active" : "") + '" data-tab="' + key + '">' + escapeHtml(label) + "</button>";
  }

  function deckPanelHtml(deck, issues, legal) {
    var html = '<div class="deck-panel">';
    html += "<div>" + curveChartHtml(deck) + "</div>";

    html += '<div><h3>Main (' + mainDeckCount(deck) + ")</h3>";
    var mainEntries = (deck.main || []).slice().sort(function (a, b) {
      var ca = state.cardsById[a.cardId], cb = state.cardsById[b.cardId];
      return (ca ? ca.cost || 0 : 0) - (cb ? cb.cost || 0 : 0);
    });
    if (!mainEntries.length) html += '<p style="font-size:12px;color:var(--ink-faint);">No cards yet.</p>';
    mainEntries.forEach(function (e) {
      var c = state.cardsById[e.cardId];
      if (!c) return;
      html += '<div class="slot-line"><span class="sl-qty">' + e.qty + "×</span><span class=\"sl-name\">" + escapeHtml(c.name) + escapeHtml(variantLabel(c)) +
        (deck.championId === c.id ? ' <span class="pill neutral" style="padding:0 5px;">CH</span>' : "") + "</span>" +
        '<span class="sl-cost">' + (c.cost === null || c.cost === undefined ? "—" : c.cost + "⚡") + "</span>" +
        (deck.championId === c.id ? "" : '<button data-rm-main="' + c.id + '" title="Remove one">&times;</button>') +
        "</div>";
    });
    html += "</div>";

    if (Object.keys(deck.runes || {}).length) {
      html += '<div><h3>Runes (' + runeCount(deck) + ")</h3>";
      Object.keys(deck.runes).forEach(function (d) {
        html += '<div class="slot-line"><span class="sl-qty">' + deck.runes[d] + "×</span><span class=\"sl-name\">" + domainChip(d) + "</span></div>";
      });
      html += "</div>";
    }

    if ((deck.battlefields || []).length) {
      html += '<div><h3>Battlefields</h3>';
      deck.battlefields.forEach(function (id) {
        var c = state.cardsById[id];
        html += '<div class="slot-line"><span class="sl-name">' + escapeHtml(c ? c.name : id) + (c ? escapeHtml(variantLabel(c)) : "") + "</span></div>";
      });
      html += "</div>";
    }

    if ((deck.sideboard || []).length) {
      html += '<div><h3>Sideboard (' + sideboardCount(deck) + ")</h3>";
      deck.sideboard.forEach(function (e) {
        var c = state.cardsById[e.cardId];
        html += '<div class="slot-line"><span class="sl-qty">' + e.qty + "×</span><span class=\"sl-name\">" + escapeHtml(c ? c.name : e.cardId) + (c ? escapeHtml(variantLabel(c)) : "") + "</span>" +
          '<button data-rm-sb="' + e.cardId + '" title="Remove one">&times;</button></div>';
      });
      html += "</div>";
    }

    html += '<div><h3>Legality</h3><div class="legality-list">' + issues.map(function (i) {
      return '<div class="leg-item ' + (i.ok ? "ok" : "bad") + '"><span class="li-icon">' + (i.ok ? "✓" : "✕") + "</span><span class=\"li-text\"><b>" + escapeHtml(i.label) + "</b>" + (i.detail ? " — " + escapeHtml(i.detail) : "") + "</span></div>";
    }).join("") + "</div></div>";

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn danger" data-delete-deck>Delete deck</button></div>';

    html += "</div>";
    return html;
  }

  function curveChartHtml(deck) {
    var buckets = [0, 0, 0, 0, 0, 0, 0]; // 0,1,2,3,4,5,6+
    var max = 1;
    (deck.main || []).forEach(function (e) {
      var c = state.cardsById[e.cardId];
      if (!c || c.cost === null || c.cost === undefined) return;
      var b = clamp(c.cost, 0, 6);
      buckets[b] += e.qty;
    });
    max = Math.max.apply(null, buckets.concat([1]));
    var html = '<h3>Mana curve</h3><div class="curve-chart">';
    buckets.forEach(function (v, i) {
      var h = Math.round((v / max) * 64) + (v > 0 ? 4 : 0);
      html += '<div class="curve-bar"><span class="bcount">' + (v || "") + '</span><span class="bar" style="height:' + h + 'px"></span><span class="blabel">' + (i === 6 ? "6+" : i) + "</span></div>";
    });
    html += "</div>";
    return html;
  }

  function shareTabHtml(deck) {
    var code = encodeDeckShare(deck);
    return '<div>' +
      '<p style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">This code carries a full snapshot of the deck (card names, costs, text summary, and counts) so a friend can open it in their own Vault, even before they\'ve imported your card list.</p>' +
      '<code class="deckcode" id="share-code">' + escapeHtml(code) + "</code>" +
      '<button class="btn primary" style="margin-top:10px;" data-copy-code>Copy share code</button>' +
      "</div>";
  }

  function wireBuilderMain(deck, host) {
    var nameInput = host.querySelector("#deck-name-input");
    if (nameInput) nameInput.addEventListener("change", function () { deck.name = nameInput.value || "New deck"; deck.updatedAt = Date.now ? Date.now() : 0; persistDecks(); renderRail(); });

    host.querySelectorAll("[data-restart]").forEach(function (b) { b.addEventListener("click", function () { deck.legendId = null; deck.championId = null; deck.main = []; deck.domains = []; deck.runes = {}; persistDecks(); renderBuilder(); }); });

    host.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { state.builder.tab = b.getAttribute("data-tab"); renderBuilder(); }); });

    var filt = host.querySelector("#deck-card-filter");
    if (filt) filt.addEventListener("input", function () {
      state.builder.cardFilter = filt.value;
      clearTimeout(softTimer);
      softTimer = setTimeout(function () {
        var hadFocus = document.activeElement === filt;
        var caret = filt.selectionStart;
        renderBuilder();
        var f2 = document.getElementById("deck-card-filter");
        if (hadFocus && f2) { f2.focus(); try { f2.setSelectionRange(caret, caret); } catch (e) {} }
      }, 120);
    });

    host.querySelectorAll("[data-add-main]").forEach(function (b) { b.addEventListener("click", function () { addToMain(deck, b.getAttribute("data-add-main")); renderBuilder(); }); });
    host.querySelectorAll("[data-rm-main]").forEach(function (b) { b.addEventListener("click", function () { removeFromMain(deck, b.getAttribute("data-rm-main")); renderBuilder(); }); });
    host.querySelectorAll("[data-add-sb]").forEach(function (b) { b.addEventListener("click", function () { addToSideboard(deck, b.getAttribute("data-add-sb")); renderBuilder(); }); });
    host.querySelectorAll("[data-rm-sb]").forEach(function (b) { b.addEventListener("click", function () { removeFromSideboard(deck, b.getAttribute("data-rm-sb")); renderBuilder(); }); });

    host.querySelectorAll("[data-toggle-bf]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-toggle-bf");
        deck.battlefields = deck.battlefields || [];
        var idx = deck.battlefields.indexOf(id);
        if (idx !== -1) deck.battlefields.splice(idx, 1);
        else if (deck.battlefields.length < RULES.battlefieldCount) deck.battlefields.push(id);
        else toast("Already have " + RULES.battlefieldCount + " battlefields — remove one first.");
        persistDecks();
        renderBuilder();
      });
    });

    host.querySelectorAll("[data-rune]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var d = inp.getAttribute("data-rune");
        deck.runes[d] = clamp(parseInt(inp.value, 10) || 0, 0, RULES.runeDeckSize);
        persistDecks();
        renderBuilder();
      });
    });

    host.querySelectorAll("[data-copy-code]").forEach(function (b) {
      b.addEventListener("click", function () {
        var codeEl = document.getElementById("share-code");
        copyToClipboard(codeEl.textContent);
      });
    });

    host.querySelectorAll("[data-delete-deck]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (window.confirm("Delete \"" + deck.name + "\"? This can't be undone.")) deleteDeck(deck.id);
      });
    });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Copied to clipboard."); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      toast("Copied to clipboard.");
    } catch (e) { toast("Couldn't copy automatically — select the code manually."); }
  }

  /* ---------------- deck share encode/decode ---------------- */

  function snapshotCard(c) {
    return { id: c.id, n: c.name, t: c.type, d: c.domains || [], co: c.cost, p: c.power, r: c.rarity };
  }

  function encodeDeckShare(deck) {
    var legend = state.cardsById[deck.legendId];
    var champion = state.cardsById[deck.championId];
    var payload = {
      v: 1,
      name: deck.name,
      legend: legend ? snapshotCard(legend) : null,
      champion: champion ? snapshotCard(champion) : null,
      domains: deck.domains,
      main: (deck.main || []).map(function (e) { var c = state.cardsById[e.cardId]; return c ? { c: snapshotCard(c), q: e.qty } : null; }).filter(Boolean),
      runes: deck.runes,
      battlefields: (deck.battlefields || []).map(function (id) { var c = state.cardsById[id]; return c ? snapshotCard(c) : { id: id, n: id }; }),
      sideboard: (deck.sideboard || []).map(function (e) { var c = state.cardsById[e.cardId]; return c ? { c: snapshotCard(c), q: e.qty } : null; }).filter(Boolean)
    };
    try {
      return "JV1:" + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch (e) {
      return "JV1:ERROR";
    }
  }

  function decodeDeckShare(code) {
    code = (code || "").trim();
    if (code.indexOf("JV1:") === 0) code = code.slice(4);
    try {
      var json = decodeURIComponent(escape(atob(code)));
      var payload = safeParse(json, null);
      if (!payload || !payload.v) return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  // Merge any card snapshots from a shared payload into the local card DB
  // (as lightweight entries) so the deck can render and be edited locally.
  function ingestSnapshotCards(payload) {
    var toAdd = [];
    if (payload.legend) toAdd.push(payload.legend);
    if (payload.champion) toAdd.push(payload.champion);
    (payload.main || []).forEach(function (e) { if (e && e.c) toAdd.push(e.c); });
    (payload.battlefields || []).forEach(function (c) { if (c) toAdd.push(c); });
    (payload.sideboard || []).forEach(function (e) { if (e && e.c) toAdd.push(e.c); });
    toAdd.forEach(function (snap) {
      if (!snap || !snap.id) return;
      if (state.cardsById[snap.id]) return;
      var card = { id: snap.id, name: snap.n, set: "SHARED", setName: "Imported from share code", collectorNumber: "", type: snap.t, domains: snap.d || [], rarity: snap.r || "", cost: snap.co, power: snap.p, text: "(imported from a shared deck code — text not included)", isPlaceholder: false };
      state.cards.push(card);
      state.cardsById[card.id] = card;
    });
    persistCards();
  }

  function importDeckFromPayload(payload) {
    ingestSnapshotCards(payload);
    var d = newDeckObject();
    d.name = (payload.name || "Imported deck") + " (imported)";
    d.legendId = payload.legend ? payload.legend.id : null;
    d.championId = payload.champion ? payload.champion.id : null;
    d.domains = payload.domains || [];
    d.main = (payload.main || []).map(function (e) { return { cardId: e.c.id, qty: e.q }; });
    d.runes = payload.runes || {};
    d.battlefields = (payload.battlefields || []).map(function (c) { return c.id; });
    d.sideboard = (payload.sideboard || []).map(function (e) { return { cardId: e.c.id, qty: e.q }; });
    state.decks.push(d);
    persistDecks();
    state.builder.deckId = d.id;
    return d;
  }

  function promptImportShareCode() {
    var code = window.prompt("Paste a Jankrats share code:");
    if (!code) return;
    var payload = decodeDeckShare(code);
    if (!payload) { toast("That doesn't look like a valid share code."); return; }
    var d = importDeckFromPayload(payload);
    toast('Imported "' + d.name + '".');
    renderDecksView();
  }

  function renderSharedView() {
    var el = document.getElementById("view-shared");
    if (!state.sharedDeck) { el.innerHTML = ""; return; }
    var payload = state.sharedDeck;
    var html = '<div class="view-head"><div><h1>' + escapeHtml(payload.name || "Shared deck") + '</h1><p>Someone shared this Jankrats deck with you as a link. Import it to add it (and its cards) to your own Vault.</p></div>' +
      '<button class="btn primary" data-action="import-shared">Import into my Vault</button></div>';
    html += '<div class="callout" style="margin-bottom:16px;">Legend: <b>' + escapeHtml(payload.legend ? payload.legend.n : "—") + "</b> · Champion: <b>" + escapeHtml(payload.champion ? payload.champion.n : "—") + "</b> · " + domainChips(payload.domains) + "</div>";
    html += '<div class="card-grid">' + (payload.main || []).map(function (e) {
      return cardTileHtml({ id: e.c.id, name: e.c.n + " ×" + e.q, type: e.c.t, domains: e.c.d, cost: e.c.co, power: e.c.p, rarity: e.c.r });
    }).join("") + "</div>";
    el.innerHTML = html;
    el.querySelector('[data-action="import-shared"]').addEventListener("click", function () {
      var d = importDeckFromPayload(payload);
      toast('Imported "' + d.name + '".');
      navigate("decks");
    });
  }

  /* ================================================================
     IMPORT (CSV / JSON) of real card data
     ================================================================ */

  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var voiceImportState = { listening: false, recognition: null, transcript: "", results: [] };

  function renderImportView() {
    var el = document.getElementById("view-import");
    if (JVBackend.isConfigured() && !state.social.session) {
      el.innerHTML = socialSignInPromptHtml("Sign in to import cards into your collection — it'll sync to your account and follow you across devices.");
      wireSignInPrompt(el);
      return;
    }

    var html = '<div class="view-head"><div><h1>Import to Collection</h1><p>Bring in a list of cards you own. Nothing is fetched automatically — paste or upload JSON or CSV you\'ve put together yourself, and it sets how many of each you own, matched against the existing card database.</p></div></div>';

    html += '<div class="tabs">' + tabBtn2("json", "JSON") + tabBtn2("csv", "CSV") + "</div>";
    html += '<div id="import-schema"></div>';

    html += '<div class="field" style="margin-top:14px;"><label>Upload a file</label><input type="file" id="import-file" accept=".json,.csv,application/json,text/csv"></div>';
    html += '<div class="field" style="margin-top:14px;"><label>Or paste data</label><textarea id="import-text" rows="10" placeholder="Paste JSON array or CSV here…"></textarea></div>';
    html += '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button class="btn primary" id="import-run">Import</button>' +
      "</div>";
    html += '<div id="import-result" style="margin-top:14px;"></div>';

    html += renderVoiceImportSection();

    el.innerHTML = html;
    renderImportSchema("json");
    wireVoiceImport(el);
    function setImportTab(key) {
      el.querySelectorAll("[data-tab2]").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-tab2") === key); });
      renderImportSchema(key);
    }
    el.querySelectorAll("[data-tab2]").forEach(function (b) {
      b.addEventListener("click", function () { setImportTab(b.getAttribute("data-tab2")); });
    });
    document.getElementById("import-file").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      if (/\.csv$/i.test(file.name)) setImportTab("csv");
      else if (/\.json$/i.test(file.name)) setImportTab("json");
      var reader = new FileReader();
      reader.onload = function () { document.getElementById("import-text").value = reader.result; };
      reader.onerror = function () { toast("Couldn't read that file."); };
      reader.readAsText(file);
    });
    document.getElementById("import-run").addEventListener("click", function () {
      var mode = el.querySelector("[data-tab2].active").getAttribute("data-tab2");
      var text = document.getElementById("import-text").value;
      runImport(mode, text);
    });
  }

  function tabBtn2(key, label) {
    return '<button class="' + (key === "json" ? "active" : "") + '" data-tab2="' + key + '">' + label + "</button>";
  }

  function renderImportSchema(mode) {
    var host = document.getElementById("import-schema");
    if (mode === "json") {
      host.innerHTML = '<p style="font-size:12.5px;color:var(--ink-faint);">Array of objects, one per card you own. Each needs <code>qty</code> and either <code>id</code> (exact card id, e.g. <code>OGN-179/298</code>) or <code>name</code> (matched against the card database, same fuzzy matching as the voice importer below). <code>foil</code> is optional (defaults to 0). Example: <code>[{"id":"OGN-179/298","qty":3},{"name":"Ahri, Alluring","qty":1,"foil":1}]</code></p>';
    } else {
      host.innerHTML = '<p style="font-size:12.5px;color:var(--ink-faint);">First row is a header: <code>id,qty,foil</code> or <code>name,qty,foil</code> (both <code>id</code> and <code>name</code> columns are fine together — <code>id</code> wins when both are present). <code>foil</code> is optional.</p>';
    }
  }

  function runImport(mode, text) {
    var resultEl = document.getElementById("import-result");
    var rows, errors = [];
    if (mode === "json") {
      var parsed = safeParse(text, null);
      if (!Array.isArray(parsed)) { resultEl.innerHTML = errorBox("That's not a valid JSON array."); return; }
      rows = parsed.map(function (raw, i) {
        return { idx: i + 1, id: raw && raw.id, name: raw && raw.name, qty: raw && raw.qty, foil: raw && raw.foil };
      });
    } else {
      var parsedRows = parseCSV(text);
      if (!parsedRows.length) { resultEl.innerHTML = errorBox("No rows found."); return; }
      var header = parsedRows[0].map(function (h) { return h.trim().toLowerCase(); });
      rows = [];
      for (var r = 1; r < parsedRows.length; r++) {
        if (!parsedRows[r].length || (parsedRows[r].length === 1 && !parsedRows[r][0])) continue;
        var obj = { idx: r + 1 };
        header.forEach(function (h, i) { obj[h] = parsedRows[r][i]; });
        rows.push(obj);
      }
    }

    var applied = 0;
    rows.forEach(function (row) {
      var card = null;
      if (row.id) card = state.cardsById[String(row.id).trim()] || null;
      if (!card && row.name) {
        var match = bestCardMatch(String(row.name));
        if (match) card = match.card;
      }
      if (!card) { errors.push("Row " + row.idx + ": no card found for " + escapeHtml(String(row.id || row.name || "(blank)"))); return; }

      var qty = (row.qty === undefined || row.qty === null || row.qty === "") ? NaN : Number(row.qty);
      if (isNaN(qty)) { errors.push("Row " + row.idx + " (" + card.name + "): missing or invalid qty"); return; }
      var foil = (row.foil === undefined || row.foil === null || row.foil === "") ? 0 : Number(row.foil);
      if (isNaN(foil)) foil = 0;

      setOwned(card.id, clamp(qty, 0, 999), clamp(foil, 0, 999));
      applied++;
    });

    if (!applied) { resultEl.innerHTML = errorBox("No valid collection entries found.") + (errors.length ? errorList(errors) : ""); return; }

    resultEl.innerHTML = '<div class="pill good" style="font-size:13px;padding:6px 12px;">' + applied + " card" + (applied === 1 ? "" : "s") + " updated in your collection</div>" + (errors.length ? errorList(errors) : "");
    renderRail();
    toast("Collection import complete.");
  }

  /* ================================================================
     VOICE IMPORT: speak (or type) a list of owned cards, fuzzy-match
     each phrase against the card database, and add to the collection.
     ================================================================ */

  function renderVoiceImportSection() {
    var supported = !!SpeechRecognitionCtor;
    var html = '<div class="view-head" style="margin-top:34px;"><div><h1 style="font-size:20px;">Speak your collection</h1>' +
      "<p>Read off the cards you own out loud (or type/paste a list) and it'll match each one against the card database and add it to your Collection.</p></div></div>";

    var variantNote = "Some cards have more than one printing (alt art, or a signed/secret-rare parallel). Add a word like <b>signature</b>, <b>secret</b>, or <b>star</b> for that special parallel, or <b>alt</b>/<b>showcase</b> for the alternate art — say nothing and it picks the plain printing.";
    if (!supported) {
      html += '<div class="callout" style="margin-bottom:14px;">Voice input isn\'t supported in this browser — try Chrome or Edge. You can still type or paste a list below (one card per line or comma-separated, e.g. "2 Bargain-Bin Baron, Sir Reginald Duct-Taped"). ' + variantNote + "</div>";
    } else {
      html += '<div class="callout" style="margin-bottom:14px;">Click the mic, then say your cards one after another (e.g. "two Bargain-Bin Baron, Sir Reginald Duct-Taped, three Anchor Dump"). Say a number before a card to set its quantity — otherwise it assumes 1. Click the mic again when you\'re done, then review the matches before adding them.<br><br>' + variantNote + "</div>";
    }

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      (supported ? '<button class="btn primary" id="voice-mic-toggle" type="button">🎤 Start listening</button>' : "") +
      '<button class="btn" id="voice-match" type="button">Match cards</button>' +
      '<button class="btn ghost" id="voice-clear" type="button">Clear</button>' +
      "</div>";

    html += '<div class="field" style="margin-top:12px;"><label>' + (supported ? "Heard so far (editable)" : "Type or paste a list") +
      '</label><textarea id="voice-transcript" rows="4" placeholder="e.g. two Bargain-Bin Baron, Sir Reginald Duct-Taped, three Anchor Dump">' +
      escapeHtml(voiceImportState.transcript) + "</textarea></div>";

    html += '<div id="voice-results" style="margin-top:14px;">' + voiceResultsHtml() + "</div>";
    return html;
  }

  function voiceResultsHtml() {
    var results = voiceImportState.results;
    if (!results.length) return "";
    var sorted = state.cards.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    var html = '<div style="overflow-x:auto;"><table class="coll-table"><thead><tr>' +
      "<th>You said</th><th>Matched card</th><th>Qty</th><th>Add</th>" +
      "</tr></thead><tbody>" +
      results.map(function (r, i) {
        return "<tr>" +
          "<td>" + escapeHtml(r.phrase) + (r.cardId ? "" : ' <span class="pill warn">no match</span>') + "</td>" +
          '<td><select data-row="' + i + '" data-field="card">' + cardSelectOptions(r.cardId, sorted) + "</select></td>" +
          '<td><input type="number" min="0" max="999" style="width:64px;" data-row="' + i + '" data-field="qty" value="' + r.qty + '"></td>' +
          '<td style="text-align:center;"><input type="checkbox" data-row="' + i + '" data-field="include"' + (r.cardId ? " checked" : "") + "></td>" +
          "</tr>";
      }).join("") +
      "</tbody></table></div>";
    html += '<div style="margin-top:10px;"><button class="btn primary" id="voice-add" type="button">Add checked cards to collection</button></div>';
    return html;
  }

  // Some cards share a name with another printing at the same numbered slot
  // (an alt-art variant, or a second parallel of an over-numbered secret
  // slot) — distinguished only by a letter/asterisk suffix on the id, e.g.
  // "OGN-066a/298" vs "OGN-066/298", or "VEN-194*/166" vs "VEN-194/166".
  function variantSuffixOf(card) {
    var m = card.id.match(/^[A-Za-z0-9]+-\d+([^\/]*)\//);
    return m ? m[1] : "";
  }

  function variantLabel(card) {
    var suf = variantSuffixOf(card);
    return suf === "*" ? " ★" : suf === "a" ? " (alt)" : "";
  }

  function cardSelectOptions(selectedId, sortedCards) {
    var html = '<option value=""' + (!selectedId ? " selected" : "") + ">— No match —</option>";
    sortedCards.forEach(function (c) {
      var label = escapeHtml(c.name) + variantLabel(c) + " — " + escapeHtml(c.set) + " " + escapeHtml(c.collectorNumber || "");
      html += '<option value="' + escapeHtml(c.id) + '"' + (c.id === selectedId ? " selected" : "") + ">" + label + "</option>";
    });
    return html;
  }

  var VOICE_NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  // Say one of these alongside a card name to pick a specific printing when
  // a card has more than one (e.g. "one signature Defender of Tomorrow").
  // Anything unrecognized/unsaid falls back to the plain/base printing.
  var VOICE_VARIANT_HINTS = {
    signature: "*", signed: "*", star: "*", special: "*", secret: "*",
    alt: "a", alternate: "a", showcase: "a"
  };

  function extractQtyAndName(phrase) {
    var words = phrase.trim().split(/\s+/).filter(Boolean);
    var qty = 1;
    if (words.length > 1) {
      var first = words[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (/^\d+$/.test(first)) { qty = parseInt(first, 10); words.shift(); }
      else if (VOICE_NUMBER_WORDS[first] !== undefined) { qty = VOICE_NUMBER_WORDS[first]; words.shift(); }
    }
    if (words.length > 1) {
      var xMatch = words[words.length - 1].toLowerCase().match(/^x(\d+)$/);
      if (xMatch) { qty = parseInt(xMatch[1], 10); words.pop(); }
    }
    var variantHint = null;
    words = words.filter(function (w) {
      var key = w.toLowerCase().replace(/[^a-z]/g, "");
      if (VOICE_VARIANT_HINTS[key] !== undefined) { variantHint = VOICE_VARIANT_HINTS[key]; return false; }
      return true;
    });
    return { qty: clamp(qty || 1, 1, 999), name: words.join(" "), variantHint: variantHint };
  }

  var VOICE_QTY_WORD_RE = /\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi;

  // Speech recognition rarely inserts punctuation, so "one Abandon two
  // Adaptatron" comes through as one run-on phrase. Since every card mention
  // starts with a quantity word ("one", "two", "3", "one of", ...), we can
  // find those boundaries ourselves and split there before matching.
  function autoInsertCardBoundaries(text) {
    if (!text) return text;
    var re = new RegExp(VOICE_QTY_WORD_RE.source, "gi");
    var out = "", lastIndex = 0, m;
    while ((m = re.exec(text)) !== null) {
      var idx = m.index;
      if (idx === 0) continue; // nothing before the very first token to separate
      if (/[,\n]\s*$/.test(text.slice(0, idx))) continue; // already at a boundary
      out += text.slice(lastIndex, idx).replace(/\s+$/, "") + ", ";
      lastIndex = idx;
    }
    out += text.slice(lastIndex);
    return out.replace(/,\s*,+/g, ",").replace(/[ \t]{2,}/g, " ").trim();
  }

  function splitTranscript(text) {
    return autoInsertCardBoundaries(String(text || ""))
      .split(/[,\n]|(?:\s+and\s+)/i)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function normalizeForMatch(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  function levenshtein(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1), curr = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      curr[0] = i;
      for (var j2 = 1; j2 <= n; j2++) {
        var cost = a.charAt(i - 1) === b.charAt(j2 - 1) ? 0 : 1;
        curr[j2] = Math.min(prev[j2] + 1, curr[j2 - 1] + 1, prev[j2 - 1] + cost);
      }
      var tmp = prev; prev = curr; curr = tmp;
    }
    return prev[n];
  }

  function cardNameSimilarity(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    var wa = a.split(" "), wb = b.split(" ");
    var common = wa.filter(function (w) { return wb.indexOf(w) !== -1; }).length;
    var wordScore = common / Math.max(wa.length, wb.length);
    var containScore = (b.indexOf(a) !== -1 || a.indexOf(b) !== -1) ? 0.85 : 0;
    var editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    return Math.max(wordScore, containScore, editScore);
  }

  // When several cards tie for the top score (same name, different
  // printing), pick whichever matches the spoken/typed variant hint; with
  // no hint, default to the plain/base printing rather than an arbitrary one.
  function pickVariant(tied, variantHint) {
    if (tied.length === 1) return tied[0];
    if (variantHint) {
      var wanted = tied.filter(function (c) { return variantSuffixOf(c) === variantHint; });
      if (wanted.length) return wanted[0];
    }
    var plain = tied.filter(function (c) { return variantSuffixOf(c) === ""; });
    return plain.length ? plain[0] : tied[0];
  }

  function bestCardMatch(nameQuery, variantHint) {
    var nq = normalizeForMatch(nameQuery);
    if (!nq) return null;
    var bestScore = 0, tied = [];
    state.cards.forEach(function (c) {
      var score = cardNameSimilarity(nq, normalizeForMatch(c.name));
      if (score > bestScore + 1e-9) { bestScore = score; tied = [c]; }
      else if (Math.abs(score - bestScore) < 1e-9 && score > 0) { tied.push(c); }
    });
    if (!tied.length || bestScore < 0.55) return null;
    return { card: pickVariant(tied, variantHint), score: bestScore };
  }

  function matchTranscriptToCards(text) {
    return splitTranscript(text).map(function (phrase) {
      var parsed = extractQtyAndName(phrase);
      var match = bestCardMatch(parsed.name, parsed.variantHint);
      return { phrase: phrase, qty: parsed.qty, cardId: match ? match.card.id : null };
    });
  }

  function wireVoiceImport(el) {
    var micBtn = el.querySelector("#voice-mic-toggle");
    var transcriptEl = el.querySelector("#voice-transcript");
    var matchBtn = el.querySelector("#voice-match");
    var clearBtn = el.querySelector("#voice-clear");

    if (transcriptEl) {
      transcriptEl.addEventListener("input", function () { voiceImportState.transcript = transcriptEl.value; });
    }
    if (micBtn) {
      micBtn.textContent = voiceImportState.listening ? "⏹ Stop listening" : "🎤 Start listening";
      micBtn.addEventListener("click", function () {
        if (voiceImportState.listening) stopVoiceListening();
        else startVoiceListening(transcriptEl);
      });
    }
    if (matchBtn) {
      matchBtn.addEventListener("click", function () {
        voiceImportState.transcript = transcriptEl ? transcriptEl.value : voiceImportState.transcript;
        voiceImportState.results = matchTranscriptToCards(voiceImportState.transcript);
        rerenderVoiceResults();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        stopVoiceListening();
        voiceImportState.transcript = "";
        voiceImportState.results = [];
        if (transcriptEl) transcriptEl.value = "";
        rerenderVoiceResults();
      });
    }
    wireVoiceResultsControls();
  }

  function startVoiceListening(transcriptEl) {
    if (!SpeechRecognitionCtor || voiceImportState.listening) return;
    var recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    var baseTranscript = voiceImportState.transcript ? voiceImportState.transcript.replace(/\s+$/, "") : "";

    recognition.onresult = function (event) {
      var finalChunk = "", interimChunk = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var r = event.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      if (finalChunk) {
        baseTranscript = (baseTranscript ? baseTranscript + ", " : "") + autoInsertCardBoundaries(finalChunk.trim());
        voiceImportState.transcript = baseTranscript;
      }
      if (transcriptEl) transcriptEl.value = baseTranscript + (interimChunk ? (baseTranscript ? " " : "") + interimChunk : "");
    };
    recognition.onerror = function (event) {
      toast(event.error === "not-allowed" ? "Microphone access denied." : "Voice input error: " + event.error);
      stopVoiceListening();
    };
    recognition.onend = function () {
      voiceImportState.listening = false;
      voiceImportState.recognition = null;
      var btn = document.getElementById("voice-mic-toggle");
      if (btn) btn.textContent = "🎤 Start listening";
    };

    voiceImportState.recognition = recognition;
    voiceImportState.listening = true;
    recognition.start();
    var btn = document.getElementById("voice-mic-toggle");
    if (btn) btn.textContent = "⏹ Stop listening";
  }

  function stopVoiceListening() {
    if (voiceImportState.recognition) {
      try { voiceImportState.recognition.stop(); } catch (e) {}
    }
    voiceImportState.listening = false;
  }

  function rerenderVoiceResults() {
    var host = document.getElementById("voice-results");
    if (!host) return;
    host.innerHTML = voiceResultsHtml();
    wireVoiceResultsControls();
  }

  function wireVoiceResultsControls() {
    var host = document.getElementById("voice-results");
    if (!host) return;
    host.querySelectorAll('select[data-field="card"]').forEach(function (sel) {
      sel.addEventListener("change", function () {
        var row = parseInt(sel.getAttribute("data-row"), 10);
        voiceImportState.results[row].cardId = sel.value || null;
      });
    });
    host.querySelectorAll('input[data-field="qty"]').forEach(function (inp) {
      inp.addEventListener("change", function () {
        var row = parseInt(inp.getAttribute("data-row"), 10);
        voiceImportState.results[row].qty = clamp(parseInt(inp.value, 10) || 0, 0, 999);
      });
    });
    var addBtn = document.getElementById("voice-add");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        var added = 0;
        host.querySelectorAll('input[data-field="include"]').forEach(function (chk) {
          var row = parseInt(chk.getAttribute("data-row"), 10);
          var r = voiceImportState.results[row];
          if (!chk.checked || !r || !r.cardId) return;
          setOwned(r.cardId, getOwned(r.cardId) + r.qty, getOwnedFoil(r.cardId));
          added++;
        });
        if (!added) { toast("Nothing checked to add."); return; }
        toast("Added " + added + " card" + (added === 1 ? "" : "s") + " to your collection.");
        voiceImportState.results = [];
        voiceImportState.transcript = "";
        var transcriptEl = document.getElementById("voice-transcript");
        if (transcriptEl) transcriptEl.value = "";
        rerenderVoiceResults();
        renderRail();
      });
    }
  }

  function errorBox(msg) { return '<div class="pill bad" style="font-size:13px;padding:6px 12px;margin-bottom:8px;">' + escapeHtml(msg) + "</div>"; }
  function errorList(errors) { return '<div style="font-size:12px;color:var(--bad);margin-top:6px;">' + errors.slice(0, 15).map(escapeHtml).join("<br>") + "</div>"; }

  // Minimal CSV parser: handles quoted fields with commas/newlines.
  function parseCSV(text) {
    var rows = []; var row = []; var field = ""; var inQuotes = false;
    text = text.replace(/\r\n/g, "\n");
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] || "").trim() !== ""; });
  }

  /* ================================================================
     INIT
     ================================================================ */

  function wireShell() {
    document.querySelectorAll(".nav button[data-view]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-view");
        if (v === "friends") { state.social.friendsTargetId = null; navigate(v); }
        else navigate(v);
      });
    });
    var nameInput = document.getElementById("profile-name");
    nameInput.addEventListener("change", function () { state.profile.name = nameInput.value; persistProfile(); renderRail(); });
    var themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
    window.addEventListener("popstate", function () {
      var v = pathToView(window.location.pathname);
      if (v) {
        if (v !== "import" && voiceImportState.listening) stopVoiceListening();
        state.route = v;
        render();
      }
    });
  }

  /* ================================================================
     SOCIAL: auth wiring, shared post-card renderer, composer, comments
     ================================================================ */

  function wireAuth() {
    JVBackend.onAuthChange(function (session) {
      var hadSession = !!state.social.session;
      state.social.session = session;
      if (session) {
        var authProvider = session.user && session.user.app_metadata && session.user.app_metadata.provider;
        if (authProvider) {
          var identityLabel = (session.user && session.user.email) ||
            (session.user && session.user.user_metadata && (session.user.user_metadata.full_name || session.user.user_metadata.name)) ||
            null;
          saveJSON(KEYS.lastAuthProvider, { provider: authProvider, label: identityLabel });
        }
        JVBackend.myProfile().then(function (p) {
          state.social.myProfile = p;
          renderRail();
          if (state.route === "feed" || state.route === "profile" || state.route === "dashboard") render();
        });
        JVBackend.listFollowingIds().then(function (ids) { state.social.followingIds = ids; });
        if (!hadSession) { syncCollectionOnSignIn(); syncDecksOnSignIn(); }
      } else if (hadSession) {
        state.social.myProfile = null;
        state.social.followingIds = [];
        state.social.feedPosts = null;
        state.social.myActivityPosts = null;
        state.social.friendsProfiles = null;
        state.social.friendsTargetId = null;
        state.social.friendsTargetProfile = null;
        state.social.friendsTargetCollection = null;
        state.social.friendsTargetDecks = null;
        // Collection is account-bound once signed in — clear it on sign-out
        // rather than leaving the previous account's cards visible/editable
        // to whoever uses this browser next.
        state.collection = {};
        persistCollection();
      }
      renderRail();
      if (["feed", "profile", "topcards", "friends", "dashboard", "collection"].indexOf(state.route) !== -1) render();
    });
  }

  // Runs once right after sign-in. If the account already has a cloud
  // collection (e.g. this is a second device), that becomes the source of
  // truth locally. Otherwise, if this browser already had a local
  // collection (built before signing in), it's pushed up to seed the
  // account so it isn't lost.
  function syncCollectionOnSignIn() {
    JVBackend.listMyCollection().then(function (cloud) {
      var cloudHasData = Object.keys(cloud).length > 0;
      var localHasData = Object.keys(state.collection).length > 0;
      if (cloudHasData) {
        state.collection = cloud;
        persistCollection();
        renderRail();
        if (state.route === "collection" || state.route === "dashboard") render();
      } else if (localHasData) {
        var entries = Object.keys(state.collection).map(function (cardId) {
          var e = state.collection[cardId];
          return { cardId: cardId, qty: e.qty || 0, foil: e.foil || 0 };
        });
        JVBackend.bulkUpsertCollection(entries).catch(function () {
          toast("Couldn't back up your local collection to your account.");
        });
      }
    });
  }

  // Runs once right after sign-in, alongside the collection sync. Decks
  // aren't gated behind sign-in (unlike Collection, they've always worked
  // fully offline), so this merges rather than replaces: any deck that
  // exists on only one side is kept, and one that exists on both keeps
  // whichever copy was edited more recently.
  function syncDecksOnSignIn() {
    JVBackend.listDecksFor(JVBackend.currentUserId()).then(function (cloud) {
      var byId = {};
      state.decks.forEach(function (d) { byId[d.id] = d; });
      cloud.forEach(function (cd) {
        var local = byId[cd.id];
        if (!local || (cd.updatedAt || 0) > (local.updatedAt || 0)) byId[cd.id] = cd;
      });
      state.decks = Object.keys(byId).map(function (id) { return byId[id]; });
      saveJSON(KEYS.decks, state.decks);
      if (state.decks.length) {
        JVBackend.bulkUpsertDecks(state.decks).catch(function () {
          toast("Couldn't sync your decks to your account.");
        });
      }
      if (state.route === "decks") renderDecksView();
    });
  }

  // Shows both provider buttons, with whichever one the browser last signed
  // in with tagged by a small badge that overlaps its top-right corner —
  // so returning players don't accidentally create a second account by
  // picking the other provider.
  function providerSignInButtonsHtml(googleId, discordId, baseClass, center) {
    var info = loadJSON(KEYS.lastAuthProvider, null);
    var last = info && info.provider;
    function wrap(provider, id, label) {
      var btn = '<button class="' + baseClass + '" id="' + id + '">' + label + "</button>";
      if (provider !== last) return "<div>" + btn + "</div>";
      return '<div class="last-used-wrap">' + btn + '<div class="last-used-badge">Last used</div></div>';
    }
    var google = wrap("google", googleId, "Sign in with Google");
    var discord = wrap("discord", discordId, "Sign in with Discord");
    var order = last === "discord" ? (discord + google) : (google + discord);
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding-top:8px;padding-right:6px;' + (center ? "justify-content:center;" : "") + '">' + order + "</div>";
  }

  function authRailHtml() {
    if (!JVBackend.isConfigured()) return "";
    var s = state.social;
    if (!s.session) {
      return '<div class="social-auth">' +
        providerSignInButtonsHtml("auth-signin", "auth-signin-discord", "btn small", false) +
        "</div>";
    }
    var name = (s.myProfile && s.myProfile.display_name) || (s.session.user && s.session.user.email) || "Signed in";
    return '<div class="social-auth signed-in"><button class="social-auth-me" data-open-my-profile>' +
      (s.myProfile && s.myProfile.avatar_url ? '<img class="social-avatar-sm" src="' + escapeHtml(s.myProfile.avatar_url) + '" alt="">' : '<span class="social-avatar-sm placeholder"></span>') +
      '<span>' + escapeHtml(name) + "</span></button>" +
      '<button class="btn small ghost" id="auth-signout">Sign out</button></div>';
  }

  function wireAuthRail(el) {
    var signin = el.querySelector("#auth-signin");
    if (signin) signin.addEventListener("click", function () { JVBackend.signInWithGoogle(); });
    var signinDiscord = el.querySelector("#auth-signin-discord");
    if (signinDiscord) signinDiscord.addEventListener("click", function () { JVBackend.signInWithDiscord(); });
    var signout = el.querySelector("#auth-signout");
    if (signout) signout.addEventListener("click", function () { JVBackend.signOut(); });
    var meBtn = el.querySelector("[data-open-my-profile]");
    if (meBtn) meBtn.addEventListener("click", function () { openProfile(null); });
  }

  function socialNotConfiguredHtml(title) {
    return '<div class="empty-state"><h3>' + escapeHtml(title) + '</h3>' +
      '<p>This deployment isn\'t connected to a Jankrats backend yet, so social features are off here. ' +
      'The person running this instance needs to finish the Supabase setup (see SETUP.md) — once that\'s done, this tab lights up automatically.</p></div>';
  }

  function socialSignInPromptHtml(message) {
    var html = '<div class="empty-state"><h3>Sign in to continue</h3><p>' + escapeHtml(message || "Sign in with Google to see and post to the feed.") + '</p>';
    html += '<div style="margin-top:10px;">' +
      providerSignInButtonsHtml("empty-signin", "empty-signin-discord", "btn primary", true) +
      "</div></div>";
    return html;
  }

  function wireSignInPrompt(el) {
    var b = el.querySelector("#empty-signin");
    if (b) b.addEventListener("click", function () { JVBackend.signInWithGoogle(); });
    var bd = el.querySelector("#empty-signin-discord");
    if (bd) bd.addEventListener("click", function () { JVBackend.signInWithDiscord(); });
  }

  /* ---- shared post-card rendering (used by Feed and Profile) ---- */

  function postAuthorName(p) { return (p.author && p.author.display_name) || "Anonymous brewer"; }

  function postCardHtml(p) {
    var s = state.social;
    var isMine = s.session && p.author_id === (s.session.user && s.session.user.id);
    var html = '<div class="post-card" data-post-id="' + p.id + '">';
    html += '<div class="post-head">' +
      '<button class="post-author" data-open-profile="' + p.author_id + '">' +
      (p.author && p.author.avatar_url ? '<img class="social-avatar-sm" src="' + escapeHtml(p.author.avatar_url) + '" alt="">' : '<span class="social-avatar-sm placeholder"></span>') +
      '<span>' + escapeHtml(postAuthorName(p)) + "</span></button>" +
      '<span class="post-type-pill ' + (p.type === "deck" ? "deck" : "pull") + '">' + (p.type === "deck" ? "Decklist" : (p.media_type === "video" ? "Video pull" : "Photo pull")) + "</span>" +
      (isMine ? '<button class="btn small ghost" data-delete-post="' + p.id + '" style="margin-left:auto;">Delete</button>' : "") +
      "</div>";

    if (p.caption) html += '<p class="post-caption">' + escapeHtml(p.caption) + "</p>";

    if (p.type === "pull" && p.media_path) {
      var url = JVBackend.mediaUrl(p.media_path);
      html += p.media_type === "video"
        ? '<video class="post-media" src="' + escapeHtml(url) + '" controls playsinline></video>'
        : '<img class="post-media" src="' + escapeHtml(url) + '" alt="">';
    }

    if (p.type === "deck" && p.deck_json) {
      html += deckPostSummaryHtml(p.deck_json, p.id);
    }

    html += '<div class="post-actions">' +
      '<button class="btn small ' + (p.kudosedByMe ? "primary" : "ghost") + '" data-kudos="' + p.id + '">▲ ' + (p.kudosCount || 0) + "</button>" +
      '<button class="btn small ghost" data-toggle-comments="' + p.id + '">💬 ' + (p.commentCount || 0) + "</button>" +
      "</div>";

    html += '<div class="post-comments" id="post-comments-' + p.id + '" style="display:none;"></div>';

    html += "</div>";
    return html;
  }

  function deckPostSummaryHtml(deckJson, postId) {
    var html = '<div class="post-deck-summary">';
    html += '<div class="pds-head">' +
      (deckJson.legend ? escapeHtml(deckJson.legend.n) : "—") + " · Champion: " +
      (deckJson.champion ? escapeHtml(deckJson.champion.n) : "—") +
      "</div>";
    html += '<div style="margin:6px 0;">' + domainChips(deckJson.domains) + "</div>";
    html += '<div class="pds-meta">' + ((deckJson.main || []).reduce(function (s, e) { return s + e.q; }, 0)) + " main deck cards</div>";
    html += '<button class="btn small ghost" style="margin-top:8px;" data-fork-deck="' + postId + '">Fork this deck</button>';
    html += "</div>";
    return html;
  }

  function wirePostCards(el, deckJsonById) {
    el.querySelectorAll("[data-open-profile]").forEach(function (b) {
      b.addEventListener("click", function () { openProfile(b.getAttribute("data-open-profile")); });
    });
    el.querySelectorAll("[data-kudos]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!state.social.session) { toast("Sign in to give kudos."); return; }
        var postId = b.getAttribute("data-kudos");
        var post = findPostAnywhere(postId);
        if (!post) return;
        var was = post.kudosedByMe;
        post.kudosedByMe = !was;
        post.kudosCount = (post.kudosCount || 0) + (was ? -1 : 1);
        renderPostCardInPlace(post);
        JVBackend.toggleKudos(postId, was).catch(function () {
          post.kudosedByMe = was;
          post.kudosCount = (post.kudosCount || 0) + (was ? 1 : -1);
          renderPostCardInPlace(post);
          toast("Couldn't update kudos — try again.");
        });
      });
    });
    el.querySelectorAll("[data-toggle-comments]").forEach(function (b) {
      b.addEventListener("click", function () { toggleComments(b.getAttribute("data-toggle-comments")); });
    });
    el.querySelectorAll("[data-delete-post]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!window.confirm("Delete this post?")) return;
        var postId = b.getAttribute("data-delete-post");
        JVBackend.deletePost(postId).then(function () {
          state.social.feedPosts = (state.social.feedPosts || []).filter(function (p) { return p.id !== postId; });
          state.social.profilePosts = (state.social.profilePosts || []).filter(function (p) { return p.id !== postId; });
          render();
          toast("Post deleted.");
        });
      });
    });
    el.querySelectorAll("[data-fork-deck]").forEach(function (b) {
      b.addEventListener("click", function () {
        var postId = b.getAttribute("data-fork-deck");
        var post = findPostAnywhere(postId);
        if (!post || !post.deck_json) return;
        var d = importDeckFromPayload(post.deck_json);
        toast('Forked into "' + d.name + '".');
        navigate("decks");
      });
    });
  }

  function findPostAnywhere(postId) {
    var lists = [state.social.feedPosts, state.social.profilePosts];
    for (var i = 0; i < lists.length; i++) {
      if (!lists[i]) continue;
      var hit = lists[i].filter(function (p) { return p.id === postId; })[0];
      if (hit) return hit;
    }
    return null;
  }

  function renderPostCardInPlace(post) {
    var card = document.querySelector('.post-card[data-post-id="' + post.id + '"]');
    if (!card) return;
    var kudosBtn = card.querySelector("[data-kudos]");
    if (kudosBtn) {
      kudosBtn.className = "btn small " + (post.kudosedByMe ? "primary" : "ghost");
      kudosBtn.textContent = "▲ " + (post.kudosCount || 0);
    }
  }

  function toggleComments(postId) {
    var host = document.getElementById("post-comments-" + postId);
    if (!host) return;
    var showing = host.style.display !== "none";
    if (showing) { host.style.display = "none"; return; }
    host.style.display = "block";
    if (state.social.openComments[postId]) { renderCommentsInto(host, postId); return; }
    host.innerHTML = '<p style="font-size:12px;color:var(--ink-faint);">Loading comments…</p>';
    JVBackend.listComments(postId).then(function (comments) {
      state.social.openComments[postId] = comments;
      renderCommentsInto(host, postId);
    });
  }

  function renderCommentsInto(host, postId) {
    var comments = state.social.openComments[postId] || [];
    var html = '<div class="comment-list">' + comments.map(function (c) {
      return '<div class="comment-row"><b>' + escapeHtml((c.author && c.author.display_name) || "Someone") + ":</b> " + escapeHtml(c.body) + "</div>";
    }).join("") + "</div>";
    if (state.social.session) {
      html += '<div class="comment-input-row"><input type="text" placeholder="Add a comment…" id="comment-input-' + postId + '">' +
        '<button class="btn small" data-add-comment="' + postId + '">Post</button></div>';
    }
    host.innerHTML = html;
    var addBtn = host.querySelector("[data-add-comment]");
    if (addBtn) addBtn.addEventListener("click", function () { submitComment(postId, host); });
    var input = host.querySelector("#comment-input-" + postId);
    if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") submitComment(postId, host); });
  }

  function submitComment(postId, host) {
    var input = document.getElementById("comment-input-" + postId);
    var body = (input && input.value || "").trim();
    if (!body) return;
    JVBackend.addComment(postId, body).then(function (comment) {
      state.social.openComments[postId] = (state.social.openComments[postId] || []).concat([comment]);
      renderCommentsInto(host, postId);
      var post = findPostAnywhere(postId);
      if (post) { post.commentCount = (post.commentCount || 0) + 1; renderPostCommentCount(post); }
      if (input) input.value = "";
    }).catch(function () { toast("Couldn't post comment — try again."); });
  }

  function renderPostCommentCount(post) {
    var card = document.querySelector('.post-card[data-post-id="' + post.id + '"]');
    if (!card) return;
    var btn = card.querySelector("[data-toggle-comments]");
    if (btn) btn.textContent = "💬 " + (post.commentCount || 0);
  }

  /* ---- Feed view ---- */

  function renderFeedView() {
    var el = document.getElementById("view-feed");
    if (!JVBackend.isConfigured()) { el.innerHTML = socialNotConfiguredHtml("Feed isn't connected yet"); return; }
    if (!state.social.session) { el.innerHTML = socialSignInPromptHtml(); wireSignInPrompt(el); return; }

    var html = '<div class="view-head"><div><h1>Feed</h1><p>Post a decklist or a pull/pack photo or video — either counts. Everyone signed in can see it.</p></div></div>';
    html += feedComposerHtml();
    html += '<div id="feed-posts-host">';
    if (state.social.feedPosts === null) {
      html += '<p style="font-size:13px;color:var(--ink-faint);">Loading feed…</p>';
    } else if (!state.social.feedPosts.length) {
      html += '<div class="empty-state"><h3>No posts yet</h3><p>Be the first — post a deck or a pull above.</p></div>';
    } else {
      html += state.social.feedPosts.map(postCardHtml).join("");
    }
    html += "</div>";

    el.innerHTML = html;
    wireFeedComposer(el);
    wirePostCards(el);

    if (state.social.feedPosts === null) {
      JVBackend.listPosts({ limit: 30 }).then(function (posts) {
        state.social.feedPosts = posts;
        if (state.route === "feed") renderFeedView();
      });
    }
  }

  function feedComposerHtml() {
    var tab = state.social.feedComposer;
    var html = '<div class="composer">';
    html += '<div class="tabs" style="margin-bottom:12px;">' +
      '<button class="' + (tab === "deck" ? "active" : "") + '" data-composer-tab="deck">Post a deck</button>' +
      '<button class="' + (tab === "pull" ? "active" : "") + '" data-composer-tab="pull">Post a pull (photo/video)</button>' +
      "</div>";

    if (tab === "deck") {
      var eligible = state.decks.filter(function (d) { return d.legendId && d.championId; });
      if (!eligible.length) {
        html += '<p style="font-size:13px;color:var(--ink-faint);">Build a deck with a Legend and Champion picked before you can post it.</p>';
      } else {
        html += '<div class="field"><label>Which deck</label><select id="composer-deck-select">' +
          eligible.map(function (d) { return '<option value="' + d.id + '">' + escapeHtml(d.name) + "</option>"; }).join("") +
          "</select></div>";
        html += '<div class="field"><label>Caption (optional)</label><input type="text" id="composer-deck-caption" placeholder="What makes this one jank?"></div>';
        html += '<button class="btn primary" id="composer-post-deck">Post decklist</button>';
      }
    } else {
      html += '<div class="field"><label>Photo or short video (≤60s)</label><input type="file" id="composer-media-file" accept="image/*,video/*"></div>';
      html += '<div class="field"><label>Caption</label><input type="text" id="composer-pull-caption" placeholder="Just pulled this…"></div>';
      html += '<div class="field"><label>Tag a card (optional)</label><input type="text" id="composer-card-tag" list="composer-card-list" placeholder="Start typing a card name…">' +
        '<datalist id="composer-card-list">' + state.cards.slice(0, 500).map(function (c) { return '<option value="' + escapeHtml(c.name) + '">'; }).join("") + "</datalist></div>";
      html += '<button class="btn primary" id="composer-post-pull">Post pull</button>';
    }
    html += "</div>";
    return html;
  }

  function wireFeedComposer(el) {
    el.querySelectorAll("[data-composer-tab]").forEach(function (b) {
      b.addEventListener("click", function () { state.social.feedComposer = b.getAttribute("data-composer-tab"); renderFeedView(); });
    });
    var postDeckBtn = el.querySelector("#composer-post-deck");
    if (postDeckBtn) postDeckBtn.addEventListener("click", function () {
      var sel = document.getElementById("composer-deck-select");
      var deck = state.decks.filter(function (d) { return d.id === sel.value; })[0];
      if (!deck) return;
      var caption = (document.getElementById("composer-deck-caption").value || "").trim();
      var payload = deckSharePayload(deck);
      var cardIds = (deck.main || []).map(function (e) { return e.cardId; }).concat(deck.battlefields || []);
      postDeckBtn.disabled = true;
      JVBackend.createDeckPost(payload, caption, cardIds).then(function (post) {
        post.author = state.social.myProfile;
        post.kudosCount = 0; post.kudosedByMe = false; post.commentCount = 0;
        state.social.feedPosts = [post].concat(state.social.feedPosts || []);
        toast("Posted!");
        renderFeedView();
      }).catch(function () { toast("Couldn't post — try again."); postDeckBtn.disabled = false; });
    });

    var postPullBtn = el.querySelector("#composer-post-pull");
    if (postPullBtn) postPullBtn.addEventListener("click", function () {
      var fileInput = document.getElementById("composer-media-file");
      var file = fileInput.files && fileInput.files[0];
      if (!file) { toast("Pick a photo or video first."); return; }
      var mediaType = file.type.indexOf("video") === 0 ? "video" : "photo";
      var caption = (document.getElementById("composer-pull-caption").value || "").trim();
      var tagName = (document.getElementById("composer-card-tag").value || "").trim().toLowerCase();
      var tagged = tagName ? state.cards.filter(function (c) { return c.name.toLowerCase() === tagName; })[0] : null;
      var cardIds = tagged ? [tagged.id] : [];

      function doPost() {
        postPullBtn.disabled = true;
        JVBackend.createPullPost(file, mediaType, caption, cardIds).then(function (post) {
          post.author = state.social.myProfile;
          post.kudosCount = 0; post.kudosedByMe = false; post.commentCount = 0;
          state.social.feedPosts = [post].concat(state.social.feedPosts || []);
          toast("Posted!");
          renderFeedView();
        }).catch(function () { toast("Couldn't upload — try again."); postPullBtn.disabled = false; });
      }

      if (mediaType === "video") {
        var v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = function () {
          window.URL.revokeObjectURL(v.src);
          if (v.duration > 60) { toast("Videos are capped at 60 seconds — trim it and try again."); return; }
          doPost();
        };
        v.src = URL.createObjectURL(file);
      } else {
        doPost();
      }
    });
  }

  // Same snapshot shape as encodeDeckShare's payload, but returned as a plain
  // object (not base64-encoded) since it's stored directly as jsonb.
  function deckSharePayload(deck) {
    var legend = state.cardsById[deck.legendId];
    var champion = state.cardsById[deck.championId];
    return {
      v: 1,
      name: deck.name,
      legend: legend ? snapshotCard(legend) : null,
      champion: champion ? snapshotCard(champion) : null,
      domains: deck.domains,
      main: (deck.main || []).map(function (e) { var c = state.cardsById[e.cardId]; return c ? { c: snapshotCard(c), q: e.qty } : null; }).filter(Boolean),
      runes: deck.runes,
      battlefields: (deck.battlefields || []).map(function (id) { var c = state.cardsById[id]; return c ? snapshotCard(c) : { id: id, n: id }; }),
      sideboard: (deck.sideboard || []).map(function (e) { var c = state.cardsById[e.cardId]; return c ? { c: snapshotCard(c), q: e.qty } : null; }).filter(Boolean)
    };
  }

  /* ---- Top Cards view ---- */

  function renderTopCardsView() {
    var el = document.getElementById("view-topcards");
    if (!JVBackend.isConfigured()) { el.innerHTML = socialNotConfiguredHtml("Top Cards isn't connected yet"); return; }
    if (!state.social.session) { el.innerHTML = socialSignInPromptHtml("Sign in with Google to see what the group is actually playing."); wireSignInPrompt(el); return; }

    var html = '<div class="view-head"><div><h1>Top cards</h1><p>Computed from every deck and pull posted to the feed — no voting, just what shows up.</p></div></div>';
    if (state.social.topCards === null) {
      html += '<p style="font-size:13px;color:var(--ink-faint);">Loading…</p>';
    } else if (!state.social.topCards.length) {
      html += '<div class="empty-state"><h3>Nothing posted yet</h3><p>Once decks and pulls get posted to the Feed, the most-featured cards show up here.</p></div>';
    } else {
      html += '<div class="top-cards-list">' + state.social.topCards.map(function (row, i) {
        var c = state.cardsById[row.card_id];
        var name = c ? c.name : row.card_id;
        return '<div class="top-card-row">' +
          '<span class="tcr-rank">#' + (i + 1) + "</span>" +
          (c && c.imageUrl ? '<img class="tcr-img" src="' + escapeHtml(c.imageUrl) + '" alt="">' : '<span class="tcr-img placeholder"></span>') +
          '<span class="tcr-name">' + escapeHtml(name) + "</span>" +
          '<span class="tcr-count">' + row.post_count + " post" + (row.post_count === 1 ? "" : "s") + "</span>" +
          "</div>";
      }).join("") + "</div>";
    }
    el.innerHTML = html;

    if (state.social.topCards === null) {
      JVBackend.getTopCards(50).then(function (rows) {
        state.social.topCards = rows;
        if (state.route === "topcards") renderTopCardsView();
      });
    }
  }

  /* ---- Profile view ---- */

  function renderProfileView() {
    var el = document.getElementById("view-profile");
    if (!JVBackend.isConfigured()) { el.innerHTML = socialNotConfiguredHtml("Profiles aren't connected yet"); return; }
    if (!state.social.session) { el.innerHTML = socialSignInPromptHtml("Sign in with Google to see this player's profile."); wireSignInPrompt(el); return; }

    var targetId = state.social.profileTargetId;
    if (!targetId || targetId === JVBackend.currentUserId()) { navigate("dashboard"); return; }

    var html = "";
    if (!state.social.profileData) {
      html = '<p style="font-size:13px;color:var(--ink-faint);">Loading profile…</p>';
      el.innerHTML = html;
      JVBackend.getProfile(targetId).then(function (p) {
        state.social.profileData = p;
        if (state.route === "profile") renderProfileView();
      });
      return;
    }

    var profile = state.social.profileData;
    var bannerCard = profile.champion_banner_card_id ? state.cardsById[profile.champion_banner_card_id] : null;
    var isFollowing = state.social.followingIds.indexOf(targetId) !== -1;

    html += '<div class="profile-banner"' + (bannerCard && bannerCard.imageUrl ? " style=\"background-image:url('" + escapeHtml(bannerCard.imageUrl) + "')\"" : "") + '>' +
      '<div class="profile-banner-overlay"><h1>' + escapeHtml(profile.display_name || "Anonymous brewer") + "</h1>" +
      '<button class="btn small ' + (isFollowing ? "" : "primary") + '" id="follow-btn">' + (isFollowing ? "Following" : "Follow") + "</button>" +
      "</div></div>";

    html += '<div class="section-block"><h2>Activity</h2><div id="profile-posts-host">';
    if (state.social.profilePosts === null) {
      html += '<p style="font-size:13px;color:var(--ink-faint);">Loading…</p>';
    } else if (!state.social.profilePosts.length) {
      html += '<div class="empty-state"><h3>No posts yet</h3><p>This player hasn\'t posted anything yet.</p></div>';
    } else {
      html += state.social.profilePosts.map(postCardHtml).join("");
    }
    html += "</div></div>";

    el.innerHTML = html;
    wirePostCards(el);

    var followBtn = el.querySelector("#follow-btn");
    if (followBtn) followBtn.addEventListener("click", function () {
      var was = isFollowing;
      JVBackend.toggleFollow(targetId, was).then(function () {
        if (was) state.social.followingIds = state.social.followingIds.filter(function (id) { return id !== targetId; });
        else state.social.followingIds.push(targetId);
        renderProfileView();
      });
    });

    if (state.social.profilePosts === null) {
      JVBackend.listPosts({ authorId: targetId, limit: 50 }).then(function (posts) {
        state.social.profilePosts = posts;
        if (state.route === "profile") renderProfileView();
      });
    }
  }

  function checkForSharedDeckInUrl() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("deck");
    if (!code) return false;
    var payload = decodeDeckShare(code);
    if (!payload) return false;
    state.sharedDeck = payload;
    state.route = "shared";
    return true;
  }

  function applyTheme() {
    var saved = loadJSON(KEYS.theme, null);
    var theme = saved === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "light" ? "☀" : "☾";
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    saveJSON(KEYS.theme, current === "light" ? "dark" : "light");
    applyTheme();
  }

  // Prices come from a daily-refreshed Supabase table (see
  // scripts/price-scraper), not the card data bundle -- fetch once at
  // startup and merge onto the already-loaded cards, then re-render so
  // whatever's on screen picks them up.
  function loadCardPrices() {
    if (!JVBackend.isConfigured()) return;
    JVBackend.listCardPrices().then(function (prices) {
      var any = false;
      Object.keys(prices).forEach(function (cardId) {
        var c = state.cardsById[cardId];
        if (c) { c.price = prices[cardId]; any = true; }
      });
      if (any) render();
    });
  }

  function init() {
    loadAll();
    applyTheme();
    wireShell();
    wireAuth();
    loadCardPrices();
    var hadShared = checkForSharedDeckInUrl();
    if (!hadShared) {
      // A bare "/" always resolves to dashboard via pathToView, which would
      // otherwise shadow an old-style "/#view" bookmark/link before its hash
      // ever gets consulted -- so check that legacy hash case first.
      var legacyHash = (window.location.hash || "").replace("#", "");
      var v;
      if ((window.location.pathname === "/" || window.location.pathname === "") && VIEWS.indexOf(legacyHash) !== -1) {
        v = legacyHash;
      } else {
        v = pathToView(window.location.pathname) || "dashboard";
      }
      state.route = v;
      var path = viewToPath(v);
      if (window.location.pathname !== path || window.location.hash) window.history.replaceState({ view: v }, "", path);
    }
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
