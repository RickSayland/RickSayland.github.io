import { fmtTime, setNotation } from '../core/format';
import { clearStorage, decodeSave, encodeSave } from '../save/save';
import { el, on, qs, setAttr, setClass, setText } from './dom';
import { icon } from './icons';
import type { Notation } from '../core/format';
import type { UiCtx, View } from './ctx';

/**
 * The app owns the game state; this view only ever asks for it to be swapped.
 * Both events are dispatched on `window` and carry no expectation of a reply.
 */
const LOAD_EVENT = 'its:loadstate';
const NEW_GAME_EVENT = 'its:newgame';

const NOTATIONS: { id: Notation; label: string; hint: string }[] = [
  { id: 'scientific', label: 'Scientific', hint: '1.24e9' },
  { id: 'engineering', label: 'Engineering', hint: '1.24e9, exponents in threes' },
  { id: 'standard', label: 'Standard', hint: '1.24B' },
];

/** Autosave intervals offered. 0 is Off, and is offered because some players want it. */
const AUTOSAVE: { sec: number; label: string }[] = [
  { sec: 10, label: 'Every 10 seconds' },
  { sec: 20, label: 'Every 20 seconds' },
  { sec: 60, label: 'Every 60 seconds' },
  { sec: 0, label: 'Off — save by hand' },
];

let notationBtns: { id: Notation; btn: HTMLButtonElement }[] = [];
let motionBox: HTMLInputElement;
let confirmBox: HTMLInputElement;
let autosaveSel: HTMLSelectElement;
let offlineLine: HTMLElement;

// ----------------------------------------------------------------- markup ---

const HEAD = `
<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('settings', 18)} Display</h2>
  </div>
  <div class="panel-body">
    <div class="toolbar">
      <div class="field">
        <span id="seNotationLabel">Number notation</span>
        <div class="seg" role="group" aria-labelledby="seNotationLabel" id="seNotation"></div>
      </div>
      <div class="field">
        <label for="seAutosave">Autosave interval</label>
        <select id="seAutosave"></select>
      </div>
    </div>
    <div class="field">
      <label for="seMotion">
        <input type="checkbox" id="seMotion">
        Reduce motion in the interface
      </label>
      <span class="hint">
        Trims transitions and animated readouts. Your operating system's own reduce-motion setting is
        honoured whether or not this is ticked; this forces it on regardless of what the system says.
      </span>
    </div>
    <div class="field">
      <label for="seConfirm">
        <input type="checkbox" id="seConfirm">
        Confirm before filing a Recharter
      </label>
      <span class="hint">
        A Recharter is irreversible and resets the charter. With this off, the button on the Stats tab
        files immediately.
      </span>
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('save', 18)} Save data</h2>
  </div>
  <div class="panel-body">
    <div class="toolbar">
      <button type="button" class="btn btn-primary" id="seSave">Save now</button>
      <button type="button" class="btn" id="seExport">Export save to a text blob</button>
      <button type="button" class="btn" id="seImport">Import save from a text blob</button>
      <button type="button" class="btn btn-danger" id="seReset">Hard reset — erase everything</button>
    </div>
    <p class="hint" id="seOffline"></p>
    <p class="panel-note">
      The save lives in this browser's local storage and nowhere else. Clearing site data, a private
      window, or a different browser is a different filing cabinet. Export produces a blob of text you
      copy somewhere safe; there is no file download and no account to fall back on.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('info', 18)} Keyboard</h2>
  </div>
  <div class="panel-body">
    <div class="kv">
      <div class="kv-row"><div class="kv-k"><kbd>1</kbd> – <kbd>7</kbd></div>
        <div class="kv-v">Switch views, in the order the tabs are listed.</div></div>
      <div class="kv-row"><div class="kv-k"><kbd>S</kbd></div>
        <div class="kv-v">Save now.</div></div>
      <div class="kv-row"><div class="kv-k"><kbd>?</kbd></div>
        <div class="kv-v">Show this list.</div></div>
    </div>
    <p class="panel-note">
      Shortcuts are ignored while a text field has focus, so typing a search term never files anything.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('institution', 18)} About</h2>
  </div>
  <div class="panel-body">
    <p>
      <strong>Intergalactic Traffic Simulator.</strong> You are a route authority. You do not own a ship,
      a cargo or a world; you license the movement between them, and take a percentage for the trouble of
      keeping the lanes straight. The numbers on every panel are derived from the rocket equation, real
      orbital geometry and real stellar distances, which is why an engine upgrade transforms one charter
      and does nothing whatever to the one beside it.
    </p>
    <p class="panel-note">
      This is a client-only simulation. It makes no network calls, has no accounts, no server and no
      telemetry; every number in it is computed in this tab and stored in this browser. Nothing you do
      here is filed anywhere else, which is both the privacy policy and the backup policy.
    </p>
  </div>
</div>`;

// ---------------------------------------------------------------- actions ---

function doExport(ctx: UiCtx): void {
  const blob = encodeSave(ctx.sim.state);
  const body = el('div');
  const p = el('p', 'hint',
    'Copy the whole blob and keep it somewhere you trust. It is the entire charter — routes, hulls, '
    + 'technology, Mandate and all.');
  const ta = el('textarea');
  ta.id = 'seExportText';
  ta.rows = 8;
  ta.readOnly = true;
  ta.spellcheck = false;
  ta.value = blob;
  ta.setAttribute('aria-label', 'Exported save data');
  const label = el('label', '', 'Exported save data');
  label.htmlFor = ta.id;
  body.append(p, label, ta);

  ctx.openModal('Export save', body, [{ label: 'Done', cls: 'btn btn-primary' }]);
  // The textarea is only in the document once the modal has appended it, so the
  // selection has to wait for the current turn to finish.
  setTimeout(() => {
    ta.focus();
    ta.select();
  }, 0);
}

function doImport(ctx: UiCtx): void {
  const body = el('div');
  const p = el('p', 'hint',
    'Paste an exported blob. Raw JSON is accepted too. The current charter is replaced outright, so '
    + 'export it first if you want it back.');
  const ta = el('textarea');
  ta.id = 'seImportText';
  ta.rows = 8;
  ta.spellcheck = false;
  ta.setAttribute('aria-label', 'Save data to import');
  const label = el('label', '', 'Save data to import');
  label.htmlFor = ta.id;
  const err = el('p', 'warn');
  err.hidden = true;
  body.append(p, label, ta, err);

  ctx.openModal('Import save', body, [
    { label: 'Cancel', cls: 'btn' },
    {
      label: 'Import',
      cls: 'btn btn-primary',
      onClick: (): boolean => {
        try {
          const state = decodeSave(ta.value);
          window.dispatchEvent(new CustomEvent(LOAD_EVENT, { detail: state }));
          ctx.toast('Save imported.', 'good');
          return true;
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          setText(err, `Import refused: ${why}.`);
          err.hidden = false;
          ctx.toast(`Import refused: ${why}.`, 'bad');
          // Keep the modal open so the paste is not lost to a stray character.
          return false;
        }
      },
    },
  ]);
  setTimeout(() => ta.focus(), 0);
}

function doReset(ctx: UiCtx): void {
  const s = ctx.sim.state;
  const first = el('div');
  first.append(
    el('p', '', 'A hard reset destroys the stored save and starts a new charter from era 1.'),
  );
  const list = el('ul', 'hint');
  for (const line of [
    `${s.routes.length} charter${s.routes.length === 1 ? '' : 's'} and every hull on strength.`,
    `${s.surveyed.length} surveyed endpoint${s.surveyed.length === 1 ? '' : 's'}.`,
    `${s.tech.length} technolog${s.tech.length === 1 ? 'y' : 'ies'}, and all research banked toward more.`,
    `All Mandate, all Institutions, and ${s.recharters} Recharter${s.recharters === 1 ? '' : 's'} of career record.`,
    'The stored save in this browser. There is no copy anywhere else.',
  ]) list.append(el('li', '', line));
  first.append(list, el('p', 'hint', 'Export first if any of that is worth keeping.'));

  ctx.openModal('Hard reset — step 1 of 2', first, [
    { label: 'Cancel', cls: 'btn' },
    {
      label: 'Continue',
      cls: 'btn btn-danger',
      onClick: (): boolean => {
        // Opened on the next turn so the first modal has finished closing,
        // whatever order the modal host does its teardown in.
        setTimeout(() => confirmReset(ctx), 0);
        return true;
      },
    },
  ]);
}

function confirmReset(ctx: UiCtx): void {
  ctx.openModal(
    'Hard reset — step 2 of 2',
    'This erases the save and cannot be undone. There is no recovery, no server copy and no undo.',
    [
      { label: 'Keep the charter', cls: 'btn' },
      {
        label: 'Erase everything',
        cls: 'btn btn-danger',
        onClick: (): void => {
          clearStorage();
          window.dispatchEvent(new CustomEvent(NEW_GAME_EVENT));
          ctx.toast('Save erased. A new charter has been opened.', 'info');
          ctx.announce('Save erased. A new charter has been opened.');
        },
      },
    ],
  );
}

// ------------------------------------------------------------------ view ----

export const settingsView: View = {
  id: 'settings',
  label: 'Settings',
  icon: 'settings',

  mount(root: HTMLElement, ctx: UiCtx): void {
    root.innerHTML = HEAD;

    // --- notation ----------------------------------------------------------
    const seg = qs(root, '#seNotation');
    notationBtns = NOTATIONS.map((n) => {
      const btn = el('button', 'seg-btn', n.label);
      btn.type = 'button';
      btn.title = n.hint;
      // Read out of context this has to say what it does, not just how it looks.
      btn.setAttribute('aria-label', `Number notation: ${n.label} (${n.hint})`);
      on(btn, 'click', () => {
        ctx.sim.state.settings.notation = n.id;
        setNotation(n.id);
      });
      seg.append(btn);
      return { id: n.id, btn };
    });

    // --- autosave ----------------------------------------------------------
    autosaveSel = qs<HTMLSelectElement>(root, '#seAutosave');
    for (const a of AUTOSAVE) {
      const o = el('option', '', a.label);
      o.value = String(a.sec);
      autosaveSel.append(o);
    }
    on(autosaveSel, 'change', () => {
      ctx.sim.state.settings.autosaveSec = Number(autosaveSel.value);
    });

    // --- checkboxes --------------------------------------------------------
    motionBox = qs<HTMLInputElement>(root, '#seMotion');
    on(motionBox, 'change', () => {
      ctx.sim.state.settings.reducedMotion = motionBox.checked;
    });

    confirmBox = qs<HTMLInputElement>(root, '#seConfirm');
    on(confirmBox, 'change', () => {
      ctx.sim.state.settings.confirmRecharter = confirmBox.checked;
    });

    // --- save data ---------------------------------------------------------
    offlineLine = qs(root, '#seOffline');
    on(qs(root, '#seSave'), 'click', () => {
      ctx.saveNow();
      ctx.toast('Saved.', 'good');
    });
    on(qs(root, '#seExport'), 'click', () => doExport(ctx));
    on(qs(root, '#seImport'), 'click', () => doImport(ctx));
    on(qs(root, '#seReset'), 'click', () => doReset(ctx));

    this.rebuild?.(ctx);
  },

  rebuild(ctx: UiCtx): void {
    // Controls are structural only in the sense that an imported save can move
    // every one of them at once; paint them from state and let update hold them.
    this.update(ctx);
  },

  update(ctx: UiCtx): void {
    const st = ctx.sim.state.settings;

    for (const n of notationBtns) {
      const active = st.notation === n.id;
      setClass(n.btn, 'is-active', active);
      setAttr(n.btn, 'aria-pressed', active ? 'true' : 'false');
    }

    // Assigning an unchanged checkbox value is a no-op, and reading state every
    // frame is what keeps these honest after an import swaps the state out.
    if (motionBox.checked !== st.reducedMotion) motionBox.checked = st.reducedMotion;
    if (confirmBox.checked !== st.confirmRecharter) confirmBox.checked = st.confirmRecharter;
    const want = String(st.autosaveSec ?? 0);
    if (autosaveSel.value !== want) autosaveSel.value = want;

    const capH = ctx.sim.mods.offlineCapH;
    setText(offlineLine,
      `Offline accrual is capped at ${fmtTime(capH * 3600)}. Traffic beyond that is not credited. `
      + 'Continuity of Operations, in Institutions, raises the cap by four hours a level to a ceiling of 72.');
  },
};
