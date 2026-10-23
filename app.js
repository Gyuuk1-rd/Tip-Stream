/* ============================================================
   TipStream - app.js
   All UI data (supporters, tips) is stored in the browser using
   localStorage. Think of localStorage as a tiny database that
   survives page refreshes. Data is stored as JSON strings.
   Payment records live on the server (orders.json) — the browser
   only keeps the original tx hash for recovery.
   ============================================================ */

// ---------- DATA LAYER ----------
// Load saved data from localStorage, or start empty if none exists.
// JSON.parse turns the stored text back into real arrays/objects.
let supporters = JSON.parse(localStorage.getItem('supporters')) || [];
let tips = JSON.parse(localStorage.getItem('tips')) || [];
let nextTipNumber = parseInt(localStorage.getItem('nextTipNumber')) || 1;

// Save current data back into localStorage as JSON text.
function saveData() {
  localStorage.setItem('supporters', JSON.stringify(supporters));
  localStorage.setItem('tips', JSON.stringify(tips));
  localStorage.setItem('nextTipNumber', nextTipNumber);
}

// ---------- HELPERS ----------
// Format an XLM amount, e.g. 20 -> "20", 18.5 -> "18.5" (no float math on stroops — display only).
function xlm(amount) {
  return Number(amount).toLocaleString('en-US', { maximumFractionDigits: 7 });
}

// A tip's date for display: 'YYYY-MM-DD' from its creation timestamp.
function tipDay(tip) {
  return (tip.createdAt || '').slice(0, 10) || '—';
}

// Work out the status of a tip based on payment activity.
function getTipStatus(tip) {
  if (tip.paid) return 'paid';
  // Payment activity exists but no terminal outcome yet (submitted/pending/verifying).
  const rec = getPaymentRecord(tip.id);
  if (rec && !['verified', 'failed', 'expired'].includes(rec.status)) return 'paying';
  return 'open';
}

// ---------- CELEBRATION CONFETTI (decorative) ----------
// Spawns a small burst of heart/coin SVGs that float up from an anchor
// element when a tip is confirmed. Fully defensive: never throws, and it
// never touches payment state.
function tsConfetti(anchorEl) {
  try {
    const rect = anchorEl && typeof anchorEl.getBoundingClientRect === 'function'
      ? anchorEl.getBoundingClientRect()
      : null;
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;

    let layer = document.querySelector('.ts-confetti');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'ts-confetti';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }

    const colors = ['#ec4899', '#22d3ee', '#f9a8d4', '#a5f3fc'];
    const HEART = c => `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="${c}"/></svg>`;
    const COIN = c => `<svg viewBox="0 0 20 20" width="16" height="16"><circle cx="10" cy="10" r="9" fill="${c}"/></svg>`;

    for (let i = 0; i < 14; i++) {
      const piece = document.createElement('span');
      piece.className = 'ts-confetti-piece';
      piece.innerHTML = i % 2 ? HEART(colors[i % colors.length]) : COIN(colors[(i + 1) % colors.length]);
      piece.style.left = `${cx + (Math.random() - 0.5) * (rect ? rect.width : 140)}px`;
      piece.style.top = `${cy}px`;
      piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 240}px`);
      piece.style.setProperty('--dy', `${-(90 + Math.random() * 170)}px`);
      piece.style.setProperty('--rot', `${(Math.random() - 0.5) * 140}deg`);
      piece.style.animationDelay = `${Math.random() * 0.3}s`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 2800);
    }
    setTimeout(() => { if (layer && !layer.childElementCount) layer.remove(); }, 3200);
  } catch { /* decorative only — never break a payment flow */ }
}

// ---------- SUPPORTERS ----------
const supporterForm = document.getElementById('supporter-form');

supporterForm.addEventListener('submit', e => {
  e.preventDefault(); // stop the page from reloading on submit

  const supporter = {
    id: Date.now(), // simple unique id: current timestamp
    name: document.getElementById('supporter-name').value.trim(),
    note: document.getElementById('supporter-note').value.trim()
  };

  if (!supporter.name) return; // name is required

  supporters.push(supporter);
  saveData();
  supporterForm.reset(); // clear the form
  renderAll();
});

function deleteSupporter(id) {
  // Stop if this supporter still has tips (would leave orphan data).
  const hasTips = tips.some(t => t.supporterId === id);
  if (hasTips) {
    alert('This supporter has tips. Delete their tips first.');
    return;
  }
  if (!confirm('Delete this supporter?')) return;
  supporters = supporters.filter(s => s.id !== id);
  saveData();
  renderAll();
}

function renderSupporters() {
  const tbody = document.querySelector('#supporters-table tbody');
  tbody.innerHTML = '';

  if (supporters.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">No supporters yet — add your first one above.</td></tr>';
  }

  supporters.forEach(s => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${s.name}</td>
      <td>${s.note || '—'}</td>
      <td><button class="btn-delete" onclick="deleteSupporter(${s.id})">Delete</button></td>
    `;
    tbody.appendChild(row);
  });

  // Keep the tip form's supporter dropdown in sync with the supporter list.
  const select = document.getElementById('tip-supporter');
  const previous = select.value;
  select.innerHTML = '<option value="">-- Select supporter * --</option>';
  supporters.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.note ? `${s.name} (${s.note})` : s.name;
    select.appendChild(opt);
  });
  if (previous) select.value = previous;
}

// ---------- TIPS ----------
const tipForm = document.getElementById('tip-form');

// Quick-pick amount chips (5 / 10 / 20 / 50) fill the amount input.
document.querySelectorAll('#amount-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('tip-amount').value = chip.dataset.amount;
    document.querySelectorAll('#amount-chips .chip').forEach(c =>
      c.classList.toggle('active', c === chip));
  });
});

// Live character hint under the message input.
document.getElementById('tip-message').addEventListener('input', e => {
  document.getElementById('msg-hint').textContent = `${e.target.value.length} / 120`;
});

tipForm.addEventListener('submit', e => {
  e.preventDefault();

  const supporterId = parseInt(document.getElementById('tip-supporter').value);
  const amount = parseFloat(document.getElementById('tip-amount').value);
  const message = document.getElementById('tip-message').value.trim();
  if (!supporterId || !(amount > 0)) return;

  const tip = {
    id: Date.now(),
    number: nextTipNumber++, // permanent tip numbers — never reused
    supporterId,
    amount,
    message,
    paid: false,
    createdAt: new Date().toISOString()
  };

  tips.push(tip);
  saveData();
  tipForm.reset();
  document.getElementById('msg-hint').textContent = '0 / 120';
  document.querySelectorAll('#amount-chips .chip').forEach(c => c.classList.remove('active'));
  renderAll();
});

function markPaid(id, celebrate) {
  const tip = tips.find(t => t.id === id);
  if (tip && !tip.paid) {
    tip.paid = true;
    saveData();
    renderAll();
    if (celebrate) tsConfetti(document.querySelector('.hero-banner'));
  } else if (tip) {
    renderAll();
  }
}

// ---------- LEADERBOARD (top supporters by paid tips, from real data) ----------
const MEDALS = [
  '<svg class="ts-medal" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#fbbf24"/><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(251,191,36,.45)" stroke-width="3"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(13,11,30,.4)" stroke-width="1.6"/></svg>',
  '<svg class="ts-medal" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#cbd5e1"/><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(203,213,225,.45)" stroke-width="3"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(13,11,30,.35)" stroke-width="1.6"/></svg>',
  '<svg class="ts-medal" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#d97706"/><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(217,119,6,.5)" stroke-width="3"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(13,11,30,.4)" stroke-width="1.6"/></svg>'
];

function renderLeaderboard() {
  const box = document.getElementById('leaderboard');
  // Sum PAID tips per supporter.
  const totals = new Map(); // supporterId -> { name, total }
  tips.forEach(tip => {
    if (!tip.paid) return;
    const sup = supporters.find(s => s.id === tip.supporterId);
    const name = sup ? sup.name : '(deleted supporter)';
    const entry = totals.get(tip.supporterId) || { name, total: 0 };
    entry.total += tip.amount;
    totals.set(tip.supporterId, entry);
  });

  const ranked = [...totals.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  if (ranked.length === 0) {
    box.innerHTML = '<div class="leaderboard-empty">No tips yet — be the first!</div>';
    return;
  }

  box.innerHTML = ranked.map((r, idx) => `
    <div class="leaderboard-row">
      <span class="leaderboard-medal">${MEDALS[idx] || '·'}</span>
      <span class="leaderboard-name">${r.name}</span>
      <span class="leaderboard-amount">${xlm(r.total)} XLM</span>
    </div>`).join('');
}

// ---------- TIP DETAIL VIEW ----------
const viewModal = document.getElementById('view-modal');
const viewModalBody = document.getElementById('view-modal-body');

function closeViewModal() {
  viewModal.hidden = true;
}
document.getElementById('view-modal-close').addEventListener('click', closeViewModal);
viewModal.addEventListener('click', e => { if (e.target === viewModal) closeViewModal(); });

async function viewTip(id) {
  const tip = tips.find(t => t.id === id);
  if (!tip) return;
  const supporter = supporters.find(s => s.id === tip.supporterId);
  const status = getTipStatus(tip);

  // Live split addresses from the server config (public values only).
  let creatorAddr = '—', charityAddr = '—';
  try {
    const config = await (await fetch('/api/config')).json();
    creatorAddr = shortAddr(config.creatorAddress);
    charityAddr = shortAddr(config.charityAddress);
  } catch { /* server offline — leave placeholders */ }

  const creatorShare = (tip.amount * 0.9).toFixed(2);
  const charityShare = (tip.amount * 0.1).toFixed(2);

  document.getElementById('view-modal-title').textContent = `Tip #${tip.number}`;
  viewModalBody.innerHTML = `
    <div class="tip-message">${tip.message ? `"${tip.message}"` : '<i>(no message)</i>'}</div>
    <div class="pay-review">
      <div class="row"><span>Supporter</span><span>${supporter ? supporter.name : '(deleted supporter)'}</span></div>
      <div class="row"><span>Created</span><span>${tipDay(tip)}</span></div>
      <div class="row"><span>Status</span><span><span class="badge ${status}">${status}</span></span></div>
      <div class="row split-freelancer"><span>Creator (90%)</span><span>${creatorShare} XLM → ${creatorAddr}</span></div>
      <div class="row split-community"><span>Charity (10%)</span><span>${charityShare} XLM → ${charityAddr}</span></div>
      <div class="row total"><span>Tip total</span><span>${xlm(tip.amount)} XLM</span></div>
    </div>
    <p class="pay-note">Paying this tip sends ${xlm(tip.amount)} XLM through the 90/10 split — ${creatorShare} to the creator, ${charityShare} to the charity.</p>
    <div class="modal-actions"><button class="btn-cancel" onclick="closeViewModal()">Close</button></div>`;
  viewModal.hidden = false;
}

function deleteTip(id) {
  if (!confirm('Delete this tip?')) return;
  tips = tips.filter(t => t.id !== id);
  clearPaymentRecord(id); // server record persists; browser-side recovery copy goes with the tip
  saveData();
  renderAll();
}

function renderTips() {
  const tbody = document.querySelector('#tips-table tbody');
  tbody.innerHTML = '';

  if (tips.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No tips yet — create your first one above.</td></tr>';
  }

  // Show newest first.
  [...tips].reverse().forEach(tip => {
    const supporter = supporters.find(s => s.id === tip.supporterId);
    const status = getTipStatus(tip);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>#${tip.number}</td>
      <td>${supporter ? supporter.name : '(deleted supporter)'}${tip.message ? `<div class="tip-msg-preview">"${tip.message}"</div>` : ''}</td>
      <td>${xlm(tip.amount)} XLM</td>
      <td><span class="badge ${status}">${status}</span></td>
      <td>
        <button class="btn-view" onclick="viewTip(${tip.id})">View</button>
        ${!tip.paid ? `<button class="btn-pay-xlm" onclick="openPayModal(${tip.id})">Tip with XLM</button>` : ''}
        ${!tip.paid && getPaymentRecord(tip.id) ? `<button class="btn-check-pay" onclick="checkPayment(${tip.id}, true)">Check payment</button>` : ''}
        ${!tip.paid ? `<button class="btn-pay" onclick="markPaid(${tip.id}, true)">Mark received</button>` : ''}
        <button class="btn-delete" onclick="deleteTip(${tip.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ---------- DASHBOARD ----------
function renderDashboard() {
  let earned = 0, pending = 0, week = 0;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;

  tips.forEach(tip => {
    const status = getTipStatus(tip);
    if (status === 'paid') earned += tip.amount;
    else pending += tip.amount;
    if (new Date(tip.createdAt).getTime() >= weekAgo) week += tip.amount;
  });

  document.getElementById('stat-earned').textContent = `${xlm(earned)} XLM`;
  document.getElementById('stat-pending').textContent = `${xlm(pending)} XLM`;
  document.getElementById('stat-week').textContent = `${xlm(week)} XLM`;
}

// ---------- MASTER RENDER ----------
// Re-render every screen from the saved data.
// We call this after any change so the UI always matches the data.
function renderAll() {
  renderSupporters();
  renderTips();
  renderDashboard();
  renderLeaderboard();
}

renderAll(); // initial paint on page load

// Auto-resolve tips left pending in a previous session: if the original
// transaction now verifies on-chain, markPaid fires automatically — the
// tip flips to "received" with no manual "Check payment" click.
(async function autoResolvePendingPayments() {
  const pending = tips.filter(tip => {
    if (tip.paid) return false;
    const rec = getPaymentRecord(tip.id);
    return rec && !['verified', 'failed', 'expired'].includes(rec.status);
  });
  for (const tip of pending) {
    try { await checkPayment(tip.id, false); } catch { /* record kept; retried next load */ }
  }
})();

/* ============================================================
   XLM PAYMENT MODULE (Paiflow guide steps 09–11)

   Flow per tip:
     1. Connect Freighter and read the supporter's public address.
     2. Show an explicit review: TESTNET, amount, 90/10 recipients, fee.
     3. Server prepares the transaction (SDK stays server-side).
     4. Freighter signs the ORIGINAL XDR with the testnet passphrase.
     5. Browser sends the signed envelope to the server's submit route,
        which verifies the body hash before submission.
     6. Server verifies the receipt + payout events; only then is the
        tip marked received. The saved hash powers recovery ("Check payment").
   ============================================================ */

// ---------- Payment records (survive reloads so recovery never loses state) ----------
function getPaymentRecords() {
  return JSON.parse(localStorage.getItem('xlmTipPayments')) || {};
}
function getPaymentRecord(tipId) {
  return getPaymentRecords()[String(tipId)] || null;
}
function savePaymentRecord(tipId, patch) {
  const all = getPaymentRecords();
  all[String(tipId)] = { ...(all[String(tipId)] || {}), ...patch };
  localStorage.setItem('xlmTipPayments', JSON.stringify(all));
}
function clearPaymentRecord(tipId) {
  const all = getPaymentRecords();
  delete all[String(tipId)];
  localStorage.setItem('xlmTipPayments', JSON.stringify(all));
}

// ---------- Modal scaffolding ----------
const payModal = document.getElementById('pay-modal');
const payModalBody = document.getElementById('pay-modal-body');
let payTimer = null; // polling timer, cleared when the modal closes

function closePayModal() {
  payModal.hidden = true;
  if (payTimer) { clearInterval(payTimer); payTimer = null; }
}
document.getElementById('pay-modal-close').addEventListener('click', closePayModal);
payModal.addEventListener('click', e => { if (e.target === payModal) closePayModal(); });

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
}

// ---------- Server API helpers (the API token never reaches the browser) ----------
async function apiPost(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Request failed (${resp.status})`);
    err.code = data?.error?.code;
    err.status = resp.status;
    throw err;
  }
  return data;
}

// ---------- Step 1: open the modal and connect Freighter ----------
async function openPayModal(tipId) {
  const tip = tips.find(t => t.id === tipId);
  if (!tip) return;

  payModal.hidden = false;
  payModalBody.innerHTML = `<div class="pay-status pending">Connecting to Freighter…</div>`;

  if (!window.freighterConnect || !window.freighterConnect.isAvailable()) {
    payModalBody.innerHTML = `<div class="pay-status error">Freighter bridge not loaded. Check vendor/freighter-api.min.js, then reload.</div>`;
    return;
  }

  let supporterAddress;
  try {
    const api = window.freighterApi;
    const connected = api && typeof api.isConnected === 'function'
      ? await api.isConnected()
      : true; // legacy bridges have no isConnected; getAddress will prompt
    if (!connected) throw new Error('Freighter is not connected');
    // Connector unwraps v6 {address}, legacy {publicKey}, or plain string.
    supporterAddress = await window.freighterConnect.getAddress();
  } catch (err) {
    payModalBody.innerHTML = `
      <div class="pay-status error">Could not reach Freighter: ${err.message}</div>
      <p class="pay-note">Unlock Freighter, approve this app's origin (http://localhost:PORT), and make sure Freighter is set to Stellar Testnet.</p>
      <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`;
    return;
  }

  showReview(tip, supporterAddress);
}

// ---------- Step 2: explicit payment review ----------
async function showReview(tip, supporterAddress) {
  const amountXlm = tip.amount.toFixed(2);
  let config;
  try {
    config = await (await fetch('/api/config')).json();
  } catch {
    payModalBody.innerHTML = `<div class="pay-status error">Payment server unreachable. Start it with <b>npm start</b> and reload.</div>`;
    return;
  }

  payModalBody.innerHTML = `
    <div class="pay-review">
      <div class="row"><span>Network</span><span>${config.network.toUpperCase()}</span></div>
      <div class="row"><span>Tip</span><span>#${tip.number}${tip.message ? ` — "${tip.message}"` : ''}</span></div>
      <div class="row"><span>Supporter wallet</span><span>${shortAddr(supporterAddress)}</span></div>
      <div class="row split-freelancer"><span>Creator (90%)</span><span>${(amountXlm * 0.9).toFixed(2)} XLM → ${shortAddr(config.creatorAddress)}</span></div>
      <div class="row split-community"><span>Charity (10%)</span><span>${(amountXlm * 0.1).toFixed(2)} XLM → ${shortAddr(config.charityAddress)}</span></div>
      <div class="row total"><span>Total tip</span><span>${amountXlm} XLM</span></div>
      <div class="row"><span>Network fee</span><span>Small XLM fee, shown by Freighter</span></div>
    </div>
    <p class="pay-note">Review the network, amount, recipients and fee in Freighter before approving. Testnet funds have no real value.</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closePayModal()">Cancel</button>
      <button class="btn-sign" id="btn-approve-pay">Approve &amp; prepare tip</button>
    </div>
    <div id="pay-status-slot"></div>`;

  document.getElementById('btn-approve-pay').addEventListener('click', () =>
    prepareAndSign(tip, supporterAddress, amountXlm)
  );
}

// ---------- Step 3–4: server prepares; Freighter signs the original XDR ----------
async function prepareAndSign(tip, supporterAddress, amountXlm) {
  const btn = document.getElementById('btn-approve-pay');
  const slot = document.getElementById('pay-status-slot');
  btn.disabled = true;
  slot.innerHTML = `<div class="pay-status pending">Preparing transaction (server)…</div>`;

  let prep;
  try {
    prep = await apiPost('/api/checkout/prepare', {
      tipId: tip.id,
      amountXlm,
      supporterAddress
    });
  } catch (err) {
    if (err.code === 'PREPARATION_EXPIRED') {
      // Retain the record; do not silently prepare a replacement.
      slot.innerHTML = `<div class="pay-status error">The previous preparation expired. Use <b>Check payment</b> on the tip, or contact support with the tip number — do not pay again blindly.</div>`;
    } else {
      slot.innerHTML = `<div class="pay-status error">Preparation failed: ${err.message}</div>`;
    }
    btn.disabled = false;
    return;
  }

  slot.innerHTML = `<div class="pay-status pending">Confirm the transaction in Freighter…</div>`;

  let signedXdr;
  try {
    // Sign the ORIGINAL unsigned XDR with the preparation's passphrase.
    signedXdr = await window.freighterConnect.signTransaction(prep.unsignedXdr, {
      networkPassphrase: prep.networkPassphrase
    });
  } catch (err) {
    slot.innerHTML = `<div class="pay-status error">Signing was cancelled or failed (${err.message}). The preparation is saved — use <b>Check payment</b> to recover instead of starting over.</div>`;
    btn.disabled = false;
    return;
  }

  slot.innerHTML = `<div class="pay-status pending">Submitting signed transaction…</div>`;

  // ---------- Step 5: submit through the server ----------
  let submitted;
  try {
    submitted = await apiPost('/api/checkout/submit', { tipId: tip.id, signedXdr });
  } catch (err) {
    if (err.code === 'SUBMIT_UNCERTAIN' || err.code === 'ENVELOPE_MISMATCH') {
      slot.innerHTML = `<div class="pay-status error">${err.message}. The original record is retained — use <b>Check payment</b> before trying anything else.</div>`;
    } else {
      slot.innerHTML = `<div class="pay-status error">Submission failed: ${err.message}. Use <b>Check payment</b> to recover the original transaction.</div>`;
    }
    btn.disabled = false;
    return;
  }

  savePaymentRecord(tip.id, { txHash: submitted.txHash, status: 'submitted', checkedAt: new Date().toISOString() });
  renderAll();
  showPending(tip, submitted.txHash);
}

// ---------- Step 6: wait for verification before marking received ----------
function showPending(tip, txHash) {
  const expertUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  payModalBody.innerHTML = `
    <div class="pay-status pending">
      Tip submitted.<br>Transaction: <a href="${expertUrl}" target="_blank" rel="noopener">${shortAddr(txHash)}</a><br>
      Waiting for on-chain confirmation and payout verification…
    </div>
    <div id="pay-status-slot"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closePayModal()">Close (auto-check continues in background)</button>
      <button class="btn-sign" onclick="checkPayment(${tip.id}, true)">Check payment now</button>
    </div>`;

  // Poll until a terminal state (received / failed / expired) or ~5 minutes.
  // Stellar event feeds can lag well past the first confirmation.
  let attempts = 0;
  if (payTimer) clearInterval(payTimer);
  payTimer = setInterval(async () => {
    attempts++;
    const done = await checkPayment(tip.id, false); // marks received automatically when verified
    if (done || attempts >= 60) {
      clearInterval(payTimer); payTimer = null;
      if (!done && !tips.find(t => t.id === tip.id)?.paid) {
        // Out of polling budget without a terminal state — leave the record
        // pending; the next page load's auto-resolve sweep will pick it up.
        renderAll();
      }
    }
  }, 5000);
}

// ---------- Step 11: check / recover the ORIGINAL transaction ----------
async function checkPayment(tipId, showInModal) {
  const tip = tips.find(t => t.id === tipId);
  if (!tip) return true;

  if (showInModal) {
    payModal.hidden = false;
    payModalBody.innerHTML = `<div class="pay-status pending">Checking the original transaction…</div>`;
    if (payTimer) { clearInterval(payTimer); payTimer = null; }
  }

  let status;
  try {
    status = await (await fetch(`/api/checkout/status/${tipId}`)).json();
    // The server's tip store predates this payment (e.g. before persistent
    // storage) — fall back to verifying by the original hash the browser kept.
    if (status?.error?.code === 'ORDER_NOT_FOUND') {
      const rec = getPaymentRecord(tipId);
      if (rec?.txHash) {
        const vt = await (await fetch('/api/checkout/verify-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: rec.txHash, amountXlm: tip.amount.toFixed(2) })
        })).json();
        if (vt?.state === 'submitted') status = vt;
      }
    }
  } catch {
    status = { state: 'error', detail: 'Payment server unreachable' };
  }

  const slot = document.getElementById('pay-status-slot');
  const render = html => {
    if (showInModal) {
      payModalBody.innerHTML = html;
    } else if (slot) {
      slot.innerHTML = html;
    }
  };

  // Recovery table from guide step 11:
  switch (status.state) {
    case 'created':
    case 'prepared':
      render(`<div class="pay-status pending">A preparation exists but no signed transaction was submitted yet.
        Return to the tip and finish the payment before it expires (${status.review?.preparationTtlRemaining ?? '?'}s left).</div>
        <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`);
      return false;

    case 'preparation_expired':
      render(`<div class="pay-status error">The preparation expired. Do NOT start a new payment blindly — an error never proves nothing was sent. Contact support with the tip number and deployment UUID.</div>
        <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`);
      return true;

    case 'submitted':
      if (status.verified) {
        savePaymentRecord(tipId, { txHash: status.txHash, status: 'verified', checkedAt: new Date().toISOString() });
        if (!tip.paid) {
          markPaid(tip.id); // only now is the tip fulfilled
          // Celebrate on user-driven confirmations (modal open / button click),
          // not on the silent page-load auto-resolve sweep.
          if (showInModal || (payModal && !payModal.hidden)) {
            tsConfetti(payModal && !payModal.hidden ? payModal.querySelector('.modal-card') : document.body);
          }
        }
        render(`<div class="pay-status success">✅ Tip confirmed and verified on testnet:<br>
          ${status.expectedPayouts.creatorXlm} XLM → creator, ${status.expectedPayouts.charityXlm} XLM → charity.<br>
          <a href="https://stellar.expert/explorer/testnet/tx/${status.txHash}" target="_blank" rel="noopener">View transaction</a></div>
          <div class="modal-actions"><button class="btn-sign" onclick="closePayModal()">Done</button></div>`);
        return true;
      }
      if (status.status === 'SUCCESS') {
        // On chain but payout evidence incomplete — check again, do not re-pay.
        savePaymentRecord(tipId, { txHash: status.txHash, status: 'verifying', checkedAt: new Date().toISOString() });
        render(`<div class="pay-status pending">Transaction succeeded (${status.status}) but payout evidence is still incomplete (events seen: ${status.eventsSeen}). Indexed feeds can lag — auto-check continues in the background. Do not create another payment.</div>
          <div class="modal-actions"><button class="btn-sign" onclick="checkPayment(${tipId}, true)">Check again</button></div>`);
        return false;
      }
      if (status.status === 'FAILED') {
        savePaymentRecord(tipId, { txHash: status.txHash, status: 'failed', checkedAt: new Date().toISOString() });
        render(`<div class="pay-status error">Transaction <a href="https://stellar.expert/explorer/testnet/tx/${status.txHash}" target="_blank" rel="noopener">${shortAddr(status.txHash)}</a> FAILED. Keep this record and fix the cause before a deliberate new attempt — never auto-retry.</div>
          <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`);
        return true;
      }
      // PENDING / UNKNOWN / etc.
      savePaymentRecord(tipId, { txHash: status.txHash, status: 'pending', checkedAt: new Date().toISOString() });
      render(`<div class="pay-status pending">Transaction ${status.txHash ? `<a href="https://stellar.expert/explorer/testnet/tx/${status.txHash}" target="_blank" rel="noopener">${shortAddr(status.txHash)}</a>` : ''} is ${status.status ?? 'PENDING'}. An error or pending state never proves nothing was broadcast — keep the original record and check again.</div>
        <div class="modal-actions"><button class="btn-sign" onclick="checkPayment(${tipId}, true)">Check again</button></div>`);
      return false;

    case 'unknown':
    default:
      render(`<div class="pay-status error">Finality could not be established${status.detail ? `: ${status.detail}` : ''}. The original payment record is retained — do not reset the tip or pay again. Contact support with the deployment UUID and transaction hash.</div>
        <div class="modal-actions"><button class="btn-sign" onclick="checkPayment(${tipId}, true)">Check again</button></div>`);
      return false;
  }
}

/* ============================================================
   IMPACT DASHBOARD + ACTIVITY FEED
   Live "follow the money" totals and a chat-style tip feed, both
   refreshed automatically every 10 seconds (matching the demo
   storefront pattern; feeds can lag behind the ledger).
   ============================================================ */
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Next creator goal: the smallest round goal the total hasn't reached yet.
const GOAL_STEPS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
function nextGoal(totalXlm) {
  const t = Number(totalXlm) || 0;
  const goal = GOAL_STEPS.find(g => t < g) || GOAL_STEPS[GOAL_STEPS.length - 1] * 2;
  const pct = Math.min(100, Math.round((t / goal) * 100));
  return { goal, pct };
}

async function refreshImpact() {
  try {
    const data = await (await fetch('/api/impact')).json();
    if (!data || data.error) return;

    document.getElementById('impact-freelancer-total').textContent = data.creator.totalXlm;
    document.getElementById('impact-community-total').textContent = data.charity.totalXlm;
    document.getElementById('impact-combined').textContent = data.combinedXlm;
    document.getElementById('impact-freelancer-addr').textContent = shortAddr(data.creator.address);
    document.getElementById('impact-community-addr').textContent = shortAddr(data.charity.address);

    const creatorGoal = nextGoal(data.creator.totalXlm);
    const charityGoal = nextGoal(data.charity.totalXlm);
    document.getElementById('impact-freelancer-bar').style.width = `${creatorGoal.pct}%`;
    document.getElementById('impact-community-bar').style.width = `${charityGoal.pct}%`;
    document.getElementById('impact-freelancer-milestone').textContent =
      `Next goal: ${creatorGoal.goal} XLM · ${creatorGoal.pct}% there`;
    document.getElementById('impact-community-milestone').textContent =
      `Next goal: ${charityGoal.goal} XLM · ${charityGoal.pct}% there`;
    document.getElementById('impact-updated').textContent = `last update ${timeAgo(data.updatedAt)}`;
  } catch { /* keep previous values on transient errors */ }
}

async function refreshActivity() {
  const feed = document.getElementById('activity-feed');
  try {
    const data = await (await fetch('/api/activity')).json();
    const items = data?.items ?? [];
    if (items.length === 0) {
      feed.innerHTML = '<div class="chat-empty">No tips recorded yet — send a tip with XLM to see it here.</div>';
      return;
    }
    feed.innerHTML = items.map(it => {
      // Enrich the server record with the supporter name + message the
      // browser holds, so each entry reads like a chat message.
      const tip = tips.find(t => String(t.id) === String(it.tipId));
      const sup = tip && supporters.find(s => s.id === tip.supporterId);
      const name = sup ? sup.name : shortAddr(it.supporterAddress);
      const initial = (name[0] || '?').toUpperCase();
      const message = tip?.message;
      return `
      <div class="chat-item">
        <span class="chat-avatar">${initial}</span>
        <div class="chat-body">
          <div class="chat-head">
            <span class="chat-name">${name}</span>
            <span class="chat-time">${timeAgo(it.at)}</span>
          </div>
          <div class="chat-bubble">${message ? `"${message}"` : '<i>(no message)</i>'}</div>
          <div class="chat-meta">
            Tip ${it.tipId}
            ${it.txHash
              ? `· <a href="https://stellar.expert/explorer/testnet/tx/${it.txHash}" target="_blank" rel="noopener">${shortAddr(it.txHash)}</a>`
              : '· preparation only'}
            ${it.payouts
              ? `<span class="feed-split f">${it.payouts.creatorXlm} → creator</span><span class="feed-split c">${it.payouts.charityXlm} → charity</span>`
              : ''}
          </div>
        </div>
        <span class="chat-amount">${it.amountXlm} XLM</span>
      </div>`;
    }).join('');
  } catch {
    // Leave the last good render in place; the next 10s tick retries.
  }
}

refreshImpact();
refreshActivity();
setInterval(() => { refreshImpact(); refreshActivity(); }, 10_000);
