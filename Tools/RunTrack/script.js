(() => {
  const REQUESTED_COUNT = 25;
  const LEGACY_KEY = 'runtrack_segments_v1';

  const segmentsEl = document.getElementById('segments');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const markAllBtn = document.getElementById('markAll');
  const clearAllBtn = document.getElementById('clearAll');

  async function loadSegmentsData(){
    try{
      const res = await fetch('content/segments.json');
      if(!res.ok) throw new Error('fetch failed');
      return await res.json();
    }catch(e){
      return [];
    }
  }

  function migrateState(newKey, count){
    try{
      const legacy = localStorage.getItem(LEGACY_KEY);
      if(!legacy) return null;
      const arr = JSON.parse(legacy);
      if(!Array.isArray(arr)) return null;
      const taken = arr.slice(0, count);
      while(taken.length < count) taken.push(false);
      // convert legacy boolean array into objects {done,miles}
      const objArr = taken.map(v => ({done: Boolean(v), miles: null}));
      localStorage.setItem(newKey, JSON.stringify(objArr));
      return objArr;
    }catch(e){return null}
  }

  function loadState(key, count){
    try{
      const raw = localStorage.getItem(key);
      if(raw){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr) && arr.length === count){
          // normalize to objects {done,miles} but ignore any persisted miles
          return arr.map(item => {
            if(typeof item === 'boolean') return {done: item, miles: null};
            if(item && typeof item === 'object') return {done: Boolean(item.done), miles: null};
            return {done:false,miles:null};
          });
        }
      }
      // try migrating from legacy
      const migrated = migrateState(key, count);
      if(migrated) return migrated;
    }catch(e){}
    return new Array(count).fill(null).map(()=>({done:false,miles:null}));
  }

  function saveState(key, state){
    localStorage.setItem(key, JSON.stringify(state));
  }

  function updateProgress(key, state){
    const done = state.filter(s => s && s.done).length;
    const pct = Math.round((done/state.length)*100);
    progressFill.style.width = pct + '%';
    progressText.textContent = `${done} / ${state.length} segments (${pct}%)`;
  }

  function makeSegment(i, meta, item){
    const wrap = document.createElement('label');
    wrap.className = 'segment';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `seg-${i}`;
    cb.checked = !!(item && item.done);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'meta';

    const label = document.createElement('div');
    label.className = 'label';
    if(meta && meta.url){
      const a = document.createElement('a');
      a.href = meta.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = meta.name;
      label.appendChild(a);
    } else {
      label.textContent = meta ? meta.name : `Segment ${i}`;
    }

    const range = document.createElement('div');
    range.className = 'range';
    const startM = (i-1)*10;
    const endM = i*10;
    // prefer canonical miles from segments.json (meta)
    if(meta && typeof meta.miles === 'number'){
      range.textContent = `${meta.miles} mi`;
    } else if(item && typeof item.miles === 'number'){
      range.textContent = `${item.miles} mi`;
    } else {
      range.textContent = `Miles ${startM}–${endM}`;
    }

    // miles display (read-only)
    const milesWrap = document.createElement('div');
    milesWrap.className = 'miles-edit';
    milesWrap.style.marginLeft = 'auto';
    const milesText = document.createElement('div');
    milesText.className = 'range';
    milesText.style.textAlign = 'right';
    milesText.style.minWidth = '64px';
    milesText.textContent = (meta && typeof meta.miles === 'number') ? `${meta.miles} mi` : ((item && typeof item.miles === 'number') ? `${item.miles} mi` : '—');
    milesWrap.appendChild(milesText);

    metaDiv.appendChild(label);
    metaDiv.appendChild(range);

    wrap.appendChild(cb);
    wrap.appendChild(metaDiv);
    wrap.appendChild(milesWrap);

    return {el: wrap, checkbox: cb};
  }

  async function render(){
    const allMeta = await loadSegmentsData();
    // find Pinellas Trail start; include the previous segment when present
    let startIndex = allMeta.findIndex(s => /pinellas/i.test(s.name));
    if(startIndex < 0) {
      startIndex = 0;
    } else {
      // include the preceding segment (e.g. 1st Avenue South Bikeway)
      startIndex = Math.max(0, startIndex - 1);
    }
    const slice = allMeta.slice(startIndex, startIndex + REQUESTED_COUNT);
    const COUNT = slice.length || REQUESTED_COUNT;
    const STORAGE_KEY = `runtrack_${startIndex}_${COUNT}_v1`;

    const state = loadState(STORAGE_KEY, COUNT);

    segmentsEl.innerHTML = '';
    for(let i=1;i<=COUNT;i++){
      const meta = slice[i-1] || {name: `Segment ${i}`};
      const {el, checkbox} = makeSegment(i, meta, state[i-1]);
      // no inline editing: miles are read-only unless edited externally
      checkbox.addEventListener('change', () => {
        const s = loadState(STORAGE_KEY, COUNT);
        s[i-1] = {done: !!checkbox.checked, miles: null};
        saveState(STORAGE_KEY, s);
        updateProgress(STORAGE_KEY, s);
      });
      segmentsEl.appendChild(el);
    }

    markAllBtn.onclick = () => { const s = loadState(STORAGE_KEY, COUNT).map(()=>({done:true,miles:null})); saveState(STORAGE_KEY, s); render(); };
    clearAllBtn.onclick = () => { const s = loadState(STORAGE_KEY, COUNT).map(()=>({done:false,miles:null})); saveState(STORAGE_KEY, s); render(); };

    updateProgress(STORAGE_KEY, state);
  }

  document.addEventListener('DOMContentLoaded', () => render());
  if(document.readyState === 'interactive' || document.readyState === 'complete') render();

})();
