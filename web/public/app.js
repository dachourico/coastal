const $ = selector => document.querySelector(selector);
const worker = new Worker('worker.js', {type: 'module'});
let sequence = 0, state, selected, editing, busy = false;
const pending = new Map();
const scanning = new ScanPage();
window.addEventListener('coastal-restore', event => run('restore',{content:JSON.stringify(event.detail)},'Saved move history restored.'));
const status = (message, error = false) => { $('#status').textContent = message; $('#status').className = error ? 'error' : ''; };
worker.onmessage = ({data}) => { const task = pending.get(data.id); if (!task) return; pending.delete(data.id); data.error ? task.reject(new Error(data.error)) : task.resolve(data.result); };
worker.onerror = () => { for (const task of pending.values()) task.reject(new Error('Could not start Coastal. Check your connection and reload.')); pending.clear(); };
function call(request) { return new Promise((resolve,reject) => { const id = ++sequence; pending.set(id,{resolve,reject}); worker.postMessage({id,request}); }); }
function download(result) { const url = URL.createObjectURL(new Blob([result.content],{type:result.filename.endsWith('.json')?'application/json':'text/csv;charset=utf-8'})); const a = document.createElement('a'); a.href=url; a.download=result.filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function color(id) { return `hsl(${(id*67+35)%360} 55% 75%)`; }
function el(tag,text,className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; }
async function run(action, data={}, message='Updated.') {
  if(busy)return;
  busy=true; $('#application').disabled=true;
  try {
    const result=await call({action,...data});
    if(result.filename) download(result); else {state=result;scanning.sync(state,['room','restore','design','clear_all'].includes(action));render(false);}
    if(!['generate','save','export'].includes(action)) {
      try { localStorage.setItem('coastal-strains',JSON.stringify(state.strains)); localStorage.setItem('coastal-rooms',JSON.stringify(state.rooms)); }
      catch { status('Updated, but room designs and strains could not be saved in this browser.',true); return; }
    }
    status(message);
  } catch(error) {status(error.message,true);} finally {busy=false;$('#application').disabled=false;}
}
function abbreviation(strain) { return (state.strains[strain] || strain.slice(0,4)).toUpperCase(); }
function render(syncScanning = true) {
  if(syncScanning) scanning.sync(state);
  $('#room').replaceChildren(...state.rooms.map(room=>{const option=el('option',room.name);option.value=room.name;return option;}));$('#room').value=state.room.name;
  $('#strains').replaceChildren(...Object.keys(state.strains).sort().map(name=>{const option=el('option');option.value=name;return option;}));
  if(!state.batches.some(b=>b.id===selected))selected=state.batches[0]?.id;
  $('#batches').replaceChildren(...state.batches.map(batch=>{
    const card=el('div',undefined,'batch'+(selected===batch.id?' selected':''));card.style.setProperty('--batch',color(batch.id));card.draggable=true;card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',`${batch.strain}, ${batch.remaining} unplaced`);
    card.append(el('strong',`${abbreviation(batch.strain)} · ${batch.strain}`),el('small',`${batch.remaining} unplaced / ${batch.count} plants`));
    card.onclick=()=>{selected=batch.id;render();};card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selected=batch.id;render();}};
    card.ondragstart=e=>{selected=batch.id;e.dataTransfer.setData('text/plain',String(batch.id));};
    const remove=el('button','Remove');remove.onclick=e=>{e.stopPropagation();if(confirm(`Remove ${batch.strain} and its placements?`))run('remove',{batch:batch.id});};card.append(remove);return card;
  }));
  $('#summary').textContent=`${state.placed} / ${state.capacity} positions filled`;
  $('#room-view').replaceChildren();
  for(const [level,racks] of Object.entries(state.room.levels)) {
    $('#room-view').append(el('h3',`LEVEL ${level}`,'level-title'));
    const grid=el('div',undefined,'racks');grid.style.setProperty('--rack-count',Object.keys(racks).length);
    for(const [rack,tables] of Object.entries(racks)) {
      const column=el('div',undefined,'rack');column.append(el('p',`RACK ${rack}`));
      const positions=Math.max(...tables.map(t=>Math.ceil((t.plant_count??t.rows*t.plants_per_row)/t.rows)));
      const labelLength=Math.max(3,...state.batches.map(b=>abbreviation(b.strain).length));
      column.style.minWidth=`${Math.max(130,positions*(Math.max(32,labelLength*8+8)+3)+16)}px`;
      for(const table of tables){
        const prefix=`L${level}|R${rack}|${table.label}|`;const card=el('div',undefined,'table');card.tabIndex=0;card.setAttribute('aria-label',`Place batch on level ${level}, rack ${rack}, ${table.label}`);
        const place=()=>{if(selected)run('place',{batch:selected,prefix},'Batch placed in available positions.');else status('Add a plant batch first.',true);};card.onclick=place;card.onkeydown=e=>{if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();place();}};
        card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();const batch=Number(e.dataTransfer.getData('text/plain'));if(batch)run('place',{batch,prefix});};
        const top=el('div',undefined,'table-top');top.append(el('span',table.label));const edit=el('button','Edit');edit.onclick=e=>{e.stopPropagation();editing={level,rack,label:table.label};$('#resize-form').elements.rows.value=table.rows;$('#resize-form').elements.capacity.value=table.plant_count??table.rows*table.plants_per_row;$('#resize-dialog').showModal();};top.append(edit);card.append(top);
        const capacity=table.plant_count??table.rows*table.plants_per_row;
        for(let row=1;row<=table.rows;row++) {
          const line=el('div',undefined,'plant-row');const count=Math.floor(capacity/table.rows)+(row<=capacity%table.rows?1:0);
          for(let position=1;position<=count;position++) {
            const slot=`${prefix}row${row}|plant${position}`, batchId=state.assignments[slot];const batch=state.batches.find(b=>b.id===batchId);const dot=el('button',batch?abbreviation(batch.strain):'·','plant'+(batch?' occupied':''));dot.style.setProperty('--batch',color(batchId));dot.title=`Level ${level}, rack ${rack}, ${table.label}, row ${row}, position ${position}: ${batch?`${batch.strain} (batch ${batchId}); click to remove`:'empty'}`;dot.setAttribute('aria-label',dot.title);dot.onclick=e=>{if(batchId){e.stopPropagation();run('clear_slot',{slot});}};line.append(dot);
          }card.append(line);
        }column.append(card);
      }grid.append(column);
    }$('#room-view').append(grid);
  }
}
function showTab(name) {
  scanning.pause(); scanning.render();
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==name);
}
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{
  showTab(button.dataset.tab);
  const url=new URL(location.href);
  if(button.dataset.tab==='planner') url.searchParams.delete('tab');
  else url.searchParams.set('tab',button.dataset.tab);
  history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);
};
const startTab=new URLSearchParams(location.search).get('tab');
if(startTab==='clone'||startTab==='harvest'||startTab==='scanning') showTab(startTab);
const today=new Date(); const localDate=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;document.querySelectorAll('input[type=date]').forEach(input=>input.value=localDate);
$('#batch-form').onsubmit=e=>{e.preventDefault();run('add',{strain:$('#strain').value,count:Number($('#count').value)},'Batch added. Select a table to place it.');};
$('#room').onchange=async()=>{const name=$('#room').value;if(state.batches.length&&!confirm('Start an empty layout in this room? Save your current layout first if you need it later.')){$('#room').value=state.room.name;return;}await run('room',{name});};
for(const action of ['save','export','autofill','split','clear'])$('#'+action).onclick=()=>{if(action==='clear'&&!confirm('Return all placed plants to their batches?'))return;run(action,{},['save','export'].includes(action)?'File downloaded.':'Layout updated.');};
$('#clear-all').onclick=()=>{if(confirm('Remove all batches and placements? Your room design will be kept.'))run('clear_all',{},'All batches and placements cleared.');};
async function readFile(input,task){const file=input.files[0];if(!file)return;try{if(file.size>20*1024*1024)throw new Error('Choose a file smaller than 20 MB.');await task(file);}catch(error){status(error.message,true);}finally{input.value='';}}
$('#layout-file').onchange=e=>readFile(e.target,async file=>{if(state.batches.length&&!confirm('Replace your current layout with this file?'))return;await run('restore',{content:await file.text()},'Layout opened.');});
$('#inventory-file').onchange=e=>readFile(e.target,async file=>{status('Reading inventory…');await run('import',{filename:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))},'Inventory added to your batches.');});
for(const kind of ['clone','harvest'])$('#'+kind+'-form').onsubmit=async e=>{e.preventDefault();const form=e.target;try{const source=form.elements.input.files[0],inventory=form.elements.inventory?.files[0];if(source.size>20*1024*1024||inventory?.size>20*1024*1024)throw new Error('Choose files smaller than 20 MB.');await run('generate',{kind,name:form.elements.name.value,date:form.elements.date.value,input:await source.text(),inventory:inventory?await inventory.text():''},'Your CSV is ready and has been downloaded.');}catch(error){status(error.message,true);}};
for(const name of ['design','strain'])$('#'+name+'-open').onclick=()=>$('#'+name+'-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#resize-form').onsubmit=e=>{e.preventDefault();const f=e.target.elements;$('#resize-dialog').close();run('resize',{...editing,rows:Number(f.rows.value),capacity:Number(f.capacity.value)});};
$('#strain-form').onsubmit=e=>{e.preventDefault();const f=e.target.elements;$('#strain-dialog').close();run('strain',{name:f.name.value,abbreviation:f.abbreviation.value},'Strain saved to this browser’s catalog.');};
$('#design-form').onsubmit=e=>{e.preventDefault();if(state.batches.length&&!confirm('Start a new empty room? Download your current layout first if you need it later.'))return;const f=e.target.elements;const spec={name:f.name.value,levels:{}};for(let l=1;l<=Number(f.levels.value);l++){spec.levels[l]={};for(let r=1;r<=Number(f.racks.value);r++)spec.levels[l][r]=Array.from({length:Number(f.tables.value)},(_,i)=>({label:`Table ${i+1}`,rows:Number(f.rows.value),plants_per_row:Math.ceil(Number(f.capacity.value)/Number(f.rows.value)),plant_count:Number(f.capacity.value)}));}$('#design-dialog').close();run('design',{spec},'Room created.');};
(async()=>{try{state=await call({action:'state'});try{localStorage.removeItem('coastal-layout');const initialRoom=state.room.name;for(const room of JSON.parse(localStorage.getItem('coastal-rooms')||'[]'))await call({action:'design',spec:room});for(const [name,abbreviation] of Object.entries(JSON.parse(localStorage.getItem('coastal-strains')||'{}')))if(!state.strains[name])await call({action:'strain',name,abbreviation});state=await call({action:'room',name:initialRoom});status('Ready.');}catch(error){state=await call({action:'state'});status(`Could not load saved room designs or strains: ${error.message}. Open a saved layout or start a new one.`,true);}render();$('#application').disabled=false;}catch(error){status(error.message,true);}})();
