/* Japanese Progress Tracker — view and wiring.
 *
 * Plain script (no modules, no build step), matching the rest of the site.
 * Load order in index.html is `wanikani -> script`; only this file touches the
 * DOM and only wanikani.js talks to the API.
 *
 * Bump TRACKER_VERSION together with the ?v= query on the stylesheet and both
 * scripts in index.html on each release.
 */

const TRACKER_VERSION = '0.1.1';

const tracker = {
  init() {
    this.el = {
      setup:    document.getElementById('setup'),
      tokenIn:  document.getElementById('token'),
      save:     document.getElementById('save'),
      panel:    document.getElementById('panel'),
      status:   document.getElementById('status'),
      refresh:  document.getElementById('refresh'),
      forget:   document.getElementById('forget'),
      who:      document.getElementById('who'),
      level:    document.getElementById('level'),
      plan:     document.getElementById('plan'),
      levelBar: document.getElementById('level-bar'),
      levelNote:document.getElementById('level-note'),
      queue:    document.getElementById('queue'),
      stages:   document.getElementById('stages'),
      board:    document.getElementById('board'),
    };

    this.el.save.addEventListener('click', () => {
      const value = this.el.tokenIn.value.trim();
      if (!value) return;
      wanikani.setToken(value);
      this.el.tokenIn.value = '';
      this.load();
    });

    this.el.tokenIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.el.save.click();
    });

    this.el.refresh.addEventListener('click', () => this.load());

    this.el.forget.addEventListener('click', () => {
      wanikani.forget();
      this.showSetup();
    });

    if (wanikani.token()) this.load();
    else this.showSetup();
  },

  showSetup() {
    this.el.setup.hidden = false;
    this.el.panel.hidden = true;
  },

  setStatus(text, isError) {
    this.el.status.textContent = text || '';
    this.el.status.classList.toggle('error', !!isError);
  },

  async load() {
    this.el.setup.hidden = true;
    this.el.panel.hidden = false;
    this.el.forget.hidden = wanikani.tokenIsLocal();
    this.setStatus('Contacting WaniKani…');

    try {
      // /user and /summary are one request each; the assignment sync is the
      // expensive one, and only on a cold cache.
      const [user, summary] = await Promise.all([wanikani.user(), wanikani.summary()]);
      this.renderUser(user);
      this.renderQueue(summary);

      const rows = await wanikani.syncAssignments((got, total) => {
        this.setStatus('Syncing assignments… ' + got + (total ? ' / ' + total : ''));
      });
      this.renderStages(wanikani.summarize(rows));

      // WaniKani serves assignments only up to max_level_granted — 3 on the
      // free plan — so an account that reached level 7 and then lapsed returns
      // nothing at all for levels 4+. Measure the highest level actually
      // served, or the level-up bar sits empty forever with no explanation.
      const kanji = await wanikani.levelKanji(wanikani.servedLevel(user));
      this.renderLevelProgress(wanikani.servedLevel(user), kanji);

      this.setStatus('Updated ' + new Date().toLocaleTimeString() + '.');
    } catch (err) {
      this.setStatus(err.message || String(err), true);
    }
  },

  renderUser(user) {
    this.el.who.textContent = user.username || '';
    this.el.level.textContent = user.level != null ? 'Level ' + user.level : '';

    const served = wanikani.servedLevel(user);
    if (served < user.level) {
      const sub = user.subscription || {};
      this.el.plan.hidden = false;
      this.el.plan.textContent =
        'Account is at level ' + user.level + ', but the ' + (sub.type || 'free') +
        ' plan only serves content through level ' + served +
        ' — every count below covers levels 1–' + served + ' only.';
    } else {
      this.el.plan.hidden = true;
    }
  },

  renderQueue(summary) {
    const bits = [
      summary.lessons + ' lesson' + (summary.lessons === 1 ? '' : 's'),
      summary.reviews + ' review' + (summary.reviews === 1 ? '' : 's'),
    ];
    if (!summary.reviews && summary.nextReviewAt) {
      bits.push('next at ' + new Date(summary.nextReviewAt).toLocaleString());
    }
    this.el.queue.textContent = bits.join(' · ');
  },

  // The level-up gate: 90% of the current level's kanji at Guru or above.
  renderLevelProgress(level, kanji) {
    const pct = kanji.total ? (kanji.passed / kanji.total) * 100 : 0;
    this.el.levelBar.style.width = pct + '%';
    this.el.levelBar.classList.toggle('ready', pct >= 90);
    this.el.levelNote.textContent =
      kanji.total
        ? kanji.passed + ' / ' + kanji.total + ' level ' + level +
          ' kanji at Guru (90% to level up)'
        : 'No kanji assignments at this level yet.';
  },

  renderStages(stats) {
    this.el.stages.innerHTML = '';
    for (const stage of wanikani.STAGES) {
      const n = stats.stages[stage.key] || 0;
      const chip = document.createElement('div');
      chip.className = 'chip ' + stage.key;
      chip.innerHTML = '<span class="chip-n"></span><span class="chip-k"></span>';
      chip.querySelector('.chip-n').textContent = n;
      chip.querySelector('.chip-k').textContent = stage.name;
      this.el.stages.appendChild(chip);
    }

    this.el.board.innerHTML = '';
    const labels = {
      radical: ['Radicals', '部首'],
      kanji: ['Kanji', '漢字'],
      vocabulary: ['Vocabulary', '単語'],
      kana_vocabulary: ['Kana Vocabulary', 'かな単語'],
    };

    for (const type of wanikani.TYPES) {
      const t = stats.types[type];
      if (!t || !t.total) continue; // kana_vocabulary is empty on older accounts

      const pct = (t.passed / t.total) * 100;
      const card = document.createElement('div');
      card.className = 'track';
      card.innerHTML =
        '<h2></h2><div class="jp"></div>' +
        '<div class="bar"><div class="bar-fill"></div></div>' +
        '<div class="count"></div>';

      card.querySelector('h2').textContent = labels[type][0];
      card.querySelector('.jp').textContent = labels[type][1];
      card.querySelector('.bar-fill').style.width = pct + '%';
      card.querySelector('.count').textContent =
        t.passed + ' / ' + t.total + ' passed (' + Math.round(pct) + '%) · ' +
        t.burned + ' burned';

      this.el.board.appendChild(card);
    }
  },
};

tracker.init();
