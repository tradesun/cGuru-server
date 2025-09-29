(function() {
  const searchInput = document.getElementById('nextSearch');
  const filterSelect = document.getElementById('priorityFilter');
  const listEl = document.getElementById('actionsList');
  const detailsEl = document.getElementById('detailsPanel');

  let rawItems = [];
  let filteredItems = [];
  let selectedId = null;
  const STATUS_OPTS = ['On Hold','In Progress','Ready to Schedule'];
  const PRIORITY_OPTS = ['High','Medium','Low'];

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
    // Preselect by category code if provided, else keep selection valid
    const wantedCode = getParam('select_category_code');
    if (wantedCode) {
      const found = filteredItems.find(i => String(i.action.category_code) === String(wantedCode));
      if (found) selectedId = String(found.action.id);
    }
    if (!selectedId || !filteredItems.some(i => String(i.action.id) === String(selectedId))) {
      selectedId = String(filteredItems[0].action.id);
    }
    for (const it of filteredItems) {
      const isSelected = String(it.action.id) === String(selectedId);
      const li = document.createElement('li');
      li.setAttribute('data-id', String(it.action.id));
      li.draggable = true;
      const title = it.recommendation && it.recommendation.action_title ? it.recommendation.action_title : '(Untitled)';
      const code = it.action && it.action.category_code ? it.action.category_code : '';
      const catNameRaw = it.action && it.action.category_name ? it.action.category_name : '';
      const catName = normalizeCatName(catNameRaw);
      const status = it.__status || (it.__status = randomPick(STATUS_OPTS));
      const priority = it.__priority || (it.__priority = randomPick(PRIORITY_OPTS));
      const statusStyle = status === 'On Hold'
        ? 'background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'
        : status === 'In Progress'
          ? 'background:#ECFEFF;color:#00A8A8;border-color:#00A8A8'
          : 'background:#E6F0FF;color:#0077FF;border-color:#0077FF';
      const prBg = priority === 'High' ? '#0077FF1a' : (priority === 'Medium' ? '#FFF7ED' : '#F1F5F9');
      const prFg = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#9A3412' : '#0F172A');
      const prBr = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#FDBA74' : '#CBD5E1');
      li.innerHTML = `
        <div class="w-full text-left rounded-2xl border p-4 transition hover:shadow ${isSelected ? 'ring-2' : ''}" style="border-color:#E5E7EB; ${isSelected ? 'box-shadow: 0 0 0 2px #0077FF' : ''}; position: relative;">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3">
              <span class="action_handle dragHandle cursor-grab select-none text-slate-400" data-drag-handle aria-label="Drag to reorder">&#9776;</span>
              <div>
                <div class="flex items-center gap-2">
                  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style="background:#00A8A81a;color:#0F172A;border:1px solid #00A8A8">${catName || code}</span>
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style="background:${prBg};color:${prFg};border:1px solid ${prBr}">${priority} Priority</span>
                </div>
                <h3 class="mt-2 text-base md:text-lg font-semibold" style="color:#0F172A">${title}</h3>
              </div>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border" style="${statusStyle}">${statusIconSVG(status)} ${status}</span>
            </div>
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

      // Debug: handle and li events
      const handle = li.querySelector('[data-drag-handle]');
      if (handle) {
        handle.draggable = true;
        handle.addEventListener('mousedown', () => {
          console.log('[next] mousedown on handle id=', it.action.id);
          li.draggable = true;
        });
        handle.addEventListener('mouseup', () => {
          console.log('[next] mouseup on handle id=', it.action.id);
          li.draggable = false;
        });
        handle.addEventListener('dragstart', (e) => {
          console.log('[next] dragstart on handle id=', it.action.id);
          draggingId = String(li.getAttribute('data-id'));
          e.dataTransfer.effectAllowed = 'move';
        });
      }
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
    // Wire clicks
    listEl.querySelectorAll('li[data-id]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-drag-handle') !== null) return;
        if (e.target && e.target.closest && e.target.closest('[data-delete-id]')) return;
        selectedId = String(row.getAttribute('data-id'));
        renderList();
        renderDetails();
      });
    });
    wireDrag();
    renderDetails();
  }

  function wireDrag() {
    let draggingId = null;
    listEl.querySelectorAll('li[data-id]').forEach(li => {
      li.addEventListener('dragstart', e => {
        const handle = e.target.closest('[data-drag-handle]');
        console.log('[next] li dragstart fired; onHandle=', !!handle, 'id=', li.getAttribute('data-id'));
        if (!handle) { e.preventDefault(); return; }
        draggingId = String(li.getAttribute('data-id'));
        e.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        console.log('[next] dragend id=', li.getAttribute('data-id'));
        draggingId = null;
        li.classList.remove('dragging');
        // cleanup any drag-over classes
        listEl.querySelectorAll('li.drag-over-before, li.drag-over-after').forEach(el => {
          el.classList.remove('drag-over-before', 'drag-over-after');
        });
      });
    });
    listEl.addEventListener('dragover', e => {
      if (!draggingId) return;
      e.preventDefault();
      const target = e.target.closest('li[data-id]');
      if (!target || String(target.getAttribute('data-id')) === draggingId) return;
      const draggingEl = listEl.querySelector(`li[data-id="${draggingId}"]`);
      const rect = target.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      console.log('[next] dragover dragging=', draggingId, 'over=', target.getAttribute('data-id'), 'before=', before);
      // visual cue on target
      listEl.querySelectorAll('li.drag-over-before, li.drag-over-after').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after');
      });
      target.classList.add(before ? 'drag-over-before' : 'drag-over-after');
      if (before) listEl.insertBefore(draggingEl, target); else listEl.insertBefore(draggingEl, target.nextSibling);
    });
    listEl.addEventListener('drop', async () => {
      if (!draggingId) return;
      const ids = Array.from(listEl.querySelectorAll('li[data-id]')).map(el => Number(el.getAttribute('data-id')));
      console.log('[next] drop new ids=', ids);
      const byId = new Map(rawItems.map(it => [Number(it.action.id), it]));
      rawItems = ids.map(id => byId.get(id)).filter(Boolean);
      filteredItems = rawItems.slice();
      // cleanup visuals
      listEl.querySelectorAll('li.drag-over-before, li.drag-over-after, li.dragging').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after', 'dragging');
      });
      try {
        const email = getParam('email');
        if (email) {
          const payload = { order: rawItems.map((it, i) => ({ action_id: it.action.id, order: i + 1 })) };
          console.log('[next] POST reorderAction payload=', payload);
          await fetch(`/api/v1/reorderAction?email=${encodeURIComponent(email)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload)
          });
        }
      } catch {}
    });
  }

  function renderDetails() {
    const it = filteredItems.find(x => String(x.action.id) === String(selectedId));
    if (!it) {
      detailsEl.innerHTML = '<div class="text-slate-600">Select an action on the left to view details.</div>';
      return;
    }
    const code = it.action && it.action.category_code ? it.action.category_code : '';
    const catName = normalizeCatName(it.action && it.action.category_name ? it.action.category_name : '');
    const priority = it.__priority || 'Medium';
    const prBg = priority === 'High' ? '#0077FF1a' : (priority === 'Medium' ? '#FFF7ED' : '#F1F5F9');
    const prFg = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#9A3412' : '#0F172A');
    const prBr = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#FDBA74' : '#CBD5E1');
    const rec = it.recommendation || {};
    const title = rec.action_title || '(Untitled)';
    const why = rec.why_it_matters || '(No description)';
    const bullets = [rec.bullet_1, rec.bullet_2, rec.bullet_3].filter(Boolean);

    detailsEl.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style="background:#00A8A81a;color:#0F172A;border:1px solid #00A8A8">${catName || code}</span>
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style="background:${prBg};color:${prFg};border:1px solid ${prBr}">${priority} Priority</span>
          </div>
          <h2 class="mt-2 text-xl md:text-2xl font-semibold" style="color:#0F172A; margin-top: 20px;">${title}</h2>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-sm text-slate-700">Status</label>
          <select class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB">
            <option>On Hold</option>
            <option>In Progress</option>
            <option>Ready to Schedule</option>
          </select>
        </div>
      </div>

      <div class="mt-5">
        <div class="text-sm font-semibold" style="margin-bottom: 10px;">Why this matters</div>
        <p class="text-sm leading-relaxed text-slate-700">${why}</p>
      </div>

      <div class="mt-3">
        <div class="text-sm font-semibold" style="    margin-top: 16px;;margin-bottom: 10px;">Recommended approach</div>
        <ol class="list-disc pl-5 text-sm text-slate-700 space-y-1">
          ${bullets.map(b => `<li>${b}</li>`).join('')}
        </ol>
      </div>

      <div class="mt-3">
        <div class="text-sm font-semibold" style="margin-top: 18px !important;margin-bottom: 9px;">Downloadable resources</div>
        <div class="flex flex-col gap-2">
          <a href="#" class="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-slate-50" style="border-color:#E5E7EB">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Success Metrics Template (XLSX)
          </a>
          <a href="#" class="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-slate-50" style="border-color:#E5E7EB">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            QBR Deck (PPTX)
          </a>
        </div>
      </div>

      <div class="mt-3">
        <div class="text-sm font-semibold" style="margin-bottom: 5px; margin-top: 17px;" >Scheduling</div>
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-700">Target date</label>
            <input type="date" class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB" />
          </div>
          <button class="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0077FF">Schedule in Stradi</button>
        </div>
      </div>
    `;
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
      // Sort by list_order ASC
      items.sort((a, b) => (Number(a.action && a.action.list_order) || 0) - (Number(b.action && b.action.list_order) || 0));
      rawItems = items;
      filteredItems = items.slice();
      if (rawItems.length) {
        const wantedCode = getParam('select_category_code');
        if (wantedCode) {
          const found = rawItems.find(i => String(i.action.category_code) === String(wantedCode));
          selectedId = found ? String(found.action.id) : String(rawItems[0].action.id);
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


