/* Japanese Progress Tracker — scaffold.
 *
 * Plain script (no modules, no build step), matching the rest of the site.
 * Bump TRACKER_VERSION together with the ?v= query on the stylesheet and this
 * script in index.html on each release.
 *
 * What exists so far: the shape of the data and a render pass that draws one
 * card per section. Nothing records progress yet — `done` is hardcoded to 0 and
 * there is no persistence. The real tracking rules are still to be decided.
 */

const TRACKER_VERSION = '0.0.1';

const tracker = {
  // Placeholder curriculum. Totals are the obvious counts for kana; the rest
  // are guesses standing in until the actual syllabus is settled.
  SECTIONS: [
    { id: 'hiragana', name: 'Hiragana', jp: 'ひらがな', total: 46 },
    { id: 'katakana', name: 'Katakana', jp: 'カタカナ', total: 46 },
    { id: 'kanji',    name: 'Kanji',    jp: '漢字',     total: 80 },
    { id: 'vocab',    name: 'Vocabulary', jp: '単語',   total: 100 },
    { id: 'grammar',  name: 'Grammar',  jp: '文法',     total: 30 },
  ],

  // section id -> number completed. Empty until persistence is added.
  progress: {},

  init() {
    this.board = document.getElementById('board');
    this.render();
  },

  done(section) {
    return this.progress[section.id] || 0;
  },

  render() {
    this.board.innerHTML = '';
    for (const section of this.SECTIONS) {
      const done = this.done(section);
      const pct = section.total ? (done / section.total) * 100 : 0;

      const card = document.createElement('div');
      card.className = 'track';
      card.innerHTML =
        '<h2></h2><div class="jp"></div>' +
        '<div class="bar"><div class="bar-fill"></div></div>' +
        '<div class="count"></div>';

      card.querySelector('h2').textContent = section.name;
      card.querySelector('.jp').textContent = section.jp;
      card.querySelector('.bar-fill').style.width = pct + '%';
      card.querySelector('.count').textContent =
        done + ' / ' + section.total + ' (' + Math.round(pct) + '%)';

      this.board.appendChild(card);
    }
  },
};

tracker.init();
