const DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const HOUR_START = 8, HOUR_END = 22;

const PALETTE = [
  {bg:'#1B2C46', accent:'#5B8DEF', text:'#CFE0FF'},
  {bg:'#16302A', accent:'#4CC38A', text:'#C9F0DC'},
  {bg:'#3A2818', accent:'#E08A4C', text:'#FCE0C2'},
  {bg:'#2A2140', accent:'#9B7EDB', text:'#E4D9FA'},
  {bg:'#332B12', accent:'#D9B44A', text:'#F5E7B8'},
  {bg:'#142E2C', accent:'#4FC1B4', text:'#C8F0EA'},
  {bg:'#232838', accent:'#7B85A3', text:'#DCE1EC'},
  {bg:'#341F28', accent:'#D6708E', text:'#F6D8E1'},
];
function colorFor(codigoOrKey){
  let h = 0;
  const s = String(codigoOrKey || '');
  for (const ch of s) h = (h*31 + ch.charCodeAt(0)) % 997;
  return PALETTE[h % PALETTE.length];
}
function slugify(s){
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-');
}
function groupKey(r){
  const codePart = (r.codigo && r.codigo.trim()) ? r.codigo.trim() : ('c-' + slugify(r.materia));
  return codePart + '|' + r.materia;
}

// ===== Day/time parsing (shared by xlsx import) =====
const DAY_NORM = {
  'lunes':'Lunes','martes':'Martes','miercoles':'Miércoles','miércoles':'Miércoles',
  'jueves':'Jueves','viernes':'Viernes','sabado':'Sábado','sábado':'Sábado','domingo':'Domingo'
};
function parseSegment(seg){
  seg = seg.trim();
  const segClean = seg.replace(/\((P|V)\)/gi, '').trim();
  const m = segClean.match(/([A-Za-zÁÉÍÓÚáéíóú]+)\s*(?:de)?\s*[:(]?\s*(\d{1,2})(?::00)?\s*a\s*(\d{1,2})(?::00)?/i);
  if (!m) return null;
  const day = DAY_NORM[m[1].toLowerCase()];
  if (!day) return null;
  return { day, start: parseInt(m[2],10), end: parseInt(m[3],10) };
}
function parseSchedule(text){
  if (!text || typeof text !== 'string') return [];
  if (text.toLowerCase().includes('coordinar')) return [];
  const parts = text.split(/\s*-\s*(?=[A-Za-zÁÉÍÓÚáéíóú])/);
  const blocks = [];
  parts.forEach(p=>{ const r = parseSegment(p); if (r) blocks.push(r); });
  return blocks;
}

// ===== State =====
let BUILTIN = [];
let builtinEnabled = true;
let customMaterias = []; // {id, source:'upload'|'manual', batch, carreras, codigo, materia, comision, raw_horario, turno, modalidad, blocks}
let customIdCounter = 100000;
function nextCustomId(){ return customIdCounter++; }

let selected = new Map(); // groupKey -> record id
let activeFilters = { carrera:null, turno:null, modalidad:null, q:'' };
const openCards = new Set();

function pool(){
  return (builtinEnabled ? BUILTIN : []).concat(customMaterias);
}
function poolById(id){
  return pool().find(r => r.id === id);
}
function groupList(){
  const groups = {};
  pool().forEach(r=>{
    const key = groupKey(r);
    if (!groups[key]) groups[key] = { key, codigo:r.codigo, materia:r.materia, carreras:r.carreras, comisiones:[] };
    groups[key].comisiones.push(r);
  });
  return Object.values(groups).sort((a,b)=>a.materia.localeCompare(b.materia,'es'));
}

// ===== Hash persistence =====
function saveToHash(){
  const ids = Array.from(selected.values());
  const customSelected = ids.map(id=>customMaterias.find(c=>c.id===id)).filter(Boolean);
  const state = { ids, custom: customSelected, builtinOff: !builtinEnabled };
  try{
    const json = JSON.stringify(state);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    history.replaceState(null, '', ids.length ? ('#state=' + b64) : ' ');
  }catch(e){ /* ignore */ }
}
function loadFromHash(){
  const h = location.hash.replace('#','');
  if (!h.startsWith('state=')) return;
  try{
    const json = decodeURIComponent(escape(atob(h.slice(6))));
    const state = JSON.parse(json);
    if (state.builtinOff) builtinEnabled = false;
    if (state.custom && state.custom.length){
      state.custom.forEach(r=>{ customMaterias.push(r); });
    }
    (state.ids||[]).forEach(id=>{
      const rec = poolById(id);
      if (rec) selected.set(groupKey(rec), id);
    });
  }catch(e){ console.warn('No se pudo leer el link guardado', e); }
}

// ===== Filters =====
function uniqueSorted(arr){ return Array.from(new Set(arr.filter(Boolean))).sort((a,b)=>a.localeCompare(b,'es')); }

function buildChips(containerId, values, filterKey){
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (values.length && activeFilters[filterKey] && !values.includes(activeFilters[filterKey])){
    activeFilters[filterKey] = null;
  }
  values.forEach(v=>{
    const chip = document.createElement('div');
    chip.className = 'tag-chip' + (activeFilters[filterKey]===v ? ' active':'');
    chip.textContent = v;
    chip.onclick = () => {
      activeFilters[filterKey] = (activeFilters[filterKey] === v) ? null : v;
      renderMateriaList();
      buildAllChips();
    };
    el.appendChild(chip);
  });
}
function buildAllChips(){
  const p = pool();
  buildChips('carreraChips', uniqueSorted(p.flatMap(r=>r.carreras||[])), 'carrera');
  buildChips('turnoChips', uniqueSorted(p.map(r=>r.turno)), 'turno');
  buildChips('modalidadChips', uniqueSorted(p.map(r=>r.modalidad)), 'modalidad');
}

function matchesFilters(g){
  if (activeFilters.carrera && !(g.carreras||[]).includes(activeFilters.carrera)) return false;
  if (activeFilters.turno && !g.comisiones.some(c=>c.turno===activeFilters.turno)) return false;
  if (activeFilters.modalidad && !g.comisiones.some(c=>c.modalidad===activeFilters.modalidad)) return false;
  if (activeFilters.q){
    const hay = (g.materia + ' ' + (g.codigo||'')).toLowerCase();
    if (!hay.includes(activeFilters.q)) return false;
  }
  return true;
}

function renderMateriaList(){
  const el = document.getElementById('materiaList');
  el.innerHTML = '';
  const filtered = groupList().filter(matchesFilters);
  if (!filtered.length){
    el.innerHTML = '<div class="no-results">No hay materias que coincidan con esos filtros.</div>';
    return;
  }
  filtered.forEach(g=>{
    const key = g.key;
    const card = document.createElement('div');
    card.className = 'materia-card' + (openCards.has(key) ? ' open' : '');
    const selId = selected.get(key);
    const hasOwn = g.comisiones.some(c=>c.source!=='unahur');
    const hasUnahur = g.comisiones.some(c=>c.source==='unahur');

    const head = document.createElement('div');
    head.className = 'm-head';
    head.innerHTML = `
      <div>
        <div class="m-title">${g.materia}${selId!==undefined ? ' ✓' : ''}
          ${hasUnahur ? '<span class="m-src unahur">UNAHUR</span>' : ''}
          ${hasOwn ? '<span class="m-src own">Propia</span>' : ''}
        </div>
        <div class="m-carreras">${(g.carreras||[]).join(' · ')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${g.codigo ? `<span class="m-code">${g.codigo}</span>` : ''}
        <span class="m-caret">▶</span>
      </div>`;
    head.onclick = () => {
      if (openCards.has(key)) openCards.delete(key); else openCards.add(key);
      renderMateriaList();
    };
    card.appendChild(head);

    const comList = document.createElement('div');
    comList.className = 'com-list';
    g.comisiones.forEach(c=>{
      const item = document.createElement('div');
      const isSel = selId === c.id;
      item.className = 'com-item' + (isSel ? ' selected':'');
      if (isSel){
        const col = colorFor(c.codigo || key);
        item.style.setProperty('--sel-bg', col.bg);
        item.style.setProperty('--sel-border', col.accent);
      }
      const when = c.blocks.length
        ? c.blocks.map(b=>`${b.day.slice(0,3)} ${b.start}-${b.end}`).join(' / ')
        : 'A coordinar';
      item.innerHTML = `
        <div>
          <div>Com. ${c.comision}${c.source!=='unahur' ? ' · <span style="color:var(--accent-dark);">propia</span>' : ''}</div>
          <div class="com-when">${when}</div>
        </div>
        <div class="com-badges">
          ${c.modalidad ? `<span class="badge ${c.modalidad}">${c.modalidad}</span>` : ''}
          ${c.source!=='unahur' ? '<button class="com-del" title="Eliminar">✕</button>' : ''}
        </div>`;
      item.onclick = (ev) => {
        ev.stopPropagation();
        if (isSel) selected.delete(key);
        else selected.set(key, c.id);
        saveToHash();
        renderAll();
      };
      const delBtn = item.querySelector('.com-del');
      if (delBtn){
        delBtn.onclick = (ev) => {
          ev.stopPropagation();
          customMaterias = customMaterias.filter(x=>x.id!==c.id);
          if (selected.get(key) === c.id) selected.delete(key);
          saveToHash();
          renderOwnList();
          renderAll();
          buildAllChips();
        };
      }
      comList.appendChild(item);
    });
    card.appendChild(comList);
    el.appendChild(card);
  });
}

// ===== Calendar rendering =====
function computeConflicts(chosen){
  const conflicts = [];
  for (let i=0;i<chosen.length;i++){
    for (let j=i+1;j<chosen.length;j++){
      const A = chosen[i], B = chosen[j];
      for (const ba of A.blocks){
        for (const bb of B.blocks){
          if (ba.day === bb.day && ba.start < bb.end && bb.start < ba.end){
            conflicts.push({a:A, b:B, day:ba.day, start:Math.max(ba.start,bb.start), end:Math.min(ba.end,bb.end)});
          }
        }
      }
    }
  }
  return conflicts;
}

function renderCalendar(chosen, conflicts){
  const grid = document.getElementById('calGrid');
  const emptyMsg = document.getElementById('emptyMsg');
  grid.innerHTML = '';
  emptyMsg.style.display = chosen.length ? 'none' : 'block';

  const corner = document.createElement('div');
  corner.className = 'cal-head corner';
  grid.appendChild(corner);
  DAYS.forEach(d=>{
    const h = document.createElement('div');
    h.className = 'cal-head';
    h.textContent = d;
    grid.appendChild(h);
  });

  const nHours = HOUR_END - HOUR_START;
  const rowHeight = 50;

  const hourCol = document.createElement('div');
  hourCol.style.position = 'relative';
  for (let hI=0; hI<nHours; hI++){
    const lbl = document.createElement('div');
    lbl.className = 'hour-row-bg hour-label';
    lbl.textContent = (HOUR_START+hI) + ':00';
    lbl.style.borderBottom = 'none';
    hourCol.appendChild(lbl);
  }
  grid.appendChild(hourCol);

  DAYS.forEach(day=>{
    const col = document.createElement('div');
    col.className = 'day-col';
    for (let hI=0; hI<nHours; hI++){
      const bg = document.createElement('div');
      bg.className = 'hour-row-bg';
      col.appendChild(bg);
    }

    const events = [];
    chosen.forEach(rec=>{
      rec.blocks.filter(b=>b.day===day).forEach(b=>{ events.push({ rec, b }); });
    });
    events.sort((x,y)=> x.b.start - y.b.start || x.b.end - y.b.end);

    const clusters = [];
    events.forEach(ev=>{
      let placed = false;
      for (const cl of clusters){
        if (cl.some(o => ev.b.start < o.b.end && o.b.start < ev.b.end)){ cl.push(ev); placed = true; break; }
      }
      if (!placed) clusters.push([ev]);
    });
    let changed = true;
    while (changed){
      changed = false;
      outer:
      for (let i=0;i<clusters.length;i++){
        for (let j=i+1;j<clusters.length;j++){
          const overlap = clusters[i].some(a=>clusters[j].some(b2=> a.b.start < b2.b.end && b2.b.start < a.b.end));
          if (overlap){ clusters[i] = clusters[i].concat(clusters[j]); clusters.splice(j,1); changed = true; break outer; }
        }
      }
    }

    clusters.forEach(cl=>{
      const colsEnd = [];
      cl.sort((x,y)=> x.b.start - y.b.start);
      cl.forEach(ev=>{
        let colIdx = colsEnd.findIndex(endT => endT <= ev.b.start);
        if (colIdx === -1){ colIdx = colsEnd.length; colsEnd.push(ev.b.end); }
        else { colsEnd[colIdx] = ev.b.end; }
        ev._col = colIdx;
      });
      const numCols = colsEnd.length;
      cl.forEach(ev=>{
        const { rec, b } = ev;
        const col2 = colorFor(rec.codigo || groupKey(rec));
        const top = (b.start - HOUR_START) * rowHeight;
        const height = (b.end - b.start) * rowHeight - 4;
        const widthPct = 100 / numCols;
        const leftPct = ev._col * widthPct;
        const block = document.createElement('div');
        let isConflict = false;
        for (const c of conflicts){
          if (c.day===day && ((c.a.id===rec.id) || (c.b.id===rec.id)) && b.start < c.end && c.start < b.end){ isConflict = true; break; }
        }
        block.className = 'block' + (isConflict ? ' conflict':'');
        block.style.top = top + 'px';
        block.style.height = height + 'px';
        block.style.left = `calc(${leftPct}% + 3px)`;
        block.style.width = `calc(${widthPct}% - 6px)`;
        block.style.background = col2.bg;
        block.style.borderColor = col2.accent;
        block.style.color = col2.text;
        block.innerHTML = `<span class="b-title">${rec.materia}</span><span class="b-meta">Com. ${rec.comision} · ${b.start}-${b.end}hs</span>`;
        col.appendChild(block);
      });
    });

    grid.appendChild(col);
  });

  grid.style.gridTemplateRows = `auto repeat(${nHours}, ${rowHeight}px)`;
}

function renderConflictNotes(conflicts){
  const el = document.getElementById('conflictArea');
  el.innerHTML = '';
  if (!conflicts.length) return;
  const box = document.createElement('div');
  box.className = 'conflict-note';
  const lines = conflicts.map(c=>
    `<div>${c.a.materia} (com. ${c.a.comision}) se superpone con ${c.b.materia} (com. ${c.b.comision}) el <b>${c.day}</b> de ${c.start} a ${c.end}hs.</div>`
  ).join('');
  box.innerHTML = `<div style="flex:1;"><div style="margin-bottom:3px;font-weight:700;">Tenés horarios superpuestos</div>${lines}</div>`;
  el.appendChild(box);
}

function renderLegend(chosen){
  const el = document.getElementById('legendList');
  el.innerHTML = '';
  if (!chosen.length){
    el.innerHTML = '<div class="legend-empty">Todavía no elegiste ninguna materia.</div>';
    return;
  }
  chosen.slice().sort((a,b)=>a.materia.localeCompare(b.materia,'es')).forEach(rec=>{
    const col = colorFor(rec.codigo || groupKey(rec));
    const when = rec.blocks.length ? rec.blocks.map(b=>`${b.day} ${b.start}-${b.end}hs`).join(' · ') : 'A coordinar';
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-swatch" style="background:${col.accent};"></span>
      <div class="li-main">
        <div><b>${rec.materia}</b> · com. ${rec.comision} ${rec.modalidad ? `<span class="badge ${rec.modalidad}">${rec.modalidad}</span>` : ''}</div>
        <div class="li-when">${when}</div>
      </div>
      <button title="Quitar">✕</button>`;
    item.querySelector('button').onclick = () => {
      selected.delete(groupKey(rec));
      saveToHash();
      renderAll();
    };
    el.appendChild(item);
  });
}

function renderSummary(chosen, conflicts){
  document.getElementById('statMaterias').textContent = chosen.length;
  let totalHoras = 0;
  chosen.forEach(rec=>rec.blocks.forEach(b=>totalHoras += (b.end-b.start)));
  document.getElementById('statHoras').textContent = totalHoras;
  document.getElementById('statConflictos').textContent = conflicts.length;
}

function renderAll(){
  const chosen = Array.from(selected.values()).map(poolById).filter(Boolean);
  const conflicts = computeConflicts(chosen);
  renderCalendar(chosen, conflicts);
  renderConflictNotes(conflicts);
  renderLegend(chosen);
  renderSummary(chosen, conflicts);
  renderMateriaList();
}

// ===== Own materias list (upload batches + manual) =====
function renderOwnList(){
  const el = document.getElementById('ownList');
  el.innerHTML = '';
  const batches = {};
  customMaterias.forEach(r=>{
    const label = r.source === 'manual' ? 'Cargadas a mano' : (r.batch || 'Archivo subido');
    if (!batches[label]) batches[label] = [];
    batches[label].push(r);
  });
  Object.entries(batches).forEach(([label, recs])=>{
    const chip = document.createElement('div');
    chip.className = 'own-chip';
    chip.innerHTML = `<span>${label} · ${recs.length} materia${recs.length===1?'':'s'}</span>`;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.title = 'Quitar todas estas';
    btn.onclick = () => {
      const ids = new Set(recs.map(r=>r.id));
      customMaterias = customMaterias.filter(r=>!ids.has(r.id));
      Array.from(selected.entries()).forEach(([k,id])=>{ if (ids.has(id)) selected.delete(k); });
      saveToHash();
      renderOwnList();
      renderAll();
      buildAllChips();
    };
    chip.appendChild(btn);
    el.appendChild(chip);
  });
}

// ===== xlsx upload =====
function findCol(headers, keywords){
  for (let i=0;i<headers.length;i++){
    const h = String(headers[i]||'').toLowerCase();
    if (keywords.some(k=>h.includes(k))) return i;
  }
  return -1;
}
function showUploadMsg(text, ok){
  const el = document.getElementById('uploadMsg');
  el.innerHTML = `<div class="upload-msg ${ok?'ok':'error'}">${text}</div>`;
  setTimeout(()=>{ el.innerHTML=''; }, 6000);
}

function initUploadHandlers(){
  document.getElementById('btnUpload').onclick = () => {
    if (typeof XLSX === 'undefined'){
      showUploadMsg('No pude cargar la librería para leer Excel (revisá tu conexión a internet y recargá la página).', false);
      return;
    }
    document.getElementById('fileInput').click();
  };

  document.getElementById('fileInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    if (typeof XLSX === 'undefined'){
      showUploadMsg('No pude cargar la librería para leer Excel (revisá tu conexión a internet y recargá la página).', false);
      e.target.value = '';
      return;
    }

    // Si ya hay materias subidas de un archivo anterior, preguntar si reemplazar
    const existingUploads = customMaterias.filter(r=>r.source==='upload');
    let removeExisting = false;
    if (existingUploads.length){
      removeExisting = confirm(
        `Ya tenés ${existingUploads.length} materia${existingUploads.length===1?'':'s'} cargada${existingUploads.length===1?'':'s'} desde un Excel anterior.\n\n` +
        `Aceptar = borrarlas y quedarte solo con las de este archivo nuevo.\n` +
        `Cancelar = conservarlas y sumar las de este archivo.`
      );
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try{
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type:'array' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header:1, raw:false, defval:'' });

        let headerRowIdx = 0;
        for (let i=0;i<Math.min(rows.length,10);i++){
          if (rows[i].some(c=>String(c).toLowerCase().includes('materia'))){ headerRowIdx = i; break; }
        }
        const headers = rows[headerRowIdx] || [];
        const idxMateria = findCol(headers, ['materia']);
        const idxHorario = findCol(headers, ['horario','día','dia']);
        const idxTurno = findCol(headers, ['turno']);
        const idxModalidad = findCol(headers, ['modalidad']);
        const idxCom = findCol(headers, ['com']);
        const idxCarrera = findCol(headers, ['carrera']);
        const idxCodigo = findCol(headers, ['código','codigo']);

        if (idxMateria === -1 || idxHorario === -1){
          showUploadMsg('No encontré columnas "Materia" y "Día y Horario" en el archivo. Revisá que tenga ese formato.', false);
          return;
        }

        const newRecords = [];
        for (let r=headerRowIdx+1; r<rows.length; r++){
          const row = rows[r];
          if (!row || !row[idxMateria]) continue;
          const materia = String(row[idxMateria]).trim();
          if (!materia) continue;
          const rawHorario = idxHorario>-1 ? String(row[idxHorario]||'').trim() : '';
          newRecords.push({
            id: nextCustomId(),
            source: 'upload',
            batch: file.name,
            carreras: idxCarrera>-1 && row[idxCarrera] ? String(row[idxCarrera]).split(/[-/]/).map(s=>s.trim()).filter(Boolean) : [],
            codigo: idxCodigo>-1 ? String(row[idxCodigo]||'').trim() : '',
            materia,
            comision: idxCom>-1 && row[idxCom] ? String(row[idxCom]).trim() : '1',
            raw_horario: rawHorario,
            turno: idxTurno>-1 ? String(row[idxTurno]||'').trim() : '',
            modalidad: idxModalidad>-1 ? String(row[idxModalidad]||'').trim() : '',
            blocks: parseSchedule(rawHorario)
          });
        }

        if (newRecords.length === 0){
          showUploadMsg('No encontré filas con materias cargadas en el archivo.', false);
          return;
        }

        if (removeExisting){
          const idsToRemove = new Set(existingUploads.map(r=>r.id));
          customMaterias = customMaterias.filter(r=>!idsToRemove.has(r.id));
          Array.from(selected.entries()).forEach(([k,id])=>{ if (idsToRemove.has(id)) selected.delete(k); });
        }

        customMaterias = customMaterias.concat(newRecords);
        showUploadMsg(`Se importaron ${newRecords.length} materias de "${file.name}".`, true);
        saveToHash();
        renderOwnList();
        renderMateriaList();
        renderAll();
        buildAllChips();
      }catch(err){
        console.error(err);
        showUploadMsg('No pude leer ese archivo. ¿Es un .xlsx válido?', false);
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  });
}

// ===== Manual entry form =====
let mfBlockCount = 0;
function addManualBlockRow(day, start, end){
  const id = 'mfb' + (mfBlockCount++);
  const row = document.createElement('div');
  row.className = 'block-row';
  row.dataset.rowId = id;
  const dayOptions = DAYS.map(d=>`<option ${d===day?'selected':''}>${d}</option>`).join('');
  row.innerHTML = `
    <div><div class="mini-lbl">Día</div><select class="mf-day">${dayOptions}</select></div>
    <div><div class="mini-lbl">Desde</div><input type="text" class="mf-start mono" value="${start!==undefined?start:'18'}" inputmode="numeric"></div>
    <div><div class="mini-lbl">Hasta</div><input type="text" class="mf-end mono" value="${end!==undefined?end:'20'}" inputmode="numeric"></div>
    <button class="remove-block" title="Quitar">✕</button>`;
  row.querySelector('.remove-block').onclick = () => row.remove();
  document.getElementById('mfBlocks').appendChild(row);
}

function initManualForm(){
  const manualForm = document.getElementById('manualForm');
  document.getElementById('mfAddBlock').onclick = () => addManualBlockRow();

  document.getElementById('btnManual').onclick = () => {
    manualForm.classList.add('open');
    document.getElementById('mfBlocks').innerHTML = '';
    mfBlockCount = 0;
    addManualBlockRow();
    document.getElementById('mfMateria').focus();
  };
  document.getElementById('mfCancel').onclick = () => { manualForm.classList.remove('open'); };

  document.getElementById('mfSave').onclick = () => {
    const materia = document.getElementById('mfMateria').value.trim();
    if (!materia){ alert('Poné el nombre de la materia.'); return; }
    const comision = document.getElementById('mfComision').value.trim() || '1';
    const turno = document.getElementById('mfTurno').value;
    const modalidad = document.getElementById('mfModalidad').value;
    const rows = Array.from(document.querySelectorAll('#mfBlocks .block-row'));
    const blocks = [];
    for (const row of rows){
      const day = row.querySelector('.mf-day').value;
      const start = parseInt(row.querySelector('.mf-start').value, 10);
      const end = parseInt(row.querySelector('.mf-end').value, 10);
      if (isNaN(start) || isNaN(end) || end <= start){
        alert('Revisá los horarios: "Hasta" tiene que ser mayor que "Desde".');
        return;
      }
      blocks.push({ day, start, end });
    }
    if (!blocks.length){ alert('Agregá al menos un día y horario.'); return; }
    customMaterias.push({
      id: nextCustomId(),
      source: 'manual',
      carreras: [],
      codigo: '',
      materia, comision, turno, modalidad,
      raw_horario: blocks.map(b=>`${b.day} ${b.start} a ${b.end}hs`).join(' - '),
      blocks
    });
    manualForm.classList.remove('open');
    saveToHash();
    renderOwnList();
    renderMateriaList();
    renderAll();
    buildAllChips();
  };
}

// ===== Init =====
async function init(){
  try{
    const res = await fetch('data/materias.json');
    BUILTIN = await res.json();
    BUILTIN.forEach(r => r.source = 'unahur');
  }catch(e){
    console.error('No se pudo cargar data/materias.json', e);
    document.getElementById('materiaList').innerHTML =
      '<div class="no-results">No pude cargar los horarios de UNAHUR (data/materias.json). Si abriste el archivo directamente con doble clic, probalo sirviéndolo con un servidor local o publicado en GitHub Pages.</div>';
  }

  document.getElementById('searchInput').addEventListener('input', (e)=>{
    activeFilters.q = e.target.value.trim().toLowerCase();
    renderMateriaList();
  });

  document.getElementById('toggleBuiltin').addEventListener('change', (e)=>{
    builtinEnabled = e.target.checked;
    saveToHash();
    renderAll();
    buildAllChips();
  });

  document.getElementById('btnClear').onclick = () => {
    if (!selected.size) return;
    if (confirm('¿Vaciar la selección del horario?')){
      selected.clear();
      saveToHash();
      renderAll();
    }
  };
  document.getElementById('btnShare').onclick = () => {
    saveToHash();
    navigator.clipboard.writeText(location.href).then(()=>{
      const btn = document.getElementById('btnShare');
      const old = btn.textContent;
      btn.textContent = 'Copiado';
      setTimeout(()=>btn.textContent = old, 1500);
    }).catch(()=>{
      alert('Copiá este link manualmente:\n' + location.href);
    });
  };

  initUploadHandlers();
  initManualForm();

  loadFromHash();
  document.getElementById('toggleBuiltin').checked = builtinEnabled;
  buildAllChips();
  renderOwnList();
  renderMateriaList();
  renderAll();
}

init();
