/* Live counters are session-only; move records are saved separately for CSV export. */
class ScanPage {
  constructor() {
    this.sessions = new Map();
    this.batch = null;
    this.active = false;
    this.audio = null;
    this.completionAudio = new Audio('audio/batch-completed.mp3');
    this.completionAudio.preload = 'auto';
    this.records = [];
    // One stable append-only log means a refresh or offline reload sees the same records.
    this.recordKey = 'coastal-move-records-v1';
    this.saveKey = 'coastal-move-saves-v1';
    this.saves = [];
    this.storageError = false;
    this.loadRecords();
    this.loadSaves();
    navigator.storage?.persist?.().catch(() => {});
    const get = id => document.getElementById(id);
    this.get = get;
    get('scan-start').onclick = () => {
      this.active = !this.active;
      if(this.active) {
        try { this.audio ||= new AudioContext(); this.audio.resume().catch(()=>{}); } catch {}
      }
      this.render();
      if(this.active) get('scan-tag').focus();
    };
    get('scan-form').onsubmit = event => { event.preventDefault(); this.accept(get('scan-tag').value); get('scan-tag').value = ''; };
    get('scan-add').onclick = () => this.accept(null, true);
    get('scan-undo').onclick = () => {
      const session = this.sessions.get(this.batch), count = Number(get('scan-undo-count').value);
      if(!session || !Number.isInteger(count) || count < 1 || count > session.scans.length) return this.message('Enter an undo count between 1 and the recorded count.');
      const removed = new Set(session.scans.splice(-count).map(entry => entry.id));
      this.records = this.records.filter(entry => !removed.has(entry.id));
      this.saveRecords(); this.pause(); this.render(); this.message(`Removed ${count} most recent entries. Press Start scanning to continue.`);
    };
    get('scan-export').onclick = () => this.exportRecords();
    get('scan-save').onclick = () => this.saveMove();
    get('scan-test').onclick = () => this.beep();
    get('scan-completed-close').onclick = () => get('scan-completed').close();
    get('scan-completed').onclose = () => {
      cancelAnimationFrame(this.confettiFrame);
      get('scan-confetti').getContext('2d')?.clearRect(0, 0, get('scan-confetti').width, get('scan-confetti').height);
      get('scan-batches').querySelector('[aria-pressed=true]')?.focus();
    };
  }
  message(text) { this.get('scan-message').textContent = text; }
  loadSaves() {
    try { const saved = JSON.parse(localStorage.getItem(this.saveKey) || '[]'); this.saves = Array.isArray(saved) ? saved : []; }
    catch { this.saves = []; this.storageError = true; }
  }
  saveMove() {
    const name = prompt('Name this room move history:', `${this.room} move ${new Date().toLocaleDateString()}`)?.trim();
    if(!name) return;
    const state = this.layoutState;
    if(!state) return this.message('The layout is still loading. Try again in a moment.');
    const snapshot = {id:crypto.randomUUID(), name, savedAt:new Date().toISOString(), room:state.room.name,
      layout:{room_spec:state.room,batches:state.batches,assignments:state.assignments},
      records:this.records.filter(entry=>entry.room === state.room.name)};
    this.saves = [snapshot, ...this.saves.filter(save=>save.id !== snapshot.id)];
    try { localStorage.setItem(this.saveKey, JSON.stringify(this.saves)); this.message(`Saved “${name}”.`); }
    catch { this.storageError = true; this.message('Could not save this history. Download the move CSV now.'); }
    this.renderSaves();
  }
  restoreMove(id) {
    const save = this.saves.find(item=>item.id === id); if(!save) return;
    if(!confirm(`Restore “${save.name}”? The current layout will be replaced.`)) return;
    this.records = [...this.records.filter(entry=>entry.room !== save.room), ...save.records];
    this.saveRecords();
    window.dispatchEvent(new CustomEvent('coastal-restore', {detail:save.layout}));
    this.message(`Restored “${save.name}”.`);
  }
  deleteMove(id) {
    const save = this.saves.find(item=>item.id === id); if(!save || !confirm(`Delete saved history “${save.name}”?`)) return;
    this.saves = this.saves.filter(item=>item.id !== id);
    try { localStorage.setItem(this.saveKey, JSON.stringify(this.saves)); } catch { this.storageError = true; }
    this.renderSaves();
  }
  renderSaves() {
    const list = this.get('scan-saves'); if(!list) return;
    list.replaceChildren(...this.saves.map(save=>{
      const item=document.createElement('li'); item.className='scan-save-item';
      const label=document.createElement('span'); label.textContent=`${save.name} · ${new Date(save.savedAt).toLocaleString()} · ${save.records.length} tags`;
      const restore=document.createElement('button'); restore.type='button'; restore.textContent='Restore'; restore.onclick=()=>this.restoreMove(save.id);
      const remove=document.createElement('button'); remove.type='button'; remove.textContent='Delete'; remove.onclick=()=>this.deleteMove(save.id);
      item.append(label,restore,remove); return item;
    }));
  }
  pause() { this.active = false; this.get('scan-tag').value = ''; }
  sync(state, reset = false) {
    if(reset) { this.sessions.clear(); this.pause(); }
    this.room = state.room.name;
    this.layoutState = state;
    const next = new Map(); let changed = false;
    for(const batch of state.batches) {
      const slots = Object.keys(state.assignments).filter(slot => state.assignments[slot] === batch.id).sort();
      if(!slots.length) continue;
      const signature = JSON.stringify([this.room, batch.strain, slots]);
      const prior = this.sessions.get(batch.id);
      if(prior && prior.signature !== signature && prior.scans.length) changed = true;
      next.set(batch.id, prior?.signature === signature ? prior : {...batch, signature, target: slots.length, scans: [], moveBatch: crypto.randomUUID()});
    }
    this.sessions = next;
    if(!next.has(this.batch)) { this.batch = next.keys().next().value; this.pause(); }
    if(changed) { this.pause(); this.message('Placements changed. Affected batches have been reset; review their new targets.'); }
    else if(reset) this.message('New layout: scan counts start at zero.');
    const buttons = this.get('scan-batches');
    buttons.replaceChildren(...Array.from(next.values(), batch => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'scan-batch'; button.dataset.batch = batch.id;
      button.style.setProperty('--batch', color(batch.id));
      button.title = `${batch.strain} · Batch ${batch.id}`;
      button.onclick = () => {
        if(this.batch !== batch.id) {
          this.pause(); this.batch = batch.id;
          this.message('Batch selected. Press Start scanning to continue.');
          this.render();
        }
      };
      return button;
    }));
    this.render();
    this.renderSaves();
  }
  render() {
    for(const button of this.get('scan-batches').children) {
      const batch = this.sessions.get(Number(button.dataset.batch));
      const selected = batch.id === this.batch;
      const complete = batch.scans.length === batch.target;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${batch.strain}, batch ${batch.id}, ${batch.scans.length} of ${batch.target} scanned${complete ? ', satisfied' : ''}`);
      button.textContent = `${abbreviation(batch.strain)} ${batch.scans.length}/${batch.target}`;
    }
    this.renderRecordStatus();
    const session = this.sessions.get(this.batch), count = session?.scans.length || 0;
    const complete = !!session && count === session.target;
    this.get('scan-room').textContent = this.room || '';
    this.get('scan-progress').textContent = session ? `${count} / ${session.target} plants${complete ? ' — Batch satisfied' : ` · ${session.target-count} remaining`}` : 'Place plants in Room layouts to create scanning targets.';
    this.get('scan-meter').max = session?.target || 1; this.get('scan-meter').value = count;
    this.get('scan-start').disabled = !session || complete;
    this.get('scan-start').textContent = this.active ? 'Pause scanning' : 'Start scanning';
    this.get('scan-tag').disabled = !this.active || complete;
    this.get('scan-submit').disabled = !this.active || complete;
    this.get('scan-add').disabled = !session || complete;
    this.get('scan-undo').disabled = !count;
    this.get('scan-undo-count').max = Math.max(1,count);
    this.get('scan-history').replaceChildren(...(session?.scans || []).slice(-50).reverse().map((entry,i) => {
      const li = document.createElement('li'); li.textContent = `${count-i}. ${entry.tag === null ? 'Manual addition' : entry.tag}`; return li;
    }));
  }
  accept(value, manual = false) {
    if(this.get('scanning').hidden || this.get('application').disabled) return;
    const session = this.sessions.get(this.batch);
    if(!session || (!manual && !this.active)) return;
    const tag = manual ? null : value.trim();
    if(!manual && !tag) return;
    if(session.scans.length >= session.target) return;
    // Count scan events, including repeated barcodes, as requested. No tag validation is implied.
    const entry = {id:crypto.randomUUID(), moveBatch:session.moveBatch, room:this.room,
      batch:session.id, strain:session.strain, abbreviation:abbreviation(session.strain),
      target:session.target, tag, recordedAt:new Date().toISOString()};
    session.scans.push(entry);
    this.records.push(entry);
    this.saveRecords();
    const complete = session.scans.length === session.target;
    if(complete) { this.pause(); void this.beep(); this.celebrate(session); }
    this.render(); this.message(complete ? 'Batch satisfied. Select another batch, or undo entries to correct this batch.' : manual ? 'Added one plant manually.' : `Recorded ${tag}`);
  }
  saveRecords() {
    try {
      localStorage.setItem(this.recordKey, JSON.stringify(this.records));
      this.storageError = false;
    } catch { this.storageError = true; }
  }
  loadRecords() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.recordKey) || '[]');
      if(Array.isArray(saved)) this.records = saved;
      // Migrate logs created by earlier versions without losing their entries.
      for(let i=0;i<localStorage.length;i++) {
        const key = localStorage.key(i);
        if(!key?.startsWith('coastal-move-records-') || key === this.recordKey) continue;
        const old = JSON.parse(localStorage.getItem(key) || '[]');
        if(Array.isArray(old)) this.records.push(...old);
      }
      const unique = new Map(this.records.map(entry => [entry.id, entry]));
      this.records = [...unique.values()];
      this.saveRecords();
    } catch { this.storageError = true; }
  }
  allRecords() {
    const records = [];
    this.historyError = false;
    try {
      records.push(...this.records);
    } catch { this.historyError = true; }
    return records.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt));
  }
  renderRecordStatus() {
    const records = this.allRecords();
    this.get('scan-export').disabled = !records.length;
    this.get('scan-record-status').textContent = this.storageError
      ? 'Browser storage is unavailable or full. Download the CSV now to keep this page’s records.'
      : this.historyError ? 'Some saved records could not be read. Export includes only readable records and this page’s scans.'
      : `${records.length} move entries saved in this browser (${records.filter(entry=>entry.tag === null).length} manual additions without tags). Download a CSV for a permanent copy.`;
  }
  exportRecords() {
    const records = this.allRecords();
    if(!records.length) return;
    const rows = [['Record ID','Move batch ID','Recorded at (UTC)','Destination room','Batch ID','Strain','Abbreviation','Placed target','Entry type','Plant tag'],
      ...records.map(entry=>[entry.id,entry.moveBatch,entry.recordedAt,entry.room,entry.batch,entry.strain,entry.abbreviation,entry.target,entry.tag === null ? 'Manual addition - no tag' : 'Scanned',entry.tag ?? ''])];
    // Preserve tag strings exactly; import as text in Sheets to avoid conversion.
    const content = '\uFEFF' + rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
    download({filename:`coastal-room-moves-${new Date().toISOString().slice(0,10)}.csv`,content});
    this.renderRecordStatus();
    this.message('Move records downloaded. Import as text in Google Sheets to preserve plant tags. Repeated exports include previously downloaded records.');
  }
  celebrate(session) {
    this.get('scan-completed-detail').textContent = `${session.strain} · ${session.scans.length}/${session.target} plants · ${this.room}`;
    this.get('scan-completed').showModal();
    if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = this.get('scan-confetti'), ctx = canvas.getContext('2d');
    if(!ctx) return;
    const width = innerWidth, height = innerHeight;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * scale; canvas.height = height * scale;
    ctx.scale(scale, scale);
    const colors = ['#ffcf33', '#ff5da2', '#49f3b0', '#65d9ff', '#b590ff', '#ffffff'];
    const particles = Array.from({length:220}, (_, i) => {
      const left = i % 2 === 0;
      return {x:left ? 0 : width, y:height*0.75, vx:(left ? 1 : -1)*(3+Math.random()*12), vy:-10-Math.random()*15,
        size:5+Math.random()*8, angle:Math.random()*Math.PI, spin:(Math.random()-0.5)*0.3, color:colors[i%colors.length]};
    });
    let start, previous;
    const frame = now => {
      start ??= now; previous ??= now;
      const step = Math.min((now-previous)/16.67, 2); previous = now;
      ctx.clearRect(0,0,width,height);
      ctx.globalAlpha = Math.min(1, (4200-(now-start))/800);
      for(const p of particles) {
        p.x += p.vx*step; p.y += p.vy*step; p.vy += 0.23*step; p.angle += p.spin*step;
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.angle); ctx.fillStyle=p.color;
        ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.55); ctx.restore();
      }
      if(now-start < 4200 && this.get('scan-completed').open) this.confettiFrame=requestAnimationFrame(frame);
      else ctx.clearRect(0,0,width,height);
    };
    cancelAnimationFrame(this.confettiFrame);
    this.confettiFrame = requestAnimationFrame(frame);
  }
  async beep() {
    try {
      this.completionAudio.currentTime = 0;
      await this.completionAudio.play();
      this.get('scan-sound-status').textContent = 'The completion song is playing on this computer. Keep its volume on.';
    } catch {
      this.get('scan-sound-status').textContent = 'Sound unavailable. Check browser sound settings and use Test completion sound. The batch completion message still appears.';
    }
  }
}
