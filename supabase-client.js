/* ============================================================
   JVBackend — thin wrapper around Supabase for Jankrats' social layer
   (Feed, Profiles, Follows, Kudos, Comments, Top Cards, Push).

   Every method degrades gracefully when Supabase isn't configured yet
   (config.js still has placeholder values, or offline/local file use):
   isConfigured() reports false and the read methods resolve to empty
   results instead of throwing, so app.js can render a "not connected"
   state rather than breaking the rest of the app.
   ============================================================ */
(function () {
  "use strict";

  var cfg = window.__JV_CONFIG__ || {};
  var client = null;
  var cachedSession = null;
  var authListeners = [];

  function isConfigured() {
    return !!(
      window.supabase &&
      cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      cfg.SUPABASE_URL.indexOf("YOUR_") !== 0 &&
      cfg.SUPABASE_ANON_KEY.indexOf("YOUR_") !== 0
    );
  }

  function client_() {
    if (!isConfigured()) return null;
    if (!client) {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      client.auth.getSession().then(function (r) {
        cachedSession = (r.data && r.data.session) || null;
        authListeners.forEach(function (cb) { cb(cachedSession); });
      });
      client.auth.onAuthStateChange(function (_event, session) {
        cachedSession = session;
        authListeners.forEach(function (cb) { cb(session); });
      });
    }
    return client;
  }

  function getSession() { return cachedSession; }
  function currentUserId() { return cachedSession && cachedSession.user ? cachedSession.user.id : null; }
  // Registering a listener is what app.js does once at startup — use that as
  // the trigger to actually create the Supabase client, so it picks up an
  // existing session (or one just returned by a Google OAuth redirect)
  // immediately, instead of waiting for the user to click "Sign in" again.
  function onAuthChange(cb) {
    authListeners.push(cb);
    client_();
    if (cachedSession !== null) cb(cachedSession);
  }

  function signInWithGoogle() {
    var c = client_();
    if (!c) return Promise.reject(new Error("Backend not configured"));
    return c.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
  }

  function signInWithDiscord() {
    var c = client_();
    if (!c) return Promise.reject(new Error("Backend not configured"));
    return c.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
  }

  function signOut() {
    var c = client_();
    if (!c) return Promise.resolve();
    return c.auth.signOut();
  }

  /* ---------------- profiles ---------------- */

  function myProfile() {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve(null);
    return c.from("profiles").select("*").eq("id", uid).single()
      .then(function (r) { return r.data || null; });
  }

  function getProfile(userId) {
    var c = client_();
    if (!c) return Promise.resolve(null);
    return c.from("profiles").select("*").eq("id", userId).single()
      .then(function (r) { return r.data || null; });
  }

  function updateMyProfile(fields) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("profiles").update(fields).eq("id", uid).select().single()
      .then(function (r) { return r.data; });
  }

  /* ---------------- collection (shared with friends) ---------------- */

  function listProfiles() {
    var c = client_(); var uid = currentUserId();
    if (!c) return Promise.resolve([]);
    return c.from("profiles").select("id, display_name, avatar_url, champion_banner_card_id")
      .order("display_name", { ascending: true })
      .then(function (r) {
        var rows = r.data || [];
        return uid ? rows.filter(function (p) { return p.id !== uid; }) : rows;
      });
  }

  function collectionRowsToMap(rows) {
    var map = {};
    (rows || []).forEach(function (row) {
      map[row.card_id] = { qty: row.qty || 0, foil: row.foil || 0 };
    });
    return map;
  }

  function listMyCollection() {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve({});
    return c.from("collection_entries").select("card_id, qty, foil").eq("user_id", uid)
      .then(function (r) { return collectionRowsToMap(r.data); });
  }

  function listCollectionFor(userId) {
    var c = client_();
    if (!c) return Promise.resolve({});
    return c.from("collection_entries").select("card_id, qty, foil").eq("user_id", userId)
      .then(function (r) { return collectionRowsToMap(r.data); });
  }

  // Postgrest's query-builder objects are "thenable" (have .then) but don't
  // implement .catch/.finally themselves, so callers doing
  // JVBackend.xyz(...).catch(...) directly would throw "catch is not a
  // function". Wrapping with Promise.resolve() gives back a real Promise.
  function upsertCollectionEntry(cardId, qty, foil) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    if (!qty && !foil) {
      return Promise.resolve(c.from("collection_entries").delete().eq("user_id", uid).eq("card_id", cardId));
    }
    return Promise.resolve(c.from("collection_entries").upsert(
      { user_id: uid, card_id: cardId, qty: qty || 0, foil: foil || 0, updated_at: new Date().toISOString() },
      { onConflict: "user_id,card_id" }
    ));
  }

  // Used once, right after sign-in, to migrate a local-only collection
  // (built before the player ever signed in) up into their new account.
  function bulkUpsertCollection(entries) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    if (!entries || !entries.length) return Promise.resolve();
    var rows = entries.map(function (e) {
      return { user_id: uid, card_id: e.cardId, qty: e.qty || 0, foil: e.foil || 0, updated_at: new Date().toISOString() };
    });
    return Promise.resolve(c.from("collection_entries").upsert(rows, { onConflict: "user_id,card_id" }));
  }

  /* ---------------- posts / feed ---------------- */

  // opts: { limit, beforeCreatedAt, authorId }
  function listPosts(opts) {
    opts = opts || {};
    var c = client_();
    if (!c) return Promise.resolve([]);
    var q = c.from("posts").select("*, author:profiles!posts_author_id_fkey(id, display_name, avatar_url, champion_banner_card_id)")
      .order("created_at", { ascending: false })
      .limit(opts.limit || 20);
    if (opts.beforeCreatedAt) q = q.lt("created_at", opts.beforeCreatedAt);
    if (opts.authorId) q = q.eq("author_id", opts.authorId);
    return q.then(function (r) { return r.data || []; })
      .then(function (posts) { return attachCounts(posts); });
  }

  function attachCounts(posts) {
    var c = client_();
    if (!c || !posts.length) return posts;
    var ids = posts.map(function (p) { return p.id; });
    var uid = currentUserId();
    return Promise.all([
      c.from("kudos").select("post_id, user_id").in("post_id", ids),
      c.from("comments").select("id, post_id").in("post_id", ids)
    ]).then(function (results) {
      var kudosRows = (results[0].data || []);
      var commentRows = (results[1].data || []);
      posts.forEach(function (p) {
        var mine = kudosRows.filter(function (k) { return k.post_id === p.id; });
        p.kudosCount = mine.length;
        p.kudosedByMe = uid ? mine.some(function (k) { return k.user_id === uid; }) : false;
        p.commentCount = commentRows.filter(function (k) { return k.post_id === p.id; }).length;
      });
      return posts;
    });
  }

  function createDeckPost(deckPayload, caption, cardIds) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("posts").insert({
      author_id: uid, type: "deck", caption: caption || "",
      deck_json: deckPayload, card_ids: cardIds || []
    }).select().single().then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  function createPullPost(file, mediaType, caption, cardIds) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    var ext = (file.name.split(".").pop() || (mediaType === "video" ? "mp4" : "jpg")).toLowerCase();
    var path = uid + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    return c.storage.from("media").upload(path, file, { upsert: false }).then(function (up) {
      if (up.error) throw up.error;
      return c.from("posts").insert({
        author_id: uid, type: "pull", caption: caption || "",
        media_path: path, media_type: mediaType, card_ids: cardIds || []
      }).select().single();
    }).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  function mediaUrl(path) {
    var c = client_();
    if (!c || !path) return null;
    return c.storage.from("media").getPublicUrl(path).data.publicUrl;
  }

  function deletePost(postId) {
    var c = client_();
    if (!c) return Promise.reject(new Error("Backend not configured"));
    return Promise.resolve(c.from("posts").delete().eq("id", postId));
  }

  /* ---------------- kudos ---------------- */

  function toggleKudos(postId, currentlyKudosed) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    if (currentlyKudosed) {
      return Promise.resolve(c.from("kudos").delete().eq("post_id", postId).eq("user_id", uid));
    }
    return Promise.resolve(c.from("kudos").insert({ post_id: postId, user_id: uid }));
  }

  /* ---------------- comments ---------------- */

  function listComments(postId) {
    var c = client_();
    if (!c) return Promise.resolve([]);
    return c.from("comments")
      .select("*, author:profiles!comments_author_id_fkey(id, display_name, avatar_url)")
      .eq("post_id", postId).order("created_at", { ascending: true })
      .then(function (r) { return r.data || []; });
  }

  function addComment(postId, body) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("comments").insert({ post_id: postId, author_id: uid, body: body })
      .select("*, author:profiles!comments_author_id_fkey(id, display_name, avatar_url)").single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  /* ---------------- follows ---------------- */

  function listFollowingIds() {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve([]);
    return c.from("follows").select("following_id").eq("follower_id", uid)
      .then(function (r) { return (r.data || []).map(function (f) { return f.following_id; }); });
  }

  function toggleFollow(userId, currentlyFollowing) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    if (currentlyFollowing) {
      return Promise.resolve(c.from("follows").delete().eq("follower_id", uid).eq("following_id", userId));
    }
    return Promise.resolve(c.from("follows").insert({ follower_id: uid, following_id: userId }));
  }

  /* ---------------- top cards ---------------- */

  function getTopCards(limit) {
    var c = client_();
    if (!c) return Promise.resolve([]);
    return c.from("top_cards").select("*").limit(limit || 50)
      .then(function (r) { return r.data || []; });
  }

  /* ---------------- realtime ---------------- */

  // Calls cb() whenever a new post lands, so the feed can show a
  // "new posts — refresh" affordance instead of a hard auto-refresh.
  function subscribeFeed(cb) {
    var c = client_();
    if (!c) return function () {};
    var channel = c.channel("public:posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, cb)
      .subscribe();
    return function unsubscribe() { c.removeChannel(channel); };
  }

  /* ---------------- push notifications ---------------- */

  function pushSupported() {
    return !!(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PUBLIC_KEY.indexOf("YOUR_") !== 0);
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = window.atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function enablePush() {
    if (!pushSupported()) return Promise.reject(new Error("Push not supported here"));
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return navigator.serviceWorker.register("sw.js").then(function (reg) {
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY)
      });
    }).then(function (sub) {
      var json = sub.toJSON();
      return c.from("push_subscriptions").upsert({
        user_id: uid, endpoint: json.endpoint,
        p256dh: json.keys.p256dh, auth: json.keys.auth
      }, { onConflict: "endpoint" });
    });
  }

  function disablePush() {
    if (!pushSupported()) return Promise.resolve();
    var c = client_();
    return navigator.serviceWorker.getRegistration("sw.js").then(function (reg) {
      if (!reg) return null;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return null;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          if (!c) return null;
          return c.from("push_subscriptions").delete().eq("endpoint", endpoint);
        });
      });
    });
  }

  window.JVBackend = {
    isConfigured: isConfigured,
    getSession: getSession,
    currentUserId: currentUserId,
    onAuthChange: onAuthChange,
    signInWithGoogle: signInWithGoogle,
    signInWithDiscord: signInWithDiscord,
    signOut: signOut,
    myProfile: myProfile,
    getProfile: getProfile,
    updateMyProfile: updateMyProfile,
    listProfiles: listProfiles,
    listMyCollection: listMyCollection,
    listCollectionFor: listCollectionFor,
    upsertCollectionEntry: upsertCollectionEntry,
    bulkUpsertCollection: bulkUpsertCollection,
    listPosts: listPosts,
    createDeckPost: createDeckPost,
    createPullPost: createPullPost,
    mediaUrl: mediaUrl,
    deletePost: deletePost,
    toggleKudos: toggleKudos,
    listComments: listComments,
    addComment: addComment,
    listFollowingIds: listFollowingIds,
    toggleFollow: toggleFollow,
    getTopCards: getTopCards,
    subscribeFeed: subscribeFeed,
    pushSupported: pushSupported,
    enablePush: enablePush,
    disablePush: disablePush
  };
})();
