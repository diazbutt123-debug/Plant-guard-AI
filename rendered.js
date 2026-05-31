const { ipcRenderer } = require('electron');

const API = 'http://127.0.0.1:5000';
let serverOnline = false;
let scanHistory  = [];
let currentImage = null;

const TREATMENTS = {
  healthy:   'Plant appears healthy. Maintain regular watering and fertilization.',
  blight:    'Apply copper-based fungicide. Remove infected leaves. Improve air circulation.',
  rust:      'Apply sulfur-based fungicide. Avoid overhead watering. Remove infected material.',
  mold:      'Improve ventilation and reduce humidity. Apply chlorothalonil-based fungicide.',
  spot:      'Apply mancozeb fungicide. Water at base only — avoid wetting leaves.',
  bacterial: 'Apply copper bactericide. Remove infected tissue. Avoid handling when wet.',
  virus:     'No chemical cure. Remove infected plants. Control insect vectors.',
  mite:      'Apply neem oil or miticide. Increase humidity. Remove heavily infested leaves.',
  default:   'Isolate affected plant. Consult an agronomist for proper diagnosis.'
};

function getTreatment(label) {
  const l = label.toLowerCase();
  if (l.includes('healthy'))                                         return TREATMENTS.healthy;
  if (l.includes('blight'))                                          return TREATMENTS.blight;
  if (l.includes('rust'))                                            return TREATMENTS.rust;
  if (l.includes('mold'))                                            return TREATMENTS.mold;
  if (l.includes('spot'))                                            return TREATMENTS.spot;
  if (l.includes('bacterial'))                                       return TREATMENTS.bacterial;
  if (l.includes('virus') || l.includes('curl') || l.includes('mosaic')) return TREATMENTS.virus;
  if (l.includes('mite'))                                            return TREATMENTS.mite;
  return TREATMENTS.default;
}

function fmt(s) {
  return s.replace(/_+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || 'Processing...';
  document.getElementById('loadingOverlay').classList.add('visible');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('visible');
}

async function checkServer() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    if (d.status === 'ok') {
      setServerStatus(true, `AI Online · ${d.classes} classes`);
      return true;
    }
  } catch (e) {
    setServerStatus(false, 'Server offline');
  }
  return false;
}

function setServerStatus(online, text) {
  serverOnline = online;
  const el     = document.getElementById('serverStatus');
  const banner = document.getElementById('serverBanner');
  el.className = 'server-status ' + (online ? 'online' : 'offline');
  document.getElementById('serverStatusText').textContent = text;
  banner.className = 'server-banner ' + (online ? 'online hidden' : 'offline');
}

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (el) el.classList.add('active');
  const titles = {
    scan:    'Scan Plant',
    batch:   'Batch Folder',
    history: 'Scan History',
    compare: 'Compare Scans',
    stats:   'Statistics'
  };
  document.getElementById('topbarTitle').textContent = titles[name] || name;
  if (name === 'history') renderHistory();
  if (name === 'stats')   renderStats();
  if (name === 'compare') renderCompareSelects();
}

async function openImageDialog() {
  const r = await ipcRenderer.invoke('open-image-dialog');
  if (r) loadImage(r);
}

async function openFolderDialog() {
  const files = await ipcRenderer.invoke('open-folder-dialog');
  if (!files.length) return;
  const c = document.getElementById('batchResults');
  c.innerHTML = `<div style="color:var(--muted);font-size:13px;grid-column:1/-1;padding:1rem;">Processing ${files.length} images...</div>`;
  for (const f of files) await runAnalysisOnData(f, true);
}

function handleFileInputChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => loadImage({
    base64: ev.target.result.split(',')[1],
    mime:   file.type,
    name:   file.name
  });
  r.readAsDataURL(file);
}

function loadImage(data) {
  currentImage = data;
  document.getElementById('previewImg').src            = `data:${data.mime};base64,${data.base64}`;
  document.getElementById('previewLabel').textContent  = data.name;
  document.getElementById('previewWrap').classList.add('visible');
  document.getElementById('dropZone').style.display    = 'none';
  document.getElementById('resultEmpty').style.display = 'none';
  document.getElementById('resultContent').classList.remove('visible');
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const r = new FileReader();
  r.onload = ev => loadImage({
    base64: ev.target.result.split(',')[1],
    mime:   file.type,
    name:   file.name
  });
  r.readAsDataURL(file);
}

async function runAnalysis() {
  if (!currentImage) { alert('Please select a plant image first.'); return; }
  await runAnalysisOnData(currentImage, false);
}

async function runAnalysisOnData(imageData, isBatch) {
  showLoading('Analyzing plant disease...');
  try {
    const res = await fetch(`${API}/predict`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image: imageData.base64 })
    });

    if (!res.ok) throw new Error('Server error: ' + res.status);

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Prediction failed');

    const result = {
      label:      data.disease,
      confidence: data.confidence,
      top3:       data.top3,
      timestamp:  new Date().toISOString(),
      imageName:  imageData.name,
      imageData:  `data:${imageData.mime};base64,${imageData.base64}`
    };

    if (!isBatch) showResult(result);
    saveToHistory(result);
    if (isBatch)  appendBatchCard(result);

  } catch (err) {
    console.error('Analysis error:', err);
    alert('Error analyzing image: ' + err.message);
  } finally {
    hideLoading();
  }
}

function showResult(r) {
  const isH = r.label.toLowerCase().includes('healthy');
  const c   = Math.round(r.confidence);

  const badge       = document.getElementById('diseaseBadge');
  badge.textContent = (isH ? '✅ ' : '🦠 ') + fmt(r.label);
  badge.className   = 'disease-badge ' + (isH ? 'badge-success' : c > 80 ? 'badge-danger' : 'badge-warning');

  document.getElementById('confPct').textContent = c + '%';

  const fill            = document.getElementById('confFill');
  fill.style.width      = c + '%';
  fill.style.background = isH ? 'var(--green)' : c > 80 ? 'var(--red)' : 'var(--amber)';

  document.getElementById('top3List').innerHTML = r.top3.map(p => `
    <div class="top3-item">
      <div class="top3-name">${fmt(p.label)}</div>
      <div class="top3-bar">
        <div class="top3-fill" style="width:${Math.min(100, Math.round(p.confidence))}%"></div>
      </div>
      <div class="top3-pct">${Math.round(p.confidence)}%</div>
    </div>`).join('');

  document.getElementById('treatmentText').textContent = getTreatment(r.label);
  document.getElementById('scanTimestamp').textContent = '🕐 ' + new Date(r.timestamp).toLocaleString();
  document.getElementById('resultEmpty').style.display = 'none';
  document.getElementById('resultContent').classList.add('visible');
}

function saveToHistory(r) {
  scanHistory.unshift(r);
  ipcRenderer.invoke('save-history', scanHistory);
}

function renderHistory(filter = 'all') {
  const grid  = document.getElementById('historyGrid');
  const items = filter === 'disease' ? scanHistory.filter(s => !s.label.toLowerCase().includes('healthy'))
              : filter === 'healthy' ? scanHistory.filter(s =>  s.label.toLowerCase().includes('healthy'))
              : scanHistory;

  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>No scans found.</p></div>';
    return;
  }

  grid.innerHTML = items.map(s => {
    const isH = s.label.toLowerCase().includes('healthy');
    const c   = Math.round(s.confidence);
    const pc  = isH ? 'pill-success' : c > 80 ? 'pill-danger' : 'pill-warning';
    return `
      <div class="history-card" onclick="viewScan(${scanHistory.indexOf(s)})">
        <img class="history-thumb" src="${s.imageData}" alt="${s.imageName}"
             onerror="this.style.background='var(--bg3)'"/>
        <div class="history-body">
          <div class="history-name">${s.imageName}</div>
          <div class="history-meta">${new Date(s.timestamp).toLocaleString()}</div>
        </div>
        <div class="history-footer">
          <span class="pill ${pc}">${fmt(s.label)}</span>
          <span style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;">${c}%</span>
        </div>
      </div>`;
  }).join('');
}

function filterHistory(type, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHistory(type);
}

function clearHistory() {
  if (!confirm('Clear all scan history?')) return;
  scanHistory = [];
  ipcRenderer.invoke('save-history', []);
  renderHistory();
}

function viewScan(i) {
  const s = scanHistory[i];
  showPage('scan', document.querySelectorAll('.nav-item')[0]);
  loadImage({ base64: s.imageData.split(',')[1], mime: 'image/jpeg', name: s.imageName });
  showResult(s);
}

function renderCompareSelects() {
  const opts = scanHistory.map((s, i) =>
    `<option value="${i}">${s.imageName} — ${new Date(s.timestamp).toLocaleDateString()}</option>`
  ).join('');
  document.getElementById('compareA').innerHTML = '<option value="">— Select scan A (earlier) —</option>' + opts;
  document.getElementById('compareB').innerHTML = '<option value="">— Select scan B (later) —</option>'  + opts;
}

function runCompare() {
  const ai = document.getElementById('compareA').value;
  const bi = document.getElementById('compareB').value;
  if (ai === '' || bi === '') { alert('Please select two scans to compare.'); return; }

  const a     = scanHistory[ai];
  const b     = scanHistory[bi];
  const delta = Math.round(b.confidence - a.confidence);
  const same  = a.label === b.label;

  let dc = 'delta-same', dt = 'No change';
  if (!same)           { dc = 'delta-better'; dt = 'Disease changed'; }
  else if (delta > 5)  { dc = 'delta-worse';  dt = `▲ ${delta}% worse`; }
  else if (delta < -5) { dc = 'delta-better'; dt = `▼ ${Math.abs(delta)}% better`; }

  document.getElementById('compareResult').innerHTML = `
    <div class="compare-grid">
      <div class="compare-col">
        <div class="compare-head">Scan A — Earlier</div>
        <img src="${a.imageData}" style="width:100%;height:140px;object-fit:cover;border-radius:8px;margin-bottom:8px;"/>
        <div style="font-size:13px;font-weight:600;">${fmt(a.label)}</div>
        <div style="font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;">${Math.round(a.confidence)}% confidence</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${new Date(a.timestamp).toLocaleString()}</div>
      </div>
      <div class="compare-col">
        <div class="compare-head">Scan B — Later</div>
        <img src="${b.imageData}" style="width:100%;height:140px;object-fit:cover;border-radius:8px;margin-bottom:8px;"/>
        <div style="font-size:13px;font-weight:600;">${fmt(b.label)}</div>
        <div style="font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;">${Math.round(b.confidence)}% confidence</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${new Date(b.timestamp).toLocaleString()}</div>
      </div>
    </div>
    <div style="margin-top:1rem;padding:12px;background:var(--bg2);border:1px solid var(--border);
                border-radius:var(--radius);display:flex;align-items:center;gap:12px;">
      <span style="font-size:13px;color:var(--muted);">Progression:</span>
      <span class="delta-badge ${dc}">${dt}</span>
      <span style="font-size:12px;color:var(--muted);">
        ${same ? 'Same disease in both scans.' : 'Different disease — review treatment.'}
      </span>
    </div>`;
}

function renderStats() {
  document.getElementById('statTotal').textContent    = scanHistory.length;
  document.getElementById('statDiseased').textContent = scanHistory.filter(s => !s.label.toLowerCase().includes('healthy')).length;
  document.getElementById('statHealthy').textContent  = scanHistory.filter(s =>  s.label.toLowerCase().includes('healthy')).length;

  const avg = scanHistory.length
    ? Math.round(scanHistory.reduce((a, s) => a + s.confidence, 0) / scanHistory.length) + '%'
    : '—';
  document.getElementById('statConf').textContent = avg;

  const freq   = {};
  scanHistory.forEach(s => { freq[s.label] = (freq[s.label] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const max    = sorted[0]?.[1] || 1;

  document.getElementById('diseaseChart').innerHTML = sorted.length
    ? sorted.map(([l, c]) => `
        <div class="bar-row">
          <div class="bar-name">${fmt(l)}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.round(c / max * 100)}%"></div>
          </div>
          <div class="bar-count">${c}</div>
        </div>`).join('')
    : '<div class="empty-state"><p>No data yet.</p></div>';
}

function appendBatchCard(r) {
  const c   = document.getElementById('batchResults');
  const msg = c.querySelector('div[style*="grid-column"]');
  if (msg) msg.remove();

  const isH  = r.label.toLowerCase().includes('healthy');
  const conf = Math.round(r.confidence);
  const pc   = isH ? 'pill-success' : conf > 80 ? 'pill-danger' : 'pill-warning';

  const div     = document.createElement('div');
  div.className = 'history-card';
  div.innerHTML = `
    <img class="history-thumb" src="${r.imageData}" alt="${r.imageName}"/>
    <div class="history-body">
      <div class="history-name">${r.imageName}</div>
      <div class="history-meta">${fmt(r.label)}</div>
    </div>
    <div class="history-footer">
      <span class="pill ${pc}">${isH ? 'Healthy' : 'Diseased'}</span>
      <span style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;">${conf}%</span>
    </div>`;
  c.appendChild(div);
}

window.showPage           = showPage;
window.checkServer        = checkServer;
window.openImageDialog    = openImageDialog;
window.openFolderDialog   = openFolderDialog;
window.handleFileInputChange = handleFileInputChange;
window.handleDragOver     = handleDragOver;
window.handleDragLeave    = handleDragLeave;
window.handleDrop         = handleDrop;
window.runAnalysis        = runAnalysis;
window.filterHistory      = filterHistory;
window.clearHistory       = clearHistory;
window.viewScan           = viewScan;
window.runCompare         = runCompare;

(async () => {
  scanHistory = await ipcRenderer.invoke('load-history');
  for (let i = 0; i < 15; i++) {
    const ok = await checkServer();
    if (ok) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  setInterval(checkServer, 10000);
})();
