/* WaniKani API v2 client. No DOM in this file.
 *
 * Docs: https://docs.api.wanikani.com/20170710/
 *
 * The API sets CORS headers ("we've turned on cross-origin resource sharing to
 * allow for secure client-side access"), which is the only reason this page can
 * stay a static file with no backend. Requests need two headers:
 *   Authorization: Bearer <token>
 *   Wanikani-Revision: 20170710
 *
 * THE TOKEN IS NEVER COMMITTED. It is pasted in by the user and lives in
 * localStorage on their machine only. Use a READ-ONLY personal access token
 * from https://www.wanikani.com/settings/personal_access_tokens — this page
 * only ever issues GETs, and a read-only token cannot be used to alter reviews.
 */

const wanikani = {
  BASE: 'https://api.wanikani.com/v2',
  REVISION: '20170710',

  // localStorage keys.
  K_TOKEN: 'wk.token',
  K_ASSIGN: 'wk.assignments',
  K_STAMP: 'wk.updatedAt',

  // Assignment subject_type, stored as an index to keep the cache small — a
  // level-60 account has ~9,000 assignments and all of it goes in localStorage.
  TYPES: ['radical', 'kanji', 'vocabulary', 'kana_vocabulary'],

  // srs_stage -> bucket. 0 is unlocked-but-not-started (a lesson), 9 is burned.
  STAGES: [
    { key: 'lesson',     name: 'Lessons',     min: 0, max: 0 },
    { key: 'apprentice', name: 'Apprentice',  min: 1, max: 4 },
    { key: 'guru',       name: 'Guru',        min: 5, max: 6 },
    { key: 'master',     name: 'Master',      min: 7, max: 7 },
    { key: 'enlightened',name: 'Enlightened', min: 8, max: 8 },
    { key: 'burned',     name: 'Burned',      min: 9, max: 9 },
  ],

  // A subject is "passed" at Guru or above — the same threshold WaniKani uses
  // to decide whether a kanji counts toward levelling up.
  PASSED_STAGE: 5,

  /* ---- token ---- */

  // A browser cannot read OS environment variables, so there is no way for the
  // page to pick up $env:wanikanikey by itself. The escape hatch is an
  // untracked token.local.js that sets window.WK_TOKEN — see README.md. Falls
  // back to whatever the user pasted into the page.
  token() {
    if (typeof window !== 'undefined' && window.WK_TOKEN) return String(window.WK_TOKEN).trim();
    try { return localStorage.getItem(this.K_TOKEN) || ''; } catch (e) { return ''; }
  },

  // True when the token came from token.local.js rather than the paste box, so
  // the view can hide controls that would have no effect.
  tokenIsLocal() {
    return !!(typeof window !== 'undefined' && window.WK_TOKEN);
  },

  setToken(value) {
    try {
      if (value) localStorage.setItem(this.K_TOKEN, value.trim());
      else localStorage.removeItem(this.K_TOKEN);
    } catch (e) { /* private browsing */ }
  },

  forget() {
    this.setToken('');
    try {
      localStorage.removeItem(this.K_ASSIGN);
      localStorage.removeItem(this.K_STAMP);
    } catch (e) { /* ignore */ }
  },

  /* ---- transport ---- */

  async get(path) {
    const url = path.startsWith('http') ? path : this.BASE + path;
    const res = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + this.token(),
        'Wanikani-Revision': this.REVISION,
      },
    });

    if (res.status === 401) throw new Error('Token rejected (401). Check the API token.');
    if (res.status === 429) {
      const reset = Number(res.headers.get('RateLimit-Reset')) || 0;
      const wait = reset ? Math.max(0, Math.ceil(reset - Date.now() / 1000)) : 60;
      throw new Error('Rate limited by WaniKani. Try again in ' + wait + 's.');
    }
    if (!res.ok) throw new Error('WaniKani returned ' + res.status + '.');

    return res.json();
  },

  // Collections are cursor paginated: follow pages.next_url until it is null.
  // The full assignment list is ~19 pages at 500 each for a finished account,
  // comfortably inside the 60 requests/minute limit.
  async getAll(path, onPage) {
    let url = path;
    let all = [];
    let stamp = null;
    while (url) {
      const body = await this.get(url);
      all = all.concat(body.data || []);
      stamp = body.data_updated_at || stamp;
      if (onPage) onPage(all.length, body.total_count || 0);
      url = body.pages && body.pages.next_url;
    }
    return { data: all, data_updated_at: stamp };
  },

  /* ---- assignment cache ----
   * Stored as [subject_id, typeIndex, srs_stage] triples. On every refresh
   * after the first we ask only for `updated_after` the last sync and merge by
   * subject id, so a repeat visit is one request instead of nineteen.
   */

  readCache() {
    try {
      const raw = localStorage.getItem(this.K_ASSIGN);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  writeCache(rows, stamp) {
    try {
      localStorage.setItem(this.K_ASSIGN, JSON.stringify(rows));
      if (stamp) localStorage.setItem(this.K_STAMP, stamp);
    } catch (e) { /* quota or private browsing — we just refetch next time */ }
  },

  stamp() {
    try { return localStorage.getItem(this.K_STAMP) || ''; } catch (e) { return ''; }
  },

  async syncAssignments(onProgress) {
    const cached = this.readCache();
    const since = cached ? this.stamp() : '';
    const path = '/assignments' + (since ? '?updated_after=' + encodeURIComponent(since) : '');

    const body = await this.getAll(path, onProgress);

    const byId = new Map();
    if (cached) for (const row of cached) byId.set(row[0], row);
    for (const a of body.data) {
      const d = a.data || {};
      byId.set(d.subject_id, [
        d.subject_id,
        Math.max(0, this.TYPES.indexOf(d.subject_type)),
        d.srs_stage == null ? 0 : d.srs_stage,
      ]);
    }

    const rows = Array.from(byId.values());
    this.writeCache(rows, body.data_updated_at || new Date().toISOString());
    return rows;
  },

  /* ---- derived numbers ---- */

  bucketOf(srs) {
    for (const s of this.STAGES) if (srs >= s.min && srs <= s.max) return s.key;
    return 'lesson';
  },

  // rows -> { stages: {key: n}, types: {type: {total, passed, burned}}, total }
  summarize(rows) {
    const stages = {};
    for (const s of this.STAGES) stages[s.key] = 0;

    const types = {};
    for (const t of this.TYPES) types[t] = { total: 0, passed: 0, burned: 0 };

    for (const [, typeIdx, srs] of rows) {
      const type = this.TYPES[typeIdx] || 'radical';
      stages[this.bucketOf(srs)]++;
      const bucket = types[type];
      bucket.total++;
      if (srs >= this.PASSED_STAGE) bucket.passed++;
      if (srs >= 9) bucket.burned++;
    }

    return { stages, types, total: rows.length };
  },

  /* ---- endpoints the view uses directly ---- */

  async user() {
    const body = await this.get('/user');
    return body.data || {};
  },

  // The highest level whose assignments the API will actually return. A lapsed
  // or free account keeps its `level` but only gets content through
  // `subscription.max_level_granted` (3 on the free plan), and every query above
  // that comes back with total_count 0 rather than an error — which reads as a
  // bug in the caller if you do not account for it.
  servedLevel(user) {
    const max = user && user.subscription && user.subscription.max_level_granted;
    if (!max) return (user && user.level) || 1;
    return Math.min(user.level || max, max);
  },

  // /summary returns lessons[] and reviews[], each entry an {available_at,
  // subject_ids} slot. Everything already available sits in the first slot,
  // whose available_at is in the past.
  async summary() {
    const body = await this.get('/summary');
    const d = body.data || {};
    const now = Date.now();
    const countReady = (slots) => (slots || []).reduce(
      (n, s) => n + (Date.parse(s.available_at) <= now ? (s.subject_ids || []).length : 0), 0);

    let nextAt = null;
    for (const slot of d.reviews || []) {
      if ((slot.subject_ids || []).length && Date.parse(slot.available_at) > now) {
        nextAt = slot.available_at;
        break;
      }
    }

    return {
      lessons: countReady(d.lessons),
      reviews: countReady(d.reviews),
      nextReviewAt: nextAt,
    };
  },

  // Kanji at the current level are what gate a level-up: 90% of them at Guru.
  async levelKanji(level) {
    const body = await this.getAll(
      '/assignments?subject_types=kanji&levels=' + encodeURIComponent(level));
    let total = 0, passed = 0;
    for (const a of body.data) {
      total++;
      if ((a.data && a.data.srs_stage) >= this.PASSED_STAGE) passed++;
    }
    return { total, passed };
  },
};
