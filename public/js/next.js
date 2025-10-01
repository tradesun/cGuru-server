(function() {
  const searchInput = document.getElementById('nextSearch');
  const filterSelect = document.getElementById('priorityFilter');
  const listEl = document.getElementById('actionsList');
  const detailsEl = document.getElementById('detailsPanel');

  let rawItems = [];
  let filteredItems = [];
  let selectedId = null;
  const STATUS_OPTS = ['On Hold','In Progress','Ready to Schedule'];
  let boundClickDelegation = false;
  let hasAppliedSelectParam = false;

  // Simple toast notifications
  function showToast(message, type) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.position = 'fixed';
      container.style.top = '16px';
      container.style.right = '16px';
      container.style.zIndex = '9999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)';
    toast.style.color = '#fff';
    toast.style.fontSize = '14px';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';
    if (type === 'error') {
      toast.style.background = '#DC2626';
    } else if (type === 'warning') {
      toast.style.background = '#D97706';
    } else {
      toast.style.background = '#16A34A';
    }
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 200ms ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  function computeProgressFromAction(action) {
    let pct = 0;
    if (action && typeof action.notes === 'string' && action.notes.trim() !== '') pct += 10; // cap at 10%
    if (action && action.owner_email) pct += 20;
    if (action && action.owner_acknowledged) pct += 20;
    const st = action && action.action_status ? String(action.action_status) : '';
    const countsForTarget = st === 'Assigned' || st === 'Ready' || st === 'Ready to Schedule' || st === 'Postponed';
    if (countsForTarget) pct += 20;
    return pct;
  }

  function updateCardProgress(actionId, action) {
    const li = listEl && listEl.querySelector ? listEl.querySelector(`li[data-id="${String(actionId)}"]`) : null;
    if (!li) return;
    const inner = li.querySelector('.action-progress > div');
    if (!inner) return;
    const pct = computeProgressFromAction(action);
    inner.style.width = `${pct}%`;
  }

  function derivePriorityFromStage(stage) {
    const s = Number(stage);
    if (Number.isFinite(s)) {
      if (s <= 1) return 'High';
      if (s <= 3) return 'Medium';
      return 'Low';
    }
    return 'Medium';
  }

  function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function normalizeCatName(name) {
    if (!name) return '';
    return String(name).replace(/^\s*\d+\.\s*/, '');
  }

  function statusIconSVG(status) {
    if (status === 'In Progress') {
      // Play icon
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    }
    if (status === 'Ready to Schedule') {
      // Clock icon
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    }
    // On Hold: Pause icon
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  }

  function getParam(name) {
    const p = new URLSearchParams(window.location.search);
    return p.get(name);
  }

  async function fetchRecommendations(email) {
    const url = `/api/v1/get_recommendations_for_all_added_actions?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  function applyFilter() {
    const q = (searchInput && searchInput.value ? searchInput.value.toLowerCase().trim() : '');
    const pf = (filterSelect && filterSelect.value ? String(filterSelect.value) : 'All');
    filteredItems = rawItems.filter(it => {
      // priority filter first (using randomized display priority stored on item)
      const pr = it.__priority || 'Medium';
      const priorityOk = (pf === 'All') || (pr === pf);
      if (!priorityOk) return false;
      if (!q) return true;
      const title = (it.recommendation && it.recommendation.action_title ? it.recommendation.action_title : '').toLowerCase();
      const code = (it.action && it.action.category_code ? it.action.category_code : '').toLowerCase();
      const name = (it.action && it.action.category_name ? it.action.category_name : '').toLowerCase();
      return title.includes(q) || code.includes(q) || name.includes(q);
    });
    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!filteredItems.length) {
      const li = document.createElement('li');
      li.className = 'text-slate-600 text-sm';
      li.textContent = 'No actions yet. Add from Details.';
      listEl.appendChild(li);
      detailsEl.innerHTML = '<div class="text-slate-600">Select an action on the left to view details.</div>';
      return;
    }
    // Apply select_category_code only once (to avoid overriding user clicks)
    if (!hasAppliedSelectParam) {
      const wantedCode = getParam('select_category_code');
      if (wantedCode) {
        const found = filteredItems.find(i => String(i.action.category_code) === String(wantedCode));
        if (found) selectedId = String(found.action.id);
        hasAppliedSelectParam = true;
      }
    }
    if (!selectedId || !filteredItems.some(i => String(i.action.id) === String(selectedId))) {
      selectedId = String(filteredItems[0].action.id);
    }
    for (const it of filteredItems) {
      const isSelected = String(it.action.id) === String(selectedId);
      const li = document.createElement('li');
      li.setAttribute('data-id', String(it.action.id));
      const title = it.recommendation && it.recommendation.action_title ? it.recommendation.action_title : '(Untitled)';
      const isQuestion = String(it.action && it.action.action_type) === 'question';
      const categoryNameNorm = normalizeCatName(it.action && it.action.category_name ? it.action.category_name : '');
      const categoryChipText = categoryNameNorm || (it.action && it.action.category_code ? it.action.category_code : '');
      const questionChipHtml = isQuestion && it.action && it.action.question_code
        ? `<span class=\"inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium\" style=\"background:#F1F5F9;color:#0F172A;border:1px solid #CBD5E1\">Q ${it.action.question_code}</span>`
        : '';
      // map DB action_status -> UI label
      const dbStatus = it.action && it.action.action_status ? String(it.action.action_status) : null;
      const status = dbStatus === 'Active' ? 'In Progress'
        : (dbStatus === 'Postponed' ? 'On Hold'
        : (it.__status || (it.__status = randomPick(STATUS_OPTS))));
      const ownerText = it.action && it.action.owner_email ? String(it.action.owner_email) : 'Unassigned';
      const priority = derivePriorityFromStage(it.action && it.action.stage);
      const scoreImpact = it.__scoreImpact || (it.__scoreImpact = (5 + Math.floor(Math.random()*16))); // 5..20
      const progressPct = computeProgressFromAction(it.action);
      const statusStyle = status === 'On Hold'
        ? 'background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'
        : status === 'In Progress'
          ? 'background:#ECFEFF;color:#00A8A8;border-color:#00A8A8'
          : 'background:#E6F0FF;color:#0077FF;border-color:#0077FF';
      const prBg = priority === 'High' ? '#0077FF1a' : (priority === 'Medium' ? '#FFF7ED' : '#F1F5F9');
      const prFg = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#9A3412' : '#0F172A');
      const prBr = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#FDBA74' : '#CBD5E1');
      li.innerHTML = `
        <div class="action-card w-full text-left rounded-2xl border p-4 transition hover:shadow cursor-pointer ${isSelected ? 'action-card-selected ring-2' : ''}" style="border-color:#E5E7EB; ${isSelected ? 'box-shadow: 0 0 0 2px #0077FF' : ''}; position: relative;" role="button" tabindex="0">
          <div class="flex items-start justify-between gap-3 action-card-row">
            <div class="flex items-start gap-3 action-card-left">
              <div>
                <div class="flex items-center gap-2 action-card-chips">
                  <span class="action-chip inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style="background:#00A8A81a;color:#0F172A;border:1px solid #00A8A8">${categoryChipText}</span>
                  ${questionChipHtml}
                  ${it.action && it.action.added_by ? `<span class=\"addedby-chip inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium\" style=\"background:#FEF3C7;color:#92400E;border:1px solid #FDE68A\">${it.action.added_by}</span>` : ''}
                  <span class="priority-chip inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style="background:${prBg};color:${prFg};border:1px solid ${prBr}">${priority} Priority</span>
                </div>
                <h3 class="mt-2 text-base md:text-lg font-semibold action-title" style="color:#0F172A">${title}</h3>
                <div class="action-score-impact text-[12px] text-slate-600 mt-1">Score impact: <strong>+${scoreImpact} pts</strong></div>
                <div class="action-meta text-[12px] text-slate-500 mt-1 flex items-center gap-3">
                  <span class="action-status inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border" style="${statusStyle}">${statusIconSVG(status)} ${status}</span>
              <span class="action-owner inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg> ${ownerText}</span>
                  <span class="action-date inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> No date</span>
                </div>
                <div class="action-progress mt-2 h-2 rounded-full bg-slate-200 overflow-hidden"><div class="h-2 bg-[#0077FF]" style="width:${progressPct}%"></div></div>
              </div>
            </div>
            <div class="flex flex-col items-end gap-2 action-card-right"></div>
          </div>
          <button class="action-delete" data-delete-id="${String(it.action.id)}" title="Remove action" aria-label="Remove action">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
      listEl.appendChild(li);

      // Drag to reorder removed
      // Delete button wiring
      const delBtn = li.querySelector('[data-delete-id]');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const actionId = Number(delBtn.getAttribute('data-delete-id'));
          try {
            const res = await fetch(`/api/v1/removeAction?action_id=${encodeURIComponent(actionId)}`, { method: 'PUT' });
            if (!res.ok) throw new Error(`Failed (${res.status})`);
            rawItems = rawItems.filter(x => Number(x.action.id) !== actionId);
            filteredItems = filteredItems.filter(x => Number(x.action.id) !== actionId);
            if (String(selectedId) === String(actionId)) {
              selectedId = filteredItems.length ? String(filteredItems[0].action.id) : null;
            }
            renderList();
          } catch (err) {
            console.error('removeAction error', err);
            alert('Failed to remove action');
          }
        });
      }
    }
    // Delegate clicks (bind once)
    if (!boundClickDelegation) {
      listEl.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-delete-id]')) return;
        const row = e.target.closest && e.target.closest('li[data-id]');
        if (!row) return;
        selectedId = String(row.getAttribute('data-id'));
        renderList();
        renderDetails();
      });
      listEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest && e.target.closest('li[data-id]');
        if (!row) return;
        selectedId = String(row.getAttribute('data-id'));
        renderList();
        renderDetails();
      });
      boundClickDelegation = true;
    }
    renderDetails();
  }

  function renderDetails() {
    const it = filteredItems.find(x => String(x.action.id) === String(selectedId));
    if (!it) {
      detailsEl.innerHTML = '<div class="text-slate-600">Select an action on the left to view details.</div>';
      return;
    }
    const isQuestion = String(it.action && it.action.action_type) === 'question';
    const code = isQuestion ? (it.action && it.action.question_code ? it.action.question_code : '') : (it.action && it.action.category_code ? it.action.category_code : '');
    const catName = normalizeCatName(it.action && it.action.category_name ? it.action.category_name : '');
    const priority = derivePriorityFromStage(it.action && it.action.stage);
    const ownerEmailExisting = it.action && it.action.owner_email ? String(it.action.owner_email) : '';
    const prBg = priority === 'High' ? '#0077FF1a' : (priority === 'Medium' ? '#FFF7ED' : '#F1F5F9');
    const prFg = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#9A3412' : '#0F172A');
    const prBr = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#FDBA74' : '#CBD5E1');
    const rec = it.recommendation || {};
    const title = rec.action_title || '(Untitled)';
    const why = rec.why_it_matters || '(No description)';
    const bullets = [rec.bullet_1, rec.bullet_2, rec.bullet_3].filter(Boolean);
    const postponedNoteHtml = (it.action && it.action.action_status === 'Postponed' && it.action.postpone_date)
      ? `<span class="postpone-status text-sm text-slate-500 ml-2">Action was postponed to ${new Date(it.action.postpone_date).toLocaleDateString()}</span>`
      : '';

    detailsEl.innerHTML = `
      <div class="detail-header flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 detail-chips">
            <span class="chip inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style="background:#00A8A81a;color:#0F172A;border:1px solid #00A8A8">${catName || (isQuestion ? `Q ${code}` : code)}</span>
            <span class="chip-priority inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style="background:${prBg};color:${prFg};border:1px solid ${prBr}">${priority} Priority</span>
          </div>
          <h2 class="detail-title mt-2 text-xl md:text-2xl font-semibold" style="color:#0F172A; margin-top: 20px;">${title}</h2>
          <div class="detail-meta text-sm text-slate-600 mt-1">Score impact if completed: <strong>+1B</strong></div>
        </div>

      </div>

      <div class="detail-panel mt-5 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Why this matters</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4 text-sm leading-relaxed text-slate-700">${why}</div>
      </div>

      <div class="detail-panel mt-3 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Recommended approach</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4">
          <ol class="list-decimal pl-5 text-sm text-slate-700 space-y-1">
            ${bullets.map(b => `<li>${b}</li>`).join('')}
          </ol>
        </div>
      </div>

      <div class="detail-panel mt-3 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Downloadable resources</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4 flex flex-col gap-2">
          <a href="#" class="resource-link inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-slate-50" style="border-color:#E5E7EB">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Success Metrics Template (XLSX)
          </a>
          <a href="#" class="resource-link inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-slate-50" style="border-color:#E5E7EB">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            QBR Deck (PPTX)
          </a>
        </div>
      </div>

      <div class="detail-panel mt-3 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Ownership & scheduling</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4 grid grid-cols-1 gap-4">
          <div class="ownership block rounded-xl border p-3 col-span-1" style="border-color:#E5E7EB">
            <div class="text-sm font-medium mb-2">Assign owner</div>
            <div class="flex items-center gap-2">
              <input id="ownerEmailInput" type="email" placeholder="Owner email" value="${ownerEmailExisting}" class="rounded-xl border px-3 py-2 text-sm flex-1" style="border-color:#E5E7EB" />
              <button id="assignOwnerBtn" class="rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0077FF">Assign</button>
            </div>
            <label class="mt-2 inline-flex items-center gap-2 text-sm text-slate-700"><input id="ownerAckCheckbox" type="checkbox"/> Owner has acknowledged</label>
          </div>
          <div class="scheduling block rounded-xl border p-3 col-span-1" style="border-color:#E5E7EB">
            <div class="text-sm font-medium mb-2">Target & status</div>
            <div class="flex items-center gap-2 flex-wrap">
              <input type="date" class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB" />
              <select class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB">
                <option>Not Assigned</option>
                <option>Assigned</option>
                <option>Ready to Schedule</option>
              </select>
              <button class="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0077FF">Schedule in Stradi</button>
            </div>
          </div>
          <div class="postpone block rounded-xl border p-3 col-span-1" style="border-color:#E5E7EB">
            <div class="text-sm font-medium mb-2">
              Postpone
              ${postponedNoteHtml}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button class="button-secondary" data-postpone="14">2 weeks</button>
              <button class="button-secondary" data-postpone="30">30 days</button>
              <span class="text-sm text-slate-700">or pick a date</span>
              <input id="postponeDateInput" type="date" class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB" />
              <button id="postponeApplyBtn" class="rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0F172A">Postpone</button>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-panel mt-3 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Notes</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4">
          <div class="notes block rounded-xl border p-3" style="border-color:#E5E7EB">
            <div class="text-sm font-medium mb-2">Notes</div>
            <textarea id="notesTextarea" class="notes-textarea w-full rounded-xl border p-3 text-sm" rows="3" placeholder="Add brief context for the owner or a link to a doc…" style="border-color:#E5E7EB">${it.action && it.action.notes ? String(it.action.notes) : ''}</textarea>
            <div class="mt-2 flex justify-end">
              <button id="notesSaveBtn" class="rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0F172A">Save</button>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-panel mt-3 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Status</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4">
          <div class="status block rounded-xl border p-3" style="border-color:#E5E7EB">
            <div class="text-sm font-medium mb-2">Status</div>
            <div class="status-pills mt-1 flex flex-wrap gap-2">
              <button class="status-pill button-secondary" data-status="Owner set">Owner set</button>
              <button class="status-pill button-secondary" data-status="Acknowledged">Acknowledged</button>
              <button class="status-pill button-secondary" data-status="Date set">Date set</button>
              <button class="status-pill button-secondary" data-status="Active">In Progress</button>
              <button class="status-pill button-secondary" data-status="Ready">Ready</button>
              <button class="status-pill button-secondary" data-status="Postponed">Postponed</button>
            </div>
          </div>
        </div>
      </div>
    `;
    // Simple collapse behaviour
    detailsEl.querySelectorAll('.detail-panel .panel-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const body = btn.parentElement.querySelector('.panel-body');
        if (!body) return;
        body.classList.toggle('hidden');
      });
    });

    // Wire Assign button to send email via backend
    const assignBtn = detailsEl.querySelector('#assignOwnerBtn');
    if (assignBtn) {
      assignBtn.addEventListener('click', async () => {
        const emailInput = detailsEl.querySelector('#ownerEmailInput');
        const statusSel = detailsEl.querySelector('#targetStatusSelect');
        const toEmail = emailInput && emailInput.value ? String(emailInput.value).trim() : '';
        const statusVal = statusSel && statusSel.value ? String(statusSel.value) : 'Assigned';
        if (!toEmail || !toEmail.includes('@')) { showToast('Please enter a valid owner email', 'warning'); return; }
        const deepLink = window.location.href;
        try {
          assignBtn.disabled = true;
          assignBtn.style.opacity = '0.6';
          const resp = await fetch('/api/v1/sendAssignmentEmail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_email: toEmail, status: statusVal, link: deepLink, action_title: title, action_id: it.action.id })
          });
          if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(t || `Failed (${resp.status})`);
          }
          showToast('Assignment email sent', 'success');
          // reflect owner visually
          const ownerChip = detailsEl.querySelector('.action-owner');
          if (ownerChip) ownerChip.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg> ' + toEmail;
          // update model and card progress
          if (it.action) it.action.owner_email = toEmail;
          updateCardProgress(it.action.id, it.action);
        } catch (err) {
          console.error('sendAssignmentEmail error', err);
          showToast('Failed to send email', 'error');
        } finally {
          setTimeout(() => {
            assignBtn.disabled = false;
            assignBtn.style.opacity = '';
          }, 2400);
        }
      });
    }
    // Owner acknowledged checkbox
    const ackCb = detailsEl.querySelector('#ownerAckCheckbox');
    if (ackCb) {
      ackCb.checked = !!(it.action && it.action.owner_acknowledged);
      ackCb.addEventListener('change', async () => {
        const acknowledged = !!ackCb.checked;
        try {
          const resp = await fetch(`/api/v1/setOwnerAcknowledged?action_id=${encodeURIComponent(it.action.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged })
          });
          if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(t || `Failed (${resp.status})`);
          }
          showToast(acknowledged ? 'Owner acknowledged set' : 'Owner acknowledged cleared', 'success');
          if (it.action) it.action.owner_acknowledged = acknowledged;
          updateCardProgress(it.action.id, it.action);
        } catch (err) {
          console.error('setOwnerAcknowledged error', err);
          showToast('Failed to update acknowledgement', 'error');
          ackCb.checked = !acknowledged;
        }
      });
    }

    // Notes save
    const notesBtn = detailsEl.querySelector('#notesSaveBtn');
    if (notesBtn) {
      notesBtn.addEventListener('click', async () => {
        const ta = detailsEl.querySelector('#notesTextarea');
        const val = ta ? String(ta.value) : '';
        try {
          notesBtn.disabled = true;
          notesBtn.style.opacity = '0.7';
          const resp = await fetch(`/api/v1/setActionNotes?action_id=${encodeURIComponent(it.action.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: val })
          });
          if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(t || `Failed (${resp.status})`);
          }
          showToast('Notes saved', 'success');
          if (it.action) it.action.notes = val;
          updateCardProgress(it.action.id, it.action);
        } catch (err) {
          console.error('setActionNotes error', err);
          showToast('Failed to save notes', 'error');
        } finally {
          setTimeout(() => { notesBtn.disabled = false; notesBtn.style.opacity = ''; }, 1200);
        }
      });
    }

    // Wire Postpone controls
    const postponeContainer = detailsEl.querySelector('.postpone');
    if (postponeContainer) {
      const quickBtns = postponeContainer.querySelectorAll('[data-postpone]');
      const dateInput = postponeContainer.querySelector('#postponeDateInput');
      const applyBtn = postponeContainer.querySelector('#postponeApplyBtn');
      quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const days = Number(btn.getAttribute('data-postpone'));
          const base = new Date();
          base.setDate(base.getDate() + (Number.isFinite(days) ? days : 0));
          const yyyy = base.getFullYear();
          const mm = String(base.getMonth() + 1).padStart(2, '0');
          const dd = String(base.getDate()).padStart(2, '0');
          if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
        });
      });
      if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
          const val = dateInput && dateInput.value ? String(dateInput.value) : '';
          if (!val) { showToast('Please pick a date for postponement', 'warning'); return; }
          try {
            const resp = await fetch(`/api/v1/postponeAction?action_id=${encodeURIComponent(it.action.id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ postpone_date: val })
            });
            if (!resp.ok) {
              const t = await resp.text().catch(() => '');
              throw new Error(t || `Failed (${resp.status})`);
            }
            const data = await resp.json().catch(() => ({}));
            let label = detailsEl.querySelector('.postpone-status');
            const d = data && data.postpone_date ? new Date(data.postpone_date) : new Date(val);
            if (!label) {
              const hdr = detailsEl.querySelector('.postpone .text-sm.font-medium.mb-2');
              if (hdr) {
                label = document.createElement('span');
                label.className = 'postpone-status text-sm text-slate-500 ml-2';
                hdr.appendChild(label);
              }
            }
            if (label) label.textContent = `Action was postponed to ${d.toLocaleDateString()}`;
            showToast('Action postponed', 'success');
          } catch (err) {
            console.error('postponeAction error', err);
            showToast('Failed to postpone action', 'error');
          }
        });
      }
    }

    // Wire status pills to set action_status and update UI
    const pillsWrap = detailsEl.querySelector('.status .status-pills');
    if (pillsWrap) {
      const setPillsSelection = (savedStatus) => {
        pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
          const isActive = String(b.getAttribute('data-status')) === String(savedStatus);
          if (isActive) {
            b.classList.remove('button-secondary');
            b.classList.add('button-primary');
            b.setAttribute('aria-pressed', 'true');
          } else {
            b.classList.remove('button-primary');
            b.classList.add('button-secondary');
            b.setAttribute('aria-pressed', 'false');
          }
        });
      };

      // Initialize selection from server value if present
      if (it.action && it.action.action_status) {
        setPillsSelection(it.action.action_status);
      }

      pillsWrap.querySelectorAll('button[data-status]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const newStatus = String(btn.getAttribute('data-status'));
          try {
            const resp = await fetch(`/api/v1/setActionStatus?action_id=${encodeURIComponent(it.action.id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action_status: newStatus })
            });
            if (!resp.ok) {
              const t = await resp.text().catch(() => '');
              throw new Error(t || `Failed (${resp.status})`);
            }
            // Update local data model
            if (it.action) it.action.action_status = newStatus;
            // Reflect selection in pills
            setPillsSelection(newStatus);
            // Update left card status label
            const card = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-status`);
            if (card) {
              const uiLabel = newStatus === 'Active' ? 'In Progress' : (newStatus === 'Postponed' ? 'On Hold' : newStatus);
              const style = uiLabel === 'On Hold'
                ? 'background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'
                : uiLabel === 'In Progress'
                  ? 'background:#ECFEFF;color:#00A8A8;border-color:#00A8A8'
                  : 'background:#E6F0FF;color:#0077FF;border-color:#0077FF';
              card.setAttribute('style', style);
              card.innerHTML = `${statusIconSVG(uiLabel)} ${uiLabel}`;
            }
            // update model and progress
            if (it.action) it.action.action_status = newStatus;
            updateCardProgress(it.action.id, it.action);
            showToast('Status updated', 'success');
          } catch (err) {
            console.error('setActionStatus error', err);
            showToast('Failed to update status', 'error');
          }
        });
      });
    }
  }

  async function init() {
    if (!listEl || !detailsEl) return;
    const email = getParam('email');
    if (!email) {
      listEl.innerHTML = '<li class="text-slate-600 text-sm">Missing email</li>';
      return;
    }
    try {
      const data = await fetchRecommendations(email);
      const items = Array.isArray(data.items) ? data.items.slice() : [];
      // Sort: non-postponed first by list_order, postponed items last
      items.sort((a, b) => {
        const aPost = String(a.action && a.action.action_status) === 'Postponed';
        const bPost = String(b.action && b.action.action_status) === 'Postponed';
        if (aPost !== bPost) return aPost ? 1 : -1;
        const ao = Number(a.action && a.action.list_order) || 0;
        const bo = Number(b.action && b.action.list_order) || 0;
        return ao - bo;
      });
      rawItems = items;
      filteredItems = items.slice();
      if (rawItems.length) {
        const wantedCode = getParam('select_category_code');
        if (wantedCode) {
          const found = rawItems.find(i => String(i.action.category_code) === String(wantedCode));
          selectedId = found ? String(found.action.id) : String(rawItems[0].action.id);
          hasAppliedSelectParam = true;
        } else {
          selectedId = String(rawItems[0].action.id);
        }
      }
      renderList();
    } catch (err) {
      listEl.innerHTML = `<li class="text-red-700 text-sm">Failed to load: ${err && err.message ? err.message : String(err)}</li>`;
    }

    if (searchInput) searchInput.addEventListener('input', applyFilter);
    if (filterSelect) filterSelect.addEventListener('change', applyFilter);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();


