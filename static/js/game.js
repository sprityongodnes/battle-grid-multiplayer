(function(){
  "use strict";

  const CFG = window.BG_CONFIG || {};
  const SIZE = 10;
  const SHIP_DEFS = CFG.shipDefs || [];
  const COL_LETTERS = ['A','B','C','D','E','F','G','H','I','J'];
  function coordLabel(r,c){ return COL_LETTERS[c] + (r+1); }
  function shipImgUrl(id){ return `/static/img/ships/${id}.png`; }

  if(!CFG.authenticated){ return; } // rien à faire tant que non connecté (voir loginScreen)

  // ---------- DOM ----------
  const homeBtn = document.getElementById('homeBtn');
  const onboard = document.getElementById('onboard');
  const scrollBody = document.getElementById('scrollBody');
  const footerBar = document.getElementById('footerBar');
  const playAIBtn = document.getElementById('playAIBtn');
  const playMultiBtn = document.getElementById('playMultiBtn');
  const leaderboardBtn = document.getElementById('leaderboardBtn');
  const queueScreen = document.getElementById('queueScreen');
  const cancelQueueBtn = document.getElementById('cancelQueueBtn');
  const matchFoundScreen = document.getElementById('matchFoundScreen');
  const proceedPlacementBtn = document.getElementById('proceedPlacementBtn');
  const leaderboardScreen = document.getElementById('leaderboardScreen');
  const leaderboardList = document.getElementById('leaderboardList');
  const placeScreen = document.getElementById('placeScreen');
  const battleScreen = document.getElementById('battleScreen');
  const placeBoardEl = document.getElementById('placeBoard');
  const ownBoardEl = document.getElementById('ownBoard');
  const enemyBoardEl = document.getElementById('enemyBoard');
  const enemyBoardTitle = document.getElementById('enemyBoardTitle');
  const trayEl = document.getElementById('tray');
  const randomBtn = document.getElementById('randomBtn');
  const clearBtn = document.getElementById('clearBtn');
  const startBattleBtn = document.getElementById('startBattleBtn');
  const turnBanner = document.getElementById('turnBanner');
  const turnText = document.getElementById('turnText');
  const ownFleetRow = document.getElementById('ownFleetRow');
  const enemyFleetRow = document.getElementById('enemyFleetRow');
  const toastWrap = document.getElementById('toastWrap');
  const journalBtn = document.getElementById('journalBtn');
  const journalPanel = document.getElementById('journalPanel');
  const journalBody = document.getElementById('journalBody');
  const journalClose = document.getElementById('journalClose');
  const fleetBtn = document.getElementById('fleetBtn');
  const fleetPanel = document.getElementById('fleetPanel');
  const fleetClose = document.getElementById('fleetClose');
  const soundBtn = document.getElementById('soundBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const endOverlay = document.getElementById('endOverlay');
  const endEmoji = document.getElementById('endEmoji');
  const endTitle = document.getElementById('endTitle');
  const endStats = document.getElementById('endStats');
  const replayBtn = document.getElementById('replayBtn');
  const profileChip = document.getElementById('profileChip');
  const profileAvatar = document.getElementById('profileAvatar');
  const profileRankBadge = document.getElementById('profileRankBadge');
  const profileName = document.getElementById('profileName');

  // ---------- profil ----------
  let me = CFG.user;
  function renderProfile(){
    if(!me) return;
    profileAvatar.src = me.avatar_url || ('data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23171512"/></svg>`));
    profileRankBadge.src = me.rank.badge;
    profileName.textContent = me.name;
  }
  renderProfile();
  logoutBtn.addEventListener('click', ()=>{ window.location.href = '/logout'; });
  profileChip.addEventListener('click', ()=> openLeaderboard());

  async function refreshMe(){
    try{
      const res = await fetch('/api/me');
      const data = await res.json();
      if(data.authenticated){ me = data.user; renderProfile(); }
    }catch(e){}
  }

  // ---------- sound ----------
  let audioCtx = null;
  let muted = false;
  let ambientNodes = null, pingTimer = null;
  function ensureAudio(){
    if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
    if(audioCtx && audioCtx.state === 'suspended'){ audioCtx.resume().catch(()=>{}); }
  }
  function tone(freq, dur, type, delay, vol){
    if(muted || !audioCtx) return;
    const t0 = audioCtx.currentTime + (delay||0);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type||'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol||0.18, t0+0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0+dur);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0+dur+0.02);
  }
  function playSound(kind){
    ensureAudio(); if(!audioCtx) return;
    if(kind==='hit'){ tone(180,0.28,'sawtooth',0,0.16); tone(90,0.35,'sine',0.03,0.14); }
    else if(kind==='miss'){ tone(700,0.12,'sine',0,0.10); }
    else if(kind==='sunk'){ tone(220,0.18,'square',0,0.14); tone(160,0.18,'square',0.14,0.14); tone(110,0.3,'square',0.28,0.14); }
    else if(kind==='win'){ [440,554,659,880].forEach((f,i)=>tone(f,0.28,'triangle',i*0.14,0.14)); }
    else if(kind==='lose'){ [300,240,180].forEach((f,i)=>tone(f,0.35,'sawtooth',i*0.18,0.13)); }
    else if(kind==='click'){ tone(920,0.05,'square',0,0.05); }
    else if(kind==='rotate'){ tone(500,0.06,'triangle',0,0.07); tone(700,0.06,'triangle',0.04,0.06); }
    else if(kind==='place'){ tone(140,0.16,'sine',0,0.12); tone(90,0.2,'sine',0.05,0.10); }
    else if(kind==='turn'){ tone(340,0.1,'sine',0,0.08); }
  }
  function startAmbient(){
    ensureAudio(); if(!audioCtx || ambientNodes) return;
    const master = audioCtx.createGain(); master.gain.value = muted ? 0 : 0.05;
    master.connect(audioCtx.destination);
    const filt = audioCtx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=320; filt.connect(master);
    const o1 = audioCtx.createOscillator(); o1.type='sine'; o1.frequency.value=55;
    const o2 = audioCtx.createOscillator(); o2.type='sine'; o2.frequency.value=55*1.006;
    const g1 = audioCtx.createGain(); g1.gain.value=0.6;
    const g2 = audioCtx.createGain(); g2.gain.value=0.6;
    o1.connect(g1); g1.connect(filt); o2.connect(g2); g2.connect(filt);
    o1.start(); o2.start();
    ambientNodes = { master };
    scheduleSonarPing();
  }
  function scheduleSonarPing(){
    if(pingTimer) clearTimeout(pingTimer);
    pingTimer = setTimeout(()=>{
      if(!muted && audioCtx){ tone(1100,0.5,'sine',0,0.05); tone(1100,0.5,'sine',0.55,0.03); }
      scheduleSonarPing();
    }, 6000 + Math.random()*5000);
  }
  soundBtn.addEventListener('click', ()=>{
    muted = !muted; soundBtn.textContent = muted ? '🔇' : '🔊';
    if(!muted){ ensureAudio(); startAmbient(); }
    if(ambientNodes) ambientNodes.master.gain.setTargetAtTime(muted?0:0.05, audioCtx.currentTime, 0.3);
  });
  document.addEventListener('click', (e)=>{
    if(e.target.closest('.rotateBtn')) return;
    const el = e.target.closest('.iconBtn, .btn, .trayShip');
    if(el) playSound('click');
  }, true);

  function toast(text){
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    toastWrap.appendChild(t);
    setTimeout(()=>t.remove(), 2300);
  }

  // ---------- écrans ----------
  const ALL_SCREENS = [onboard, queueScreen, matchFoundScreen, leaderboardScreen, placeScreen, battleScreen];
  function showScreen(el){
    ALL_SCREENS.forEach(s => s.classList.add('hidden'));
    el.classList.remove('hidden');
    footerBar.classList.toggle('hidden', el !== placeScreen);
    fleetBtn.style.display = (el === battleScreen) ? 'flex' : 'none';
    journalBtn.style.display = (el === battleScreen) ? 'flex' : 'none';
  }
  homeBtn.addEventListener('click', ()=>{
    if(mode === 'multi' && matchId && !matchFinished){
      socket.emit('leave_match', { match_id: matchId });
    }
    resetToMenu();
  });

  // ---------- construction des grilles ----------
  function buildBoard(cellGridEl, colLabelsEl, rowLabelsEl, spacerEl){
    cellGridEl.innerHTML = ''; colLabelsEl.innerHTML = ''; rowLabelsEl.innerHTML = '';
    const isMini = cellGridEl.closest('.boardPanel').classList.contains('mini');
    const labelSize = isMini ? '12px' : '15px';
    spacerEl.style.width = labelSize; rowLabelsEl.style.width = labelSize;
    for(let c=0;c<SIZE;c++){
      const lab = document.createElement('div');
      lab.className='lbl'; lab.textContent = COL_LETTERS[c]; lab.style.flex='1';
      colLabelsEl.appendChild(lab);
    }
    const cells = [];
    for(let r=0;r<SIZE;r++){
      const rowLab = document.createElement('div');
      rowLab.className='lbl'; rowLab.textContent=(r+1); rowLab.style.flex='1';
      rowLabelsEl.appendChild(rowLab);
      const row = [];
      for(let c=0;c<SIZE;c++){
        const cell = document.createElement('div');
        cell.className='cell'; cell.dataset.r=r; cell.dataset.c=c;
        cellGridEl.appendChild(cell);
        row.push(cell);
      }
      cells.push(row);
    }
    return cells;
  }

  function computeCells(r,c,size,orientation){
    if(orientation==='h'){ if(c+size>SIZE) return null; return Array.from({length:size},(_,k)=>[r,c+k]); }
    if(r+size>SIZE) return null; return Array.from({length:size},(_,k)=>[r+k,c]);
  }
  function inferOrientation(cells){
    return cells.every(([r,c])=> r===cells[0][0]) ? 'h' : 'v';
  }
  function makeEmptyOccupancy(){ return Array.from({length:SIZE},()=>Array(SIZE).fill(null)); }
  function makeEmptyStatus(){ return Array.from({length:SIZE},()=>Array(SIZE).fill('unknown')); }

  function randomPlaceShips(occupancy, defs){
    const ships = [];
    for(const def of defs){
      let placed=false, guard=0;
      while(!placed && guard<400){
        guard++;
        const orientation = Math.random()<0.5?'h':'v';
        const r = Math.floor(Math.random()*SIZE), c = Math.floor(Math.random()*SIZE);
        const cells = computeCells(r,c,def.size,orientation);
        if(cells && cells.every(([rr,cc])=>!occupancy[rr][cc])){
          cells.forEach(([rr,cc])=> occupancy[rr][cc]=def.id);
          ships.push({ id:def.id, name:def.name, size:def.size, orientation,
            cells: cells.map(([rr,cc])=>({r:rr,c:cc})), hits:0, sunk:false });
          placed=true;
        }
      }
    }
    return ships;
  }

  function updateShipImgPosition(img, ship, cellsEls, cellGridEl){
    const gridRect = cellGridEl.getBoundingClientRect();
    if(gridRect.width===0) return;
    const firstCell = cellsEls[ship.cells[0].r][ship.cells[0].c].getBoundingClientRect();
    const lastCell = cellsEls[ship.cells[ship.cells.length-1].r][ship.cells[ship.cells.length-1].c].getBoundingClientRect();
    if(ship.orientation==='v'){
      const left = firstCell.left-gridRect.left, top = firstCell.top-gridRect.top;
      const w = firstCell.width, h = lastCell.bottom-firstCell.top;
      img.style.left=left+'px'; img.style.top=top+'px'; img.style.width=w+'px'; img.style.height=h+'px';
      img.style.transform='';
    } else {
      const left = firstCell.left-gridRect.left, top = firstCell.top-gridRect.top;
      const finalW = lastCell.right-firstCell.left, finalH = firstCell.height;
      const cx=left+finalW/2, cy=top+finalH/2;
      const uw=finalH, uh=finalW;
      img.style.left=(cx-uw/2)+'px'; img.style.top=(cy-uh/2)+'px';
      img.style.width=uw+'px'; img.style.height=uh+'px';
      img.style.transform='rotate(90deg)';
    }
  }
  function paintShip(cellGridEl, cellsEls, ship, imgMap){
    ship.cells.forEach(cell=> cellsEls[cell.r][cell.c].classList.add('ship'));
    let img = imgMap[ship.id];
    if(!img){
      img = document.createElement('img');
      img.className='shipImg'; img.src = shipImgUrl(ship.id); img.draggable=false; img.alt=ship.name;
      cellGridEl.appendChild(img);
      imgMap[ship.id]=img;
    }
    updateShipImgPosition(img, ship, cellsEls, cellGridEl);
    img.classList.toggle('sunk-tint', !!ship.sunk);
  }

  // ---------- état de placement (partagé IA / multi) ----------
  let placeCellsEls=null, ownCellsEls=null, enemyCellsEls=null;
  let occupancy = makeEmptyOccupancy();
  let unplaced = SHIP_DEFS.map(d=>({...d, orientation:'h'}));
  let placedShips = [];
  let placeShipImgs={}, ownShipImgs={}, enemyShipImgs={};

  function renderTray(){
    trayEl.innerHTML='';
    unplaced.forEach(def=>{
      const item = document.createElement('div');
      item.className = 'trayShip' + (def.orientation==='v'?' vert':'');
      item.dataset.id = def.id;
      const img = document.createElement('img'); img.src = shipImgUrl(def.id); img.draggable=false;
      const name = document.createElement('div'); name.className='name'; name.textContent=def.name;
      const size = document.createElement('div'); size.className='size'; size.textContent=def.size+' cases';
      const rot = document.createElement('button'); rot.className='rotateBtn'; rot.textContent='⟳';
      rot.addEventListener('click',(e)=>{ e.stopPropagation(); def.orientation = def.orientation==='h'?'v':'h'; renderTray(); playSound('rotate'); });
      item.appendChild(rot); item.appendChild(img); item.appendChild(name); item.appendChild(size);
      attachDrag(item, def);
      trayEl.appendChild(item);
    });
    startBattleBtn.disabled = unplaced.length>0;
  }

  let dragGhost=null, dragInfo=null;
  function clearPreview(){ for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++) placeCellsEls[r][c].classList.remove('preview-ok','preview-bad'); }
  function attachDrag(item, def){
    item.addEventListener('pointerdown',(e)=>{
      if(e.target.classList.contains('rotateBtn')) return;
      e.preventDefault(); item.setPointerCapture(e.pointerId);
      const c0=placeCellsEls[0][0].getBoundingClientRect(), c1=placeCellsEls[0][1].getBoundingClientRect();
      const step = c1.left-c0.left;
      dragInfo = { def, pid:e.pointerId, step, lastValid:false, lastCells:null };
      dragGhost = document.createElement('div');
      dragGhost.className='ghost'+(def.orientation==='v'?' vert':'');
      for(let i=0;i<def.size;i++){ const sq=document.createElement('i'); sq.style.width=(step-2)+'px'; sq.style.height=(step-2)+'px'; dragGhost.appendChild(sq); }
      document.body.appendChild(dragGhost);
      positionGhost(e.clientX,e.clientY); updateHoverPreview(e.clientX,e.clientY);
    });
    item.addEventListener('pointermove',(e)=>{
      if(!dragInfo || dragInfo.pid!==e.pointerId) return;
      positionGhost(e.clientX,e.clientY); updateHoverPreview(e.clientX,e.clientY);
    });
    function endHandler(e){
      if(!dragInfo || dragInfo.pid!==e.pointerId) return;
      if(dragGhost){ dragGhost.remove(); dragGhost=null; }
      clearPreview();
      if(dragInfo.lastValid && dragInfo.lastCells) commitPlacement(def, dragInfo.lastCells);
      dragInfo=null;
    }
    item.addEventListener('pointerup', endHandler);
    item.addEventListener('pointercancel', endHandler);
  }
  function positionGhost(x,y){ if(dragGhost){ dragGhost.style.left=x+'px'; dragGhost.style.top=y+'px'; } }
  function updateHoverPreview(x,y){
    clearPreview();
    const el = document.elementFromPoint(x,y);
    if(!el || !el.classList || !el.classList.contains('cell') || !placeBoardEl.contains(el)){ dragInfo.lastValid=false; dragInfo.lastCells=null; return; }
    const r=parseInt(el.dataset.r,10), c=parseInt(el.dataset.c,10);
    const cells = computeCells(r,c,dragInfo.def.size,dragInfo.def.orientation);
    const valid = !!cells && cells.every(([rr,cc])=>!occupancy[rr][cc]);
    dragInfo.lastValid=valid; dragInfo.lastCells=cells;
    if(cells){ cells.forEach(([rr,cc])=>{ if(rr>=0&&rr<SIZE&&cc>=0&&cc<SIZE) placeCellsEls[rr][cc].classList.add(valid?'preview-ok':'preview-bad'); }); }
    else placeCellsEls[r][c].classList.add('preview-bad');
  }
  function commitPlacement(def, cells){
    cells.forEach(([rr,cc])=> occupancy[rr][cc]=def.id);
    const ship = { id:def.id, name:def.name, size:def.size, orientation:def.orientation,
      cells: cells.map(([rr,cc])=>({r:rr,c:cc})), hits:0, sunk:false };
    placedShips.push(ship);
    paintShip(placeBoardEl, placeCellsEls, ship, placeShipImgs);
    unplaced = unplaced.filter(u=>u.id!==def.id);
    renderTray(); playSound('place');
  }
  function removePlacedShip(id){
    const idx = placedShips.findIndex(s=>s.id===id);
    if(idx===-1) return;
    const ship = placedShips[idx];
    ship.cells.forEach(cell=>{ occupancy[cell.r][cell.c]=null; placeCellsEls[cell.r][cell.c].className='cell'; });
    if(placeShipImgs[id]){ placeShipImgs[id].remove(); delete placeShipImgs[id]; }
    placedShips.splice(idx,1);
    const def = SHIP_DEFS.find(d=>d.id===id);
    unplaced.push({...def, orientation: ship.orientation});
    renderTray();
  }
  placeBoardEl.addEventListener('click', (e)=>{
    const el = e.target.closest('.cell'); if(!el) return;
    const r=parseInt(el.dataset.r,10), c=parseInt(el.dataset.c,10);
    const id = occupancy[r][c]; if(id) removePlacedShip(id);
  });
  randomBtn.addEventListener('click', ()=>{
    const remainingDefs = unplaced.map(u=>({id:u.id,name:u.name,size:u.size}));
    const newShips = randomPlaceShips(occupancy, remainingDefs);
    newShips.forEach(ship=>{ placedShips.push(ship); paintShip(placeBoardEl, placeCellsEls, ship, placeShipImgs); });
    unplaced=[]; renderTray();
  });
  clearBtn.addEventListener('click', ()=>{
    occupancy = makeEmptyOccupancy(); placedShips=[];
    Object.values(placeShipImgs).forEach(img=>img.remove()); placeShipImgs={};
    unplaced = SHIP_DEFS.map(d=>({...d, orientation:'h'}));
    for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++) placeCellsEls[r][c].className='cell';
    renderTray();
  });

  function resetPlacement(){
    occupancy = makeEmptyOccupancy(); placedShips=[];
    Object.values(placeShipImgs).forEach(img=>img.remove()); placeShipImgs={};
    unplaced = SHIP_DEFS.map(d=>({...d, orientation:'h'}));
    placeCellsEls = buildBoard(placeBoardEl, document.getElementById('colLabelsRow'), document.getElementById('rowLabelsCol'), document.getElementById('spacer1'));
    renderTray();
  }

  function markCell(cellsEls, r, c, status){
    const el = cellsEls[r][c];
    el.classList.remove('preview-ok','preview-bad'); el.classList.add(status);
    el.innerHTML='';
    const span = document.createElement('span');
    if(status==='sunk') span.textContent='☠';
    el.appendChild(span);
  }
  function markShipSunkCells(cellsEls, ship){
    ship.cells.forEach(cell=>{
      const el = cellsEls[cell.r][cell.c];
      el.classList.remove('hit'); el.classList.add('sunk');
      el.innerHTML='<span>☠</span>';
    });
  }
  function renderFleetRow(container, ships){
    container.innerHTML = ships.map(s=>
      `<div class="fleetChip${s.sunk?' sunk':''}"><span class="dotship"></span>${s.name}${s.size?' ('+s.size+')':''}</div>`
    ).join('');
  }

  function updateBanner(state, text){
    if(state==='thinking'){ turnBanner.classList.add('thinking'); turnText.textContent = text || "L'IA calcule..."; }
    else if(state==='wait'){ turnBanner.classList.add('thinking'); turnText.textContent = text || "Tour de l'adversaire"; }
    else { turnBanner.classList.remove('thinking'); turnText.textContent = text || 'À vous de tirer'; if(state==='mine') playSound('turn'); }
  }

  let journal = [];
  function pushJournal(actor, coord, result, shipName){
    journal.unshift({actor,coord,result,shipName});
    if(!journalPanel.classList.contains('hidden')) renderJournal();
  }
  function renderJournal(){
    if(journal.length===0){ journalBody.innerHTML='<div class="empty-state">Aucun tir pour le moment.</div>'; return; }
    journalBody.innerHTML = journal.map(j=>{
      const resClass = j.result==='sunk'?'sunk':(j.result==='hit'?'hit':'miss');
      const resText = j.result==='sunk'?'Coulé':(j.result==='hit'?'Touché':'Manqué');
      return `<div class="jrow"><span class="who disp">${j.actor}</span><span class="coord">${j.coord}</span>`
        + (j.shipName?`<span style="opacity:.6;font-size:10px;">${j.shipName}</span>`:'')
        + `<span class="res ${resClass}">${resText}</span></div>`;
    }).join('');
  }
  journalBtn.addEventListener('click', ()=>{ renderJournal(); journalPanel.classList.remove('hidden'); });
  journalClose.addEventListener('click', ()=> journalPanel.classList.add('hidden'));
  journalPanel.addEventListener('click', (e)=>{ if(e.target===journalPanel) journalPanel.classList.add('hidden'); });

  fleetBtn.addEventListener('click', ()=>{
    renderFleetRow(ownFleetRow, playerShips);
    fleetPanel.classList.remove('hidden');
    requestAnimationFrame(()=>{
      Object.values(ownShipImgs).forEach(img=>img.remove()); ownShipImgs={};
      playerShips.forEach(ship=> paintShip(ownBoardEl, ownCellsEls, ship, ownShipImgs));
    });
  });
  fleetClose.addEventListener('click', ()=> fleetPanel.classList.add('hidden'));
  fleetPanel.addEventListener('click', (e)=>{ if(e.target===fleetPanel) fleetPanel.classList.add('hidden'); });

  window.addEventListener('resize', ()=>{
    if(!placeScreen.classList.contains('hidden')){
      placedShips.forEach(ship=>{ const img=placeShipImgs[ship.id]; if(img) updateShipImgPosition(img, ship, placeCellsEls, placeBoardEl); });
    }
    if(!battleScreen.classList.contains('hidden')){
      Object.keys(enemyShipImgs).forEach(id=>{
        const ship = revealedEnemyShips[id]; const img = enemyShipImgs[id];
        if(ship && img) updateShipImgPosition(img, ship, enemyCellsEls, enemyBoardEl);
      });
    }
  });

  // ============================================================
  //  MODE ENTRAÎNEMENT (IA locale, probabilités)
  // ============================================================
  let playerShips = [];
  let aiShips = [];
  let playerBoard, enemyBoardState;
  let turn = 'player', battleOver = false;
  let stats = { shots:0, hits:0, turns:0 };

  function computeProbabilityGrid(statusGrid, sizes){
    const grid = Array.from({length:SIZE},()=>Array(SIZE).fill(0));
    for(const size of sizes){
      for(let r=0;r<SIZE;r++) for(let c=0;c<=SIZE-size;c++){
        let valid=true, touchesHit=false;
        for(let k=0;k<size;k++){ const s=statusGrid[r][c+k]; if(s==='miss'||s==='sunk'){valid=false;break;} if(s==='hit') touchesHit=true; }
        if(valid) for(let k=0;k<size;k++) if(statusGrid[r][c+k]==='unknown') grid[r][c+k]+=touchesHit?5:1;
      }
      for(let c=0;c<SIZE;c++) for(let r=0;r<=SIZE-size;r++){
        let valid=true, touchesHit=false;
        for(let k=0;k<size;k++){ const s=statusGrid[r+k][c]; if(s==='miss'||s==='sunk'){valid=false;break;} if(s==='hit') touchesHit=true; }
        if(valid) for(let k=0;k<size;k++) if(statusGrid[r+k][c]==='unknown') grid[r+k][c]+=touchesHit?5:1;
      }
    }
    return grid;
  }

  function aiFirePlayer(r,c){
    if(turn!=='player'||battleOver) return;
    if(enemyBoardState.status[r][c]!=='unknown') return;
    stats.shots++;
    const shipId = enemyBoardState.occupancy[r][c];
    if(shipId){
      enemyBoardState.status[r][c]='hit'; stats.hits++;
      const ship = aiShips.find(s=>s.id===shipId); ship.hits++;
      markCell(enemyCellsEls, r, c, 'hit'); playSound('hit');
      if(ship.hits===ship.size){
        ship.sunk=true; markShipSunkCells(enemyCellsEls, ship); paintShip(enemyBoardEl, enemyCellsEls, ship, enemyShipImgs);
        toast('Coulé : '+ship.name); pushJournal('Vous', coordLabel(r,c), 'sunk', ship.name); playSound('sunk');
      } else pushJournal('Vous', coordLabel(r,c), 'hit');
      renderFleetRow(enemyFleetRow, aiShips);
      if(aiShips.every(s=>s.sunk)){ endGameAI(true); return; }
    } else {
      enemyBoardState.status[r][c]='miss'; markCell(enemyCellsEls, r, c, 'miss'); playSound('miss');
      pushJournal('Vous', coordLabel(r,c), 'miss');
    }
    stats.turns++; turn='ai'; updateBanner('wait', "Tour de l'IA");
    setTimeout(aiTurn, 700);
  }

  function aiTurn(){
    if(battleOver) return;
    updateBanner('thinking', "L'IA calcule...");
    setTimeout(()=>{
      const sizes = playerShips.filter(s=>!s.sunk).map(s=>s.size);
      const prob = computeProbabilityGrid(playerBoard.status, sizes);
      let best=[], bestVal=-1;
      for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++){
        if(playerBoard.status[r][c]==='unknown'){
          if(prob[r][c]>bestVal){ bestVal=prob[r][c]; best=[[r,c]]; }
          else if(prob[r][c]===bestVal) best.push([r,c]);
        }
      }
      if(best.length===0){ turn='player'; updateBanner('mine'); return; }
      const [r,c] = best[Math.floor(Math.random()*best.length)];
      const shipId = playerBoard.occupancy[r][c];
      if(shipId){
        playerBoard.status[r][c]='hit';
        const ship = playerShips.find(s=>s.id===shipId); ship.hits++;
        markCell(ownCellsEls, r, c, 'hit'); playSound('hit');
        if(ship.hits===ship.size){
          ship.sunk=true; markShipSunkCells(ownCellsEls, ship);
          if(ownShipImgs[ship.id]) ownShipImgs[ship.id].classList.add('sunk-tint');
          toast("L'IA a coulé votre "+ship.name); pushJournal('IA', coordLabel(r,c), 'sunk', ship.name); playSound('sunk');
        } else pushJournal('IA', coordLabel(r,c), 'hit');
        if(playerShips.every(s=>s.sunk)){ endGameAI(false); return; }
      } else {
        playerBoard.status[r][c]='miss'; markCell(ownCellsEls, r, c, 'miss'); playSound('miss');
        pushJournal('IA', coordLabel(r,c), 'miss');
      }
      turn='player'; updateBanner('mine');
    }, 600);
  }

  function endGameAI(won){
    battleOver=true;
    const acc = stats.shots? Math.round(stats.hits/stats.shots*100):0;
    endStats.innerHTML = `
      <div class="end-stat"><b>${stats.shots}</b><span>Tirs</span></div>
      <div class="end-stat"><b>${acc}%</b><span>Précision</span></div>
      <div class="end-stat"><b>${stats.turns}</b><span>Tours</span></div>`;
    endOverlay.classList.toggle('lose', !won);
    endEmoji.textContent = won?'🏆':'💥';
    endTitle.textContent = won?'Victoire':'Défaite';
    endOverlay.classList.remove('hidden');
    playSound(won?'win':'lose');
  }

  playAIBtn.addEventListener('click', ()=>{
    mode='ai';
    resetPlacement();
    showScreen(placeScreen);
    ensureAudio(); startAmbient();
  });

  // ============================================================
  //  MODE MULTIJOUEUR (Socket.IO — serveur autoritaire)
  // ============================================================
  let mode = null; // 'ai' | 'multi'
  const socket = io({ autoConnect:false });
  let matchId=null, mySlot=null, opponentInfo=null, matchFinished=false;
  let revealedEnemyShips = {}; // ship_id -> ship-like object (pour repositionnement au resize)
  let socketConnected = false;

  function ensureSocket(){
    if(!socketConnected){ socket.connect(); socketConnected=true; }
  }

  playMultiBtn.addEventListener('click', ()=>{
    mode='multi'; matchFinished=false;
    ensureSocket(); ensureAudio(); startAmbient();
    showScreen(queueScreen);
    socket.emit('queue_join');
  });
  cancelQueueBtn.addEventListener('click', ()=>{
    socket.emit('queue_leave');
    showScreen(onboard);
  });

  socket.on('queue_status', (data)=>{ /* pourrait afficher une position dans la file */ });

  socket.on('match_found', (data)=>{
    matchId = data.match_id; mySlot = data.you; opponentInfo = data.opponent;
    document.getElementById('oppName').textContent = opponentInfo.name;
    document.getElementById('oppMmr').textContent = opponentInfo.mmr + ' MMR';
    document.getElementById('oppAvatar').src = opponentInfo.avatar_url || '';
    document.getElementById('oppRankBadge').src = opponentInfo.rank.badge;
    showScreen(matchFoundScreen);
  });

  proceedPlacementBtn.addEventListener('click', ()=>{
    resetPlacement();
    showScreen(placeScreen);
  });

  socket.on('error_msg', (data)=> toast(data.message));

  socket.on('opponent_ready', ()=> toast("L'adversaire a placé sa flotte"));

  socket.on('placement_ack', ()=>{
    startBattleBtn.disabled = true;
    startBattleBtn.textContent = "En attente de l'adversaire...";
  });

  socket.on('battle_start', (data)=>{
    startBattleBtn.textContent = 'Lancer la bataille';
    playerShips = placedShips;
    revealedEnemyShips = {}; enemyShipImgs = {};
    ownCellsEls = buildBoard(ownBoardEl, document.getElementById('colLabelsRow3'), document.getElementById('rowLabelsCol3'), document.getElementById('spacer3'));
    enemyCellsEls = buildBoard(enemyBoardEl, document.getElementById('colLabelsRow2'), document.getElementById('rowLabelsCol2'), document.getElementById('spacer2'));
    enemyBoardTitle.textContent = 'Flotte de ' + (opponentInfo ? opponentInfo.name : 'l\'adversaire');
    const genericFleet = SHIP_DEFS.map(d=>({ name:'???', size:null, sunk:false, _id:d.id }));
    renderFleetRow(enemyFleetRow, genericFleet);
    journal = [];
    updateBanner(data.your_turn?'mine':'wait', data.your_turn?'À vous de tirer':"Tour de l'adversaire");
    showScreen(battleScreen);
  });

  enemyBoardEl.addEventListener('click', (e)=>{
    if(mode!=='multi') return;
    const el = e.target.closest('.cell'); if(!el) return;
    const r=parseInt(el.dataset.r,10), c=parseInt(el.dataset.c,10);
    if(el.classList.contains('hit')||el.classList.contains('miss')||el.classList.contains('sunk')) return;
    socket.emit('fire', { match_id: matchId, r, c });
  });

  socket.on('fire_result', (data)=>{
    if(mode!=='multi') return;
    const iAmShooter = data.shooter === mySlot;
    const cellsEls = iAmShooter ? enemyCellsEls : ownCellsEls;
    const actor = iAmShooter ? 'Vous' : (opponentInfo ? opponentInfo.name.slice(0,6) : 'Adv.');

    if(data.result==='hit'){
      markCell(cellsEls, data.r, data.c, 'hit'); playSound('hit');
      if(data.sunk){
        const cells = data.sunk_cells.map(([r,c])=>({r,c}));
        const shipObj = { id:data.ship_id, name:data.ship_name, size:cells.length,
          orientation: inferOrientation(data.sunk_cells), cells, sunk:true };
        markShipSunkCells(cellsEls, shipObj);
        if(iAmShooter){
          revealedEnemyShips[data.ship_id] = shipObj;
          paintShip(enemyBoardEl, enemyCellsEls, shipObj, enemyShipImgs);
          const genericFleet = SHIP_DEFS.map(d=>{
            const revealed = revealedEnemyShips[d.id];
            return revealed ? { name: revealed.name, size: revealed.size, sunk:true } : { name:'???', size:null, sunk:false };
          });
          renderFleetRow(enemyFleetRow, genericFleet);
          toast('Coulé : '+data.ship_name);
        } else {
          const ownShip = playerShips.find(s=>s.id===data.ship_id);
          if(ownShip){ ownShip.sunk=true; if(ownShipImgs[ownShip.id]) ownShipImgs[ownShip.id].classList.add('sunk-tint'); }
          toast("L'adversaire a coulé votre "+data.ship_name);
        }
        pushJournal(actor, coordLabel(data.r,data.c), 'sunk', data.ship_name);
        playSound('sunk');
      } else {
        pushJournal(actor, coordLabel(data.r,data.c), 'hit');
      }
    } else {
      markCell(cellsEls, data.r, data.c, 'miss'); playSound('miss');
      pushJournal(actor, coordLabel(data.r,data.c), 'miss');
    }
  });

  socket.on('turn_update', (data)=>{
    updateBanner(data.your_turn?'mine':'wait', data.your_turn?'À vous de tirer':"Tour de l'adversaire");
  });

  socket.on('opponent_left', ()=> toast("L'adversaire a quitté la partie"));

  socket.on('game_over', (data)=>{
    matchFinished = true;
    const iWon = data.winner_slot === mySlot;
    endStats.innerHTML = `
      <div class="end-stat ${iWon?'mmr-up':'mmr-down'}"><b>${iWon? '+'+data.mmr_change_winner : data.mmr_change_loser}</b><span>MMR</span></div>
      <div class="end-stat"><b>${data.your_new_mmr}</b><span>Nouveau MMR</span></div>
      <div class="end-stat"><b>${data.rank.name}</b><span>Rang</span></div>`;
    endOverlay.classList.toggle('lose', !iWon);
    endEmoji.textContent = iWon?'🏆':'💥';
    endTitle.textContent = iWon?'Victoire':'Défaite';
    endOverlay.classList.remove('hidden');
    playSound(iWon?'win':'lose');
    refreshMe();
  });

  startBattleBtn.addEventListener('click', ()=>{
    if(unplaced.length>0) return;
    ensureAudio(); startAmbient();

    if(mode==='multi'){
      const payload = placedShips.map(s=>({ id:s.id, r:s.cells[0].r, c:s.cells[0].c, orientation:s.orientation }));
      socket.emit('place_ships', { match_id: matchId, ships: payload });
      return;
    }

    // --- mode entraînement (IA) ---
    playerBoard = { occupancy: occupancy, status: makeEmptyStatus() };
    playerShips = placedShips;
    const aiOccupancy = makeEmptyOccupancy();
    aiShips = randomPlaceShips(aiOccupancy, SHIP_DEFS);
    enemyBoardState = { occupancy: aiOccupancy, status: makeEmptyStatus() };
    ownCellsEls = buildBoard(ownBoardEl, document.getElementById('colLabelsRow3'), document.getElementById('rowLabelsCol3'), document.getElementById('spacer3'));
    enemyCellsEls = buildBoard(enemyBoardEl, document.getElementById('colLabelsRow2'), document.getElementById('rowLabelsCol2'), document.getElementById('spacer2'));
    enemyBoardTitle.textContent = 'Flotte ennemie';
    renderFleetRow(enemyFleetRow, aiShips);
    turn='player'; battleOver=false; stats={shots:0,hits:0,turns:0}; journal=[];
    updateBanner('mine');
    showScreen(battleScreen);
  });

  enemyBoardEl.addEventListener('click', (e)=>{
    if(mode!=='ai') return;
    const el = e.target.closest('.cell'); if(!el) return;
    aiFirePlayer(parseInt(el.dataset.r,10), parseInt(el.dataset.c,10));
  });

  replayBtn.addEventListener('click', ()=>{ endOverlay.classList.add('hidden'); resetToMenu(); });

  function resetToMenu(){
    mode=null; matchId=null; mySlot=null; opponentInfo=null;
    showScreen(onboard);
  }

  // ============================================================
  //  CLASSEMENT
  // ============================================================
  async function openLeaderboard(){
    showScreen(leaderboardScreen);
    leaderboardList.innerHTML = '<div class="empty-state">Chargement...</div>';
    try{
      const res = await fetch('/api/leaderboard');
      const list = await res.json();
      if(list.length===0){ leaderboardList.innerHTML='<div class="empty-state">Aucun joueur classé pour le moment.</div>'; return; }
      leaderboardList.innerHTML = list.map((u,i)=>`
        <div class="lbRow ${me && u.id===me.id ? 'me':''}">
          <div class="pos">#${i+1}</div>
          <img class="avatar" src="${u.avatar_url||''}" alt="">
          <div class="name">${u.name}</div>
          <img class="rankBadge" src="${u.rank.badge}" alt="">
          <div class="mmr">${u.mmr}</div>
        </div>`).join('');
    }catch(e){
      leaderboardList.innerHTML = '<div class="empty-state">Erreur de chargement.</div>';
    }
  }
  leaderboardBtn.addEventListener('click', openLeaderboard);

  // ---------- init ----------
  placeCellsEls = buildBoard(placeBoardEl, document.getElementById('colLabelsRow'), document.getElementById('rowLabelsCol'), document.getElementById('spacer1'));
  renderTray();
  showScreen(onboard);

})();
