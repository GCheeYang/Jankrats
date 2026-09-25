/* ============================================================
   JVBackend — thin wrapper around Supabase for Jankrats' social layer
   (Feed, Profiles, Friends, Kudos, Comments, Top Cards, Push).

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
        authListeners.forEach(function (cb) { cb(cachedSession, "RESTORED"); });
      });
      // Forward Supabase's own event name (SIGNED_IN, SIGNED_OUT,
      // INITIAL_SESSION, TOKEN_REFRESHED, ...) instead of discarding it --
      // callers need to tell a genuine sign-in apart from a session just
      // being restored/refreshed on an ordinary page load, since a one-time
      // "just signed in" action (like merging local data into the account)
      // must not re-run on every reload of an already-signed-in tab.
      client.auth.onAuthStateChange(function (event, session) {
        cachedSession = session;
        authListeners.forEach(function (cb) { cb(session, event); });
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
  // cb receives (session, event); event is "RESTORED" for this immediate
  // replay of an already-known session, otherwise Supabase's own event name.
  function onAuthChange(cb) {
    authListeners.push(cb);
    client_();
    if (cachedSession !== null) cb(cachedSession, "RESTORED");
  }

  // Supabase only honors redirectTo if it's on the project's Redirect URLs
  // allow-list, otherwise it falls back to the site root -- so someone who
  // signs in from an invite link (/tournament/<CODE>) lands on Home and has
  // to scan again. Remember where they were (app.js resumes it right after
  // the sign-in completes, see resumeSavedReturnPath) so it works either way.
  function rememberReturnPath() {
    try {
      if (window.location.pathname && window.location.pathname !== "/") {
        localStorage.setItem("jankvault:v1:returnPath", JSON.stringify({ path: window.location.pathname, at: Date.now() }));
      }
    } catch (e) { /* storage unavailable -- redirectTo alone has to do */ }
  }

  function signInWithGoogle() {
    var c = client_();
    if (!c) return Promise.reject(new Error("Backend not configured"));
    rememberReturnPath();
    return c.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
  }

  function signInWithDiscord() {
    var c = client_();
    if (!c) return Promise.reject(new Error("Backend not configured"));
    rememberReturnPath();
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

  // Batches the collections of many users into one query (used by the
  // Wanted List's "who has these?" check, so checking a whole friends list
  // doesn't cost one round trip per person). Returns userId -> collection map.
  function listCollectionsFor(userIds) {
    var c = client_();
    if (!c || !userIds || !userIds.length) return Promise.resolve({});
    return c.from("collection_entries").select("user_id, card_id, qty, foil").in("user_id", userIds)
      .then(function (r) {
        var byUser = {};
        (r.data || []).forEach(function (row) {
          if (!byUser[row.user_id]) byUser[row.user_id] = {};
          byUser[row.user_id][row.card_id] = { qty: row.qty || 0, foil: row.foil || 0 };
        });
        return byUser;
      });
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

  /* ---------------- card prices (public, no auth needed) ---------------- */

  // card_prices is populated by scripts/price-scraper (a daily GitHub
  // Action), not by any signed-in user -- this is a plain public read.
  //
  // Supabase caps every request at 1000 rows by default, and there are more
  // priced cards than that -- a single plain select silently dropped the
  // rest, so those cards showed no price. Page through with .range() (in a
  // stable card_id order so pages don't overlap or skip) until a short page.
  function listCardPrices() {
    var c = client_();
    if (!c) return Promise.resolve({});
    var PAGE = 1000, map = {};
    function fetchPage(from) {
      return c.from("card_prices").select("*")
        .order("card_id", { ascending: true }).range(from, from + PAGE - 1)
        .then(function (r) {
          var rows = r.data || [];
          rows.forEach(function (row) {
            map[row.card_id] = {
              en: row.en_price_usd,
              enFoil: row.en_foil_price_usd,
              tcgplayerId: row.tcgplayer_product_id,
              updatedAt: row.updated_at
            };
          });
          return rows.length === PAGE ? fetchPage(from + PAGE) : map;
        });
    }
    return fetchPage(0);
  }

  /* ---------------- scan corrections (shared, crowd-sourced) ---------------- */

  // Fetched once at startup (see loadScanCorrections in app.js) and cached
  // client-side -- checked before fuzzy name matching so a phrase someone
  // already corrected gets fixed automatically instead of repeating the
  // same wrong match. Public read, same as card_prices.
  function listScanCorrections() {
    var c = client_();
    if (!c) return Promise.resolve({});
    return c.from("scan_corrections").select("phrase, card_id").then(function (r) {
      var map = {};
      (r.data || []).forEach(function (row) { map[row.phrase] = row.card_id; });
      return map;
    });
  }

  // Called whenever a signed-in player's edit in the scan review table
  // ends up different from what the AI/fuzzy-match originally guessed --
  // teaches the shared dictionary so the next person who scans something
  // that reads the same way gets it right immediately.
  function teachScanCorrection(phrase, cardId) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid || !phrase || !cardId) return Promise.resolve();
    return c.from("scan_corrections").upsert(
      { phrase: phrase, card_id: cardId, updated_at: new Date().toISOString() },
      { onConflict: "phrase" }
    ).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  // Write-only usage telemetry: one row per card added from a scan,
  // corrected or not -- see the comment above scan_add_events in
  // schema.sql for how this is meant to be reviewed (a correction-rate
  // query in the Supabase SQL editor, not through the app itself).
  function logScanAddEvent(cardId, hadIdentityCorrection, hadQtyCorrection) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid || !cardId) return Promise.resolve();
    return c.from("scan_add_events").insert({
      card_id: cardId, had_identity_correction: !!hadIdentityCorrection, had_qty_correction: !!hadQtyCorrection
    }).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  /* ---------------- decks (shared with friends) ---------------- */

  function deckRowToLocal(row) {
    return {
      id: row.id,
      name: row.name,
      legendId: row.legend_id,
      championId: row.champion_id,
      domains: row.domains || [],
      main: row.main || [],
      runes: row.runes || {},
      battlefields: row.battlefields || [],
      sideboard: row.sideboard || [],
      notes: row.notes || "",
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
    };
  }

  function deckToRow(uid, deck) {
    return {
      id: deck.id, user_id: uid, name: deck.name || "New deck",
      legend_id: deck.legendId || null, champion_id: deck.championId || null,
      domains: deck.domains || [], main: deck.main || [], runes: deck.runes || {},
      battlefields: deck.battlefields || [], sideboard: deck.sideboard || [],
      notes: deck.notes || "", updated_at: new Date().toISOString()
    };
  }

  function listDecksFor(userId) {
    var c = client_();
    if (!c) return Promise.resolve([]);
    return c.from("decks").select("*").eq("user_id", userId).order("updated_at", { ascending: false })
      .then(function (r) { return (r.data || []).map(deckRowToLocal); });
  }

  // Used both for a single deck save and, with an array, to migrate a
  // local-only set of decks (built before signing in) up into the account.
  function bulkUpsertDecks(decks) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    if (!decks || !decks.length) return Promise.resolve();
    var rows = decks.map(function (d) { return deckToRow(uid, d); });
    return c.from("decks").upsert(rows, { onConflict: "user_id,id" }).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  // Callers (deleteDeck's tombstone cleanup, syncDecksOnSignIn's retry)
  // treat a resolved promise as "the row is really gone" -- Supabase's
  // query builder resolves even when the delete failed server-side
  // (RLS denial, bad filter, etc.), it just sets r.error instead of
  // rejecting, so this has to check r.error and throw itself or a failed
  // delete would look successful and the tombstone protecting against
  // resurrection would get cleared too early.
  //
  // Records the deletion in deck_deletions BEFORE deleting the row, not
  // after: bulkUpsertDecks re-uploads a caller's *entire* local deck
  // list on every edit, so a different tab/device that still has this
  // deck cached can re-insert it moments later. The permanent
  // deck_deletions row is what syncDecksOnSignIn checks (and self-heals
  // against) on every future sign-in, on any device -- writing it first
  // means even a delete that fails partway still leaves that guard in place.
  function deleteDeckRemote(deckId) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("deck_deletions").upsert({ user_id: uid, deck_id: deckId }, { onConflict: "user_id,deck_id" }).then(function (r) {
      if (r.error) throw r.error;
      return c.from("decks").delete().eq("user_id", uid).eq("id", deckId);
    }).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  // Every deck id this player has ever deleted, per deck_deletions above --
  // used by syncDecksOnSignIn to keep a resurrected row from re-entering
  // local state, and to re-delete it server-side if some other device's
  // stale upload brought it back.
  function listDeckDeletionIds(userId) {
    var c = client_();
    if (!c) return Promise.resolve([]);
    return c.from("deck_deletions").select("deck_id").eq("user_id", userId)
      .then(function (r) { return (r.data || []).map(function (row) { return row.deck_id; }); });
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

  /* ---------------- friends (mutual -- request, then accept) ---------------- */

  // Every friend_requests row this user is a party to, reshaped into three
  // id lists: `friends` (status "accepted", either direction), `incoming`
  // (pending requests sent TO this user, awaiting their accept/decline),
  // and `outgoing` (pending requests this user sent, awaiting the other
  // side's accept). A relationship only becomes mutual once the recipient
  // accepts (see acceptFriendRequest) -- unlike the old one-directional
  // follow, nobody shows up as a friend without both sides agreeing.
  function listFriendEdges() {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve({ friends: [], incoming: [], outgoing: [] });
    return c.from("friend_requests").select("requester_id, recipient_id, status")
      .or("requester_id.eq." + uid + ",recipient_id.eq." + uid)
      .then(function (r) {
        if (r.error) throw r.error;
        var friends = [], incoming = [], outgoing = [];
        (r.data || []).forEach(function (row) {
          var otherId = row.requester_id === uid ? row.recipient_id : row.requester_id;
          if (row.status === "accepted") friends.push(otherId);
          else if (row.recipient_id === uid) incoming.push(otherId);
          else outgoing.push(otherId);
        });
        return { friends: friends, incoming: incoming, outgoing: outgoing };
      });
  }

  function sendFriendRequest(userId) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("friend_requests").insert({ requester_id: uid, recipient_id: userId, status: "pending" })
      .then(function (r) { if (r.error) throw r.error; });
  }

  // Only the recipient of a pending request can accept it (see the RLS
  // update policy on friend_requests) -- requesterId is always the OTHER
  // person, never the signed-in user.
  function acceptFriendRequest(requesterId) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("friend_requests").update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("requester_id", requesterId).eq("recipient_id", uid)
      .then(function (r) { if (r.error) throw r.error; });
  }

  // Deletes whatever edge exists between this user and otherId, regardless
  // of direction or status -- the same call covers declining an incoming
  // request, cancelling one this user sent, and unfriending someone
  // already accepted.
  function removeFriendEdge(otherId) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("friend_requests").delete()
      .or("and(requester_id.eq." + uid + ",recipient_id.eq." + otherId + "),and(requester_id.eq." + otherId + ",recipient_id.eq." + uid + ")")
      .then(function (r) { if (r.error) throw r.error; });
  }

  /* ---------------- top cards ---------------- */

  function getTopCards(limit) {
    var c = client_();
    if (!c) return Promise.resolve([]);
    return c.from("top_cards").select("*").limit(limit || 50)
      .then(function (r) { return r.data || []; });
  }

  /* ---------------- tournaments (organizer/participant sync) ---------------- */

  // id is the short join code the organizer's client generated locally --
  // data is the entire tournament object (players/rounds/matches) as
  // app.js already keeps it in localStorage, stored as-is in jsonb so no
  // reshaping is needed on either side of the wire.
  function createTournamentRemote(id, data) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("tournaments").insert({
      id: id, organizer_id: uid, data: data, updated_at: new Date().toISOString()
    }).select().single().then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  // Called by the organizer's own client after every local change
  // (a pairing generated, a score entered) to push the new state up.
  // RLS restricts this to rows the caller organizes.
  function updateTournamentRemote(id, data) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("tournaments").update({
      data: data, updated_at: new Date().toISOString()
    }).eq("id", id).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  function getTournamentRemote(id) {
    var c = client_();
    if (!c) return Promise.resolve(null);
    return c.from("tournaments").select("*").eq("id", id).maybeSingle()
      .then(function (r) { return r.data || null; });
  }

  function deleteTournamentRemote(id) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("tournaments").delete().eq("id", id).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  // A participant joining self-inserts their own row (RLS: with check
  // auth.uid() = user_id) -- the organizer's client picks these up via
  // subscribeTournamentParticipants and merges them into the roster.
  function joinTournamentRemote(id, name) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("tournament_participants").upsert(
      { tournament_id: id, user_id: uid, name: name || "Player" },
      { onConflict: "tournament_id,user_id" }
    ).select().single().then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  // A participant reporting their own match's result upserts here (RLS:
  // with check auth.uid() = user_id) rather than writing the tournament
  // row directly -- they have no access to that (see updateTournamentRemote
  // above). The tourney_sync_match_report trigger merges it into the
  // shared tournament row server-side, the same self-service pattern
  // joinTournamentRemote uses for the roster.
  function reportMatchResultRemote(tournamentId, roundNumber, matchId, result, games) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("tournament_match_reports").upsert(
      { tournament_id: tournamentId, round_number: roundNumber, match_id: matchId, user_id: uid, result: result, games: games },
      { onConflict: "tournament_id,match_id,user_id" }
    ).select().single().then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  // Fires on every UPDATE to this one tournament row -- both the
  // organizer's other tabs/devices and every participant's read-only
  // view use this same subscription to stay live.
  function subscribeTournament(id, cb) {
    var c = client_();
    if (!c) return function () {};
    var channel = c.channel("tournament:" + id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tournaments", filter: "id=eq." + id }, cb)
      .subscribe();
    return function unsubscribe() { c.removeChannel(channel); };
  }

  /* ---------------- feedback ---------------- */

  // No .select() on purpose: users can insert feedback but have no read
  // access to the table, so asking for the row back would be rejected.
  function submitFeedback(kind, body, page) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("feedback").insert({ user_id: uid, kind: kind, body: body, page: page || null })
      .then(function (r) { if (r.error) throw r.error; });
  }

  /* ---------------- direct messages ---------------- */

  function sendMessage(recipientId, body) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.reject(new Error("Not signed in"));
    return c.from("messages").insert({ sender_id: uid, recipient_id: recipientId, body: body })
      .select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  function listConversation(otherId) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve([]);
    return c.from("messages").select("*")
      .or("and(sender_id.eq." + uid + ",recipient_id.eq." + otherId + "),and(sender_id.eq." + otherId + ",recipient_id.eq." + uid + ")")
      .order("created_at", { ascending: true }).limit(300)
      .then(function (r) { return r.data || []; });
  }

  // Most recent messages involving me (either direction); the caller
  // groups them into one row per conversation partner.
  function listRecentMessages() {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve([]);
    return c.from("messages").select("*")
      .or("sender_id.eq." + uid + ",recipient_id.eq." + uid)
      .order("created_at", { ascending: false }).limit(300)
      .then(function (r) { return r.data || []; });
  }

  function markConversationRead(otherId) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve();
    return Promise.resolve(c.from("messages").update({ read_at: new Date().toISOString() })
      .eq("recipient_id", uid).eq("sender_id", otherId).is("read_at", null));
  }

  function countUnreadMessages() {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return Promise.resolve(0);
    return c.from("messages").select("id", { count: "exact", head: true })
      .eq("recipient_id", uid).is("read_at", null)
      .then(function (r) { return r.count || 0; });
  }

  // cb receives the new message row for every message sent TO me.
  function subscribeIncomingMessages(cb) {
    var c = client_(); var uid = currentUserId();
    if (!c || !uid) return function () {};
    var channel = c.channel("messages:" + uid)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "recipient_id=eq." + uid },
        function (payload) { if (payload && payload.new) cb(payload.new); })
      .subscribe();
    return function unsubscribe() { c.removeChannel(channel); };
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

  /* ---------------- AI card scan (photo/video → collection import) ---------------- */

  // frames: array of "data:image/jpeg;base64,..." strings extracted client-side.
  // Resolves to { ok, cards: [{name, qty, collectorNumber?}] } from the
  // identify-cards Edge Function — see supabase/functions/identify-cards.
  function identifyCards(frames) {
    var c = client_();
    if (!c) return Promise.reject(new Error("Backend not configured"));
    return c.functions.invoke("identify-cards", { body: { frames: frames } }).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  // Same Edge Function, "review" mode -- sends the frames from a scan back
  // to Claude along with what it originally reported for one card and what
  // the actual correct count was. The function stores its own analysis in
  // scan_qty_reviews and folds recent ones into every future identifyCards
  // call, so a real quantity mistake teaches something durable instead of
  // just getting silently overwritten in one person's local edit. Resolves
  // to { ok, analysis } -- see teachScanQuantityCorrection in app.js.
  function reviewScanQuantity(frames, cardName, aiQty, trueQty) {
    var c = client_();
    if (!c) return Promise.reject(new Error("Backend not configured"));
    return c.functions.invoke("identify-cards", {
      body: { mode: "review", frames: frames, cardName: cardName, aiQty: aiQty, trueQty: trueQty }
    }).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
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
    listCollectionsFor: listCollectionsFor,
    upsertCollectionEntry: upsertCollectionEntry,
    bulkUpsertCollection: bulkUpsertCollection,
    listCardPrices: listCardPrices,
    listScanCorrections: listScanCorrections,
    teachScanCorrection: teachScanCorrection,
    listDecksFor: listDecksFor,
    bulkUpsertDecks: bulkUpsertDecks,
    deleteDeckRemote: deleteDeckRemote,
    listDeckDeletionIds: listDeckDeletionIds,
    listPosts: listPosts,
    createDeckPost: createDeckPost,
    createPullPost: createPullPost,
    mediaUrl: mediaUrl,
    deletePost: deletePost,
    toggleKudos: toggleKudos,
    listComments: listComments,
    addComment: addComment,
    listFriendEdges: listFriendEdges,
    sendFriendRequest: sendFriendRequest,
    acceptFriendRequest: acceptFriendRequest,
    removeFriendEdge: removeFriendEdge,
    getTopCards: getTopCards,
    subscribeFeed: subscribeFeed,
    submitFeedback: submitFeedback,
    sendMessage: sendMessage,
    listConversation: listConversation,
    listRecentMessages: listRecentMessages,
    markConversationRead: markConversationRead,
    countUnreadMessages: countUnreadMessages,
    subscribeIncomingMessages: subscribeIncomingMessages,
    createTournamentRemote: createTournamentRemote,
    updateTournamentRemote: updateTournamentRemote,
    getTournamentRemote: getTournamentRemote,
    deleteTournamentRemote: deleteTournamentRemote,
    joinTournamentRemote: joinTournamentRemote,
    reportMatchResultRemote: reportMatchResultRemote,
    subscribeTournament: subscribeTournament,
    pushSupported: pushSupported,
    enablePush: enablePush,
    disablePush: disablePush,
    identifyCards: identifyCards,
    reviewScanQuantity: reviewScanQuantity,
    logScanAddEvent: logScanAddEvent
  };
})();
