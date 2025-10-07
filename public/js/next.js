(function() {
  const searchInput = document.getElementById('nextSearch');
  const filterSelect = document.getElementById('priorityFilter');
  const listEl = document.getElementById('actionsList');
  const detailsEl = document.getElementById('detailsPanel');

  let rawItems = [];
  let filteredItems = [];
  let selectedId = null;
  const PAGE_SIZE = 10;
  let visibleCount = PAGE_SIZE;
  const STATUS_OPTS = ['Not Assigned','Assigned','Acknowledged','Scheduled','In Progress','Completed'];
  let boundClickDelegation = false;
  let hasAppliedSelectParam = false;
  let initialScrollPending = false;

  // Filter state and assessment info
  let loadedAssessInfo = [];
  const filtersKey = () => `nextFilters:${getParam('email') || ''}`;
  const filters = {
    priorities: new Set(),
    statuses: new Set(),
    timeWindow: 'none', // none|today|week|next7|custom
    twFrom: '',
    twTo: '',
    ownerQuery: '',
    unassigned: false,
    srcMy: false,
    srcSuggested: false,
    campaigns: new Set(), // assessment_id strings
    subcategoryQuery: '',
    questionQuery: ''
  };

  function saveFilters() {
    try {
      const obj = {
        p: Array.from(filters.priorities),
        s: Array.from(filters.statuses),
        tw: filters.timeWindow,
        tf: filters.twFrom,
        tt: filters.twTo,
        oq: filters.ownerQuery,
        ua: filters.unassigned,
        sm: filters.srcMy,
        ss: filters.srcSuggested,
        c: Array.from(filters.campaigns),
        sc: filters.subcategoryQuery,
        qq: filters.questionQuery
      };
      localStorage.setItem(filtersKey(), JSON.stringify(obj));
    } catch {}
  }

  function loadFilters() {
    try {
      const txt = localStorage.getItem(filtersKey());
      if (!txt) return;
      const obj = JSON.parse(txt);
      filters.priorities = new Set(obj.p || []);
      filters.statuses = new Set(obj.s || []);
      filters.timeWindow = obj.tw || 'none';
      filters.twFrom = obj.tf || '';
      filters.twTo = obj.tt || '';
      filters.ownerQuery = obj.oq || '';
      filters.unassigned = !!obj.ua;
      filters.srcMy = !!obj.sm;
      filters.srcSuggested = !!obj.ss;
      filters.campaigns = new Set(obj.c || []);
      filters.subcategoryQuery = obj.sc || '';
      filters.questionQuery = obj.qq || '';
    } catch {}
  }

  async function loadAssessmentInfoForFilters() {
    try {
      const res = await fetch('/js/assessment_info.json', { headers: { 'Accept': 'application/json' } });
      loadedAssessInfo = res.ok ? (await res.json()) : [];
      const select = document.getElementById('campSelect');
      if (select) {
        select.innerHTML = '';
        const byId = (Array.isArray(loadedAssessInfo) ? loadedAssessInfo : []);
        byId.forEach(info => {
          const opt = document.createElement('option');
          opt.value = String(info.assessment_id);
          opt.textContent = info.title || `Assessment ${info.assessment_id}`;
          if (filters.campaigns.has(String(info.assessment_id))) opt.selected = true;
          select.appendChild(opt);
        });
      }
    } catch { loadedAssessInfo = []; }
  }

  function parseInviteDate(invites) {
    try {
      if (!invites) return null;
      const parts = String(invites).split('|');
      const dateStr = (parts[0] || '').trim(); // dd/mm/yy
      const timeStr = (parts[1] || '').trim(); // HH:MM
      if (!/^\d{2}\/\d{2}\/\d{2}$/.test(dateStr)) return null;
      const [dd, mm, yy] = dateStr.split('/').map(Number);
      const [hh, mi] = (timeStr ? timeStr.split(':').map(Number) : [0, 0]);
      const fullYear = 2000 + yy;
      const dt = new Date(fullYear, (mm - 1), dd, Number.isFinite(hh) ? hh : 0, Number.isFinite(mi) ? mi : 0, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    } catch { return null; }
  }

  function isWithinTimeWindow(invites, tw, fromStr, toStr) {
    if (tw === 'none') return true;
    const dt = parseInviteDate(invites);
    if (!dt) return false;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    if (tw === 'today') return dt >= startOfToday && dt <= endOfToday;
    if (tw === 'week') {
      const day = now.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day; // make Monday start
      const from = new Date(now); from.setDate(now.getDate() + diffToMonday); from.setHours(0,0,0,0);
      const to = new Date(from); to.setDate(from.getDate() + 6); to.setHours(23,59,59,999);
      return dt >= from && dt <= to;
    }
    if (tw === 'next7') {
      const to = new Date(now); to.setDate(now.getDate() + 7); to.setHours(23,59,59,999);
      return dt >= now && dt <= to;
    }
    if (tw === 'custom') {
      if (!fromStr || !toStr) return true;
      const [fy, fm, fd] = String(fromStr).split('-').map(Number);
      const [ty, tm, td] = String(toStr).split('-').map(Number);
      const from = new Date(fy, (fm - 1), fd, 0, 0, 0, 0);
      const to = new Date(ty, (tm - 1), td, 23, 59, 59, 999);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) return true;
      return dt >= from && dt <= to;
    }
    return true;
  }

  function setCardAssessmentIdAttr(container, it) {
    try {
      const card = container.querySelector('.action-card');
      if (!card) return;
      const aId = it && it.action && it.action.assessment_id ? String(it.action.assessment_id) : '';
      if (aId) card.setAttribute('data-assessment_id', aId);
    } catch {}
  }

  function getAssessmentIdForLi(li) {
    const card = li && li.querySelector ? li.querySelector('.action-card') : null;
    if (!card) return '';
    return String(card.getAttribute('data-assessment_id') || '');
  }

  function wireFilterBar() {
    const els = {
      prioH: document.getElementById('fPrioHigh'),
      prioM: document.getElementById('fPrioMed'),
      prioL: document.getElementById('fPrioLow'),
      sNA: document.getElementById('sNotAssigned'),
      sAs: document.getElementById('sAssigned'),
      sAc: document.getElementById('sAcknowledged'),
      sSc: document.getElementById('sScheduled'),
      sIP: document.getElementById('sInProgress'),
      sCo: document.getElementById('sCompleted'),
      sOv: document.getElementById('sOverdue'),
      twNone: document.getElementById('twNone'),
      twToday: document.getElementById('twToday'),
      twWeek: document.getElementById('twWeek'),
      twNext7: document.getElementById('twNext7'),
      twCustom: document.getElementById('twCustom'),
      twFrom: document.getElementById('twFrom'),
      twTo: document.getElementById('twTo'),
      ownSearch: document.getElementById('ownSearch'),
      ownUnassigned: document.getElementById('ownUnassigned'),
      srcMy: document.getElementById('srcMy'),
      srcSug: document.getElementById('srcSuggested'),
      camp: document.getElementById('campSelect'),
      subcat: document.getElementById('subcatSearch'),
      qnum: document.getElementById('questionSearch'),
      chipOverdue: document.getElementById('chipOverdue'),
      chipWeek: document.getElementById('chipWeek'),
      chipUnassigned: document.getElementById('chipUnassigned'),
      chipSuggested: document.getElementById('chipSuggested'),
      btnClear: document.getElementById('filtersClear')
    };

    // Restore UI from saved filters
    if (els.prioH) els.prioH.checked = filters.priorities.has('High');
    if (els.prioM) els.prioM.checked = filters.priorities.has('Medium');
    if (els.prioL) els.prioL.checked = filters.priorities.has('Low');
    const statusesArr = Array.from(filters.statuses);
    if (els.sNA) els.sNA.checked = statusesArr.includes('Not Assigned');
    if (els.sAs) els.sAs.checked = statusesArr.includes('Assigned');
    if (els.sAc) els.sAc.checked = statusesArr.includes('Acknowledged');
    if (els.sSc) els.sSc.checked = statusesArr.includes('Scheduled');
    if (els.sIP) els.sIP.checked = statusesArr.includes('In Progress');
    if (els.sCo) els.sCo.checked = statusesArr.includes('Completed');
    if (els.sOv) els.sOv.checked = statusesArr.includes('Overdue');
    if (els.twNone) els.twNone.checked = filters.timeWindow === 'none';
    if (els.twToday) els.twToday.checked = filters.timeWindow === 'today';
    if (els.twWeek) els.twWeek.checked = filters.timeWindow === 'week';
    if (els.twNext7) els.twNext7.checked = filters.timeWindow === 'next7';
    if (els.twCustom) els.twCustom.checked = filters.timeWindow === 'custom';
    if (els.twFrom) els.twFrom.value = filters.twFrom || '';
    if (els.twTo) els.twTo.value = filters.twTo || '';
    if (els.ownSearch) els.ownSearch.value = filters.ownerQuery || '';
    if (els.ownUnassigned) els.ownUnassigned.checked = !!filters.unassigned;
    if (els.srcMy) els.srcMy.checked = !!filters.srcMy;
    if (els.srcSug) els.srcSug.checked = !!filters.srcSuggested;
    if (els.subcat) els.subcat.value = filters.subcategoryQuery || '';
    if (els.qnum) els.qnum.value = filters.questionQuery || '';

    function scheduleApply() { saveFilters(); applyFilter(); }
    function onPrioChange() {
      filters.priorities.clear();
      if (els.prioH && els.prioH.checked) filters.priorities.add('High');
      if (els.prioM && els.prioM.checked) filters.priorities.add('Medium');
      if (els.prioL && els.prioL.checked) filters.priorities.add('Low');
      scheduleApply();
    }
    function onStatusChange() {
      filters.statuses.clear();
      [['sNA','Not Assigned'],['sAs','Assigned'],['sAc','Acknowledged'],['sSc','Scheduled'],['sIP','In Progress'],['sCo','Completed'],['sOv','Overdue']].forEach(([id,label]) => {
        const el = els[id]; if (el && el.checked) filters.statuses.add(label);
      });
      scheduleApply();
    }
    function onTwChange() {
      if (els.twNone && els.twNone.checked) filters.timeWindow = 'none';
      else if (els.twToday && els.twToday.checked) filters.timeWindow = 'today';
      else if (els.twWeek && els.twWeek.checked) filters.timeWindow = 'week';
      else if (els.twNext7 && els.twNext7.checked) filters.timeWindow = 'next7';
      else if (els.twCustom && els.twCustom.checked) filters.timeWindow = 'custom';
      // Clear quick chips when custom used
      if (filters.timeWindow === 'custom') {
        if (els.chipWeek) els.chipWeek.classList.remove('active');
      }
      scheduleApply();
    }
    function onTwRangeChange() {
      filters.twFrom = els.twFrom ? String(els.twFrom.value) : '';
      filters.twTo = els.twTo ? String(els.twTo.value) : '';
      if (els.twCustom) els.twCustom.checked = true;
      filters.timeWindow = 'custom';
      // Clear quick chips when custom edited
      if (els.chipWeek) els.chipWeek.classList.remove('active');
      scheduleApply();
    }
    function onOwnChange() {
      filters.ownerQuery = els.ownSearch ? String(els.ownSearch.value || '').trim().toLowerCase() : '';
      filters.unassigned = !!(els.ownUnassigned && els.ownUnassigned.checked);
      scheduleApply();
    }
    function onSrcChange() {
      filters.srcMy = !!(els.srcMy && els.srcMy.checked);
      filters.srcSuggested = !!(els.srcSug && els.srcSug.checked);
      scheduleApply();
    }
    function onCampChange() {
      filters.campaigns.clear();
      if (els.camp) {
        Array.from(els.camp.selectedOptions || []).forEach(opt => filters.campaigns.add(String(opt.value)));
      }
      scheduleApply();
    }
    function onHierarchyChange() {
      filters.subcategoryQuery = els.subcat ? String(els.subcat.value || '').toLowerCase().trim() : '';
      filters.questionQuery = els.qnum ? String(els.qnum.value || '').toLowerCase().trim() : '';
      scheduleApply();
    }
    function onChipOverdue() {
      // toggle Overdue in statuses
      const has = filters.statuses.has('Overdue');
      if (has) filters.statuses.delete('Overdue'); else filters.statuses.add('Overdue');
      if (els.sOv) els.sOv.checked = filters.statuses.has('Overdue');
      scheduleApply();
    }
    function onChipWeek() {
      // Set time window to week and clear custom inputs
      filters.timeWindow = (filters.timeWindow === 'week') ? 'none' : 'week';
      if (els.twWeek) els.twWeek.checked = filters.timeWindow === 'week';
      if (els.twNone) els.twNone.checked = filters.timeWindow === 'none';
      if (els.twFrom) els.twFrom.value = '';
      if (els.twTo) els.twTo.value = '';
      scheduleApply();
    }
    function onChipUnassigned() {
      filters.unassigned = !filters.unassigned;
      if (els.ownUnassigned) els.ownUnassigned.checked = filters.unassigned;
      scheduleApply();
    }
    function onChipSuggested() {
      filters.srcSuggested = !filters.srcSuggested;
      if (els.srcSug) els.srcSug.checked = filters.srcSuggested;
      scheduleApply();
    }
    function onClearAll() {
      filters.priorities.clear();
      filters.statuses.clear();
      filters.timeWindow = 'none';
      filters.twFrom = '';
      filters.twTo = '';
      filters.ownerQuery = '';
      filters.unassigned = false;
      filters.srcMy = false;
      filters.srcSuggested = false;
      filters.campaigns.clear();
      filters.subcategoryQuery = '';
      filters.questionQuery = '';
      // reset UI
      ['fPrioHigh','fPrioMed','fPrioLow','sNotAssigned','sAssigned','sAcknowledged','sScheduled','sInProgress','sCompleted','sOverdue'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
      if (els.twNone) els.twNone.checked = true;
      if (els.twToday) els.twToday.checked = false;
      if (els.twWeek) els.twWeek.checked = false;
      if (els.twNext7) els.twNext7.checked = false;
      if (els.twCustom) els.twCustom.checked = false;
      if (els.twFrom) els.twFrom.value = '';
      if (els.twTo) els.twTo.value = '';
      if (els.ownSearch) els.ownSearch.value = '';
      if (els.ownUnassigned) els.ownUnassigned.checked = false;
      if (els.srcMy) els.srcMy.checked = false;
      if (els.srcSug) els.srcSug.checked = false;
      if (els.camp) Array.from(els.camp.options).forEach(o => o.selected = false);
      if (els.subcat) els.subcat.value = '';
      if (els.qnum) els.qnum.value = '';
      scheduleApply();
    }

    // Wire events
    ;[els.prioH, els.prioM, els.prioL].forEach(el => el && el.addEventListener('change', onPrioChange));
    ;[els.sNA, els.sAs, els.sAc, els.sSc, els.sIP, els.sCo, els.sOv].forEach(el => el && el.addEventListener('change', onStatusChange));
    ;[els.twNone, els.twToday, els.twWeek, els.twNext7, els.twCustom].forEach(el => el && el.addEventListener('change', onTwChange));
    if (els.twFrom) els.twFrom.addEventListener('change', onTwRangeChange);
    if (els.twTo) els.twTo.addEventListener('change', onTwRangeChange);
    if (els.ownSearch) els.ownSearch.addEventListener('input', onOwnChange);
    if (els.ownUnassigned) els.ownUnassigned.addEventListener('change', onOwnChange);
    if (els.srcMy) els.srcMy.addEventListener('change', onSrcChange);
    if (els.srcSug) els.srcSug.addEventListener('change', onSrcChange);
    if (els.camp) els.camp.addEventListener('change', onCampChange);
    if (els.subcat) els.subcat.addEventListener('input', onHierarchyChange);
    if (els.qnum) els.qnum.addEventListener('input', onHierarchyChange);
    if (els.chipOverdue) els.chipOverdue.addEventListener('click', onChipOverdue);
    if (els.chipWeek) els.chipWeek.addEventListener('click', onChipWeek);
    if (els.chipUnassigned) els.chipUnassigned.addEventListener('click', onChipUnassigned);
    if (els.chipSuggested) els.chipSuggested.addEventListener('click', onChipSuggested);
    if (els.btnClear) els.btnClear.addEventListener('click', onClearAll);
  }

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
    if (!action) return 0;
    // Completed overrides all
    if (String(action.action_status) === 'Completed') return 100;
    let pct = 0;
    // Priority Added (exists) +20%
    pct += 20;
    // Owner Assigned (any owner) +20% (cap 20)
    if (action.owner_email && String(action.owner_email).trim() !== '') pct += 20;
    // Owner Acknowledged +10% (cap 10)
    const hasAck = !!(action.owner_acknowledged || (action.owner_email && String(action.owner_email).toLowerCase().includes('|acknowledged')));
    if (hasAck) pct += 10;
    // Target Date Set (invites date or postpone_date) +20%
    const hasInvitesDate = (() => {
      const inv = action && action.invites ? String(action.invites) : '';
      if (!inv) return false;
      const d = inv.split('|')[0] || '';
      return d.length >= 6; // dd/mm/yy
    })();
    const hasPostpone = !!action.postpone_date;
    if (hasInvitesDate || hasPostpone) pct += 20;
    // Notes Added +10% (cap 10)
    if (typeof action.notes === 'string' && action.notes.trim() !== '') pct += 10;
    // Clamp 0..100
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
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

  function parseOwnersComposite(raw) {
    if (!raw) return [];
    return String(raw)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(tok => {
        const parts = tok.split('|');
        return {
          email: (parts[0] || '').trim(),
          status: (parts[1] || 'Pending').trim(),
          sentAt: (parts[2] || '').trim(),
        };
      })
      .filter(o => o.email);
  }

  function formatOwnerNameFromEmail(email) {
    const local = String(email).split('@')[0] || '';
    if (!local) return '';
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }

  function buildOwnerChipContent(ownerComposite) {
    const owners = parseOwnersComposite(ownerComposite);
    const anyOwners = owners.length > 0;
    const anyAck = owners.some(o => String(o.status).toLowerCase() === 'acknowledged');
    const anyExpired = owners.some(o => String(o.status).toLowerCase() === 'expired');
    const userIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a 4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg>';
    const alertIconRed = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    if (anyOwners && !anyAck && anyExpired) {
      return { html: `${alertIconRed} Ownership request expired`, color: '#DC2626' };
    }
    const nameSpans = owners.map(o => {
      const name = formatOwnerNameFromEmail(o.email);
      if (!name) return '';
      const st = String(o.status).toLowerCase();
      const color = st === 'acknowledged' ? '#16A34A' : (st === 'pending' ? '#D97706' : '');
      const style = color ? ` style=\"color:${color}\"` : '';
      return `<span${style}>${name}</span>`;
    }).filter(Boolean);
    const textHtml = nameSpans.length ? nameSpans.join(', ') : 'Unassigned';
    return { html: `${userIcon} ${textHtml}`, color: '' };
  }

  function updateOwnerChipForAction(actionId, ownerComposite) {
    const chip = listEl && listEl.querySelector ? listEl.querySelector(`li[data-id="${String(actionId)}"] .action-owner`) : null;
    if (!chip) return;
    const content = buildOwnerChipContent(ownerComposite || '');
    chip.innerHTML = content.html;
    chip.style.color = content.color || '';
  }

  function joinNamesOxford(names) {
    const arr = Array.isArray(names) ? names.filter(Boolean) : [];
    if (arr.length <= 1) return arr[0] || '';
    if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
    return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
  }

  function formatMonDayFromDdMmYy(ddmmyy) {
    try {
      const [dd, mm, yy] = String(ddmmyy).split('/').map(s => Number(s));
      if (!dd || !mm || isNaN(yy)) return '';
      const fullYear = 2000 + yy;
      const d = new Date(fullYear, mm - 1, dd);
      const mo = d.toLocaleString('en-US', { month: 'short' });
      return `${mo} ${d.getDate()}`;
    } catch { return ''; }
  }

  function joinNamesWithCommaAnd(names) {
    const arr = Array.isArray(names) ? names.filter(Boolean) : [];
    if (arr.length <= 1) return arr[0] || '';
    if (arr.length === 2) return `${arr[0]},and ${arr[1]}`; // per spec sample: "Support,and Sales"
    return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
  }

  function statusIconSVG(status) {
    switch (status) {
      case 'Overdue':
        // alert triangle
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      case 'Not Assigned':
        // user icon
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg>';
      case 'Assigned':
        // mail-send icon
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
      case 'Acknowledged':
        // check
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
      case 'Scheduled':
        // clock
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      case 'In Progress':
        // play
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      case 'Completed':
        // badge-check
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>';
      case 'Stage Changed':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      default:
        // pause
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    }
  }

  function getParam(name) {
    const p = new URLSearchParams(window.location.search);
    return p.get(name);
  }

  async function fetchRecommendationsByDomain(email) {
    const dom = String(email || '').split('@')[1] || '';
    const url = `/api/v1/get_recommendations_for_all_added_actions?domain=${encodeURIComponent(dom)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  function getCheckedValuesByLabel(labelText) {
    const filtersEls = Array.from(document.querySelectorAll('.filter'));
    const match = filtersEls.find(f => {
      const l = f.querySelector('.label');
      if (!l) return false;
      const base = l.textContent.split('(')[0].trim();
      return base.toLowerCase() === String(labelText).toLowerCase();
    });
    if (!match) return [];
    return Array.from(match.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  }

  function applyFilterFromBar() {
    console.log('[FilterBar] mapping selections to filters');
    // map filter bar -> internal filters
    const prios = new Set(getCheckedValuesByLabel('Priority'));
    filters.priorities = new Set(['High','Medium','Low'].filter(p => prios.has(p)));

    const statuses = new Set(getCheckedValuesByLabel('Status'));
    filters.statuses = new Set(['Not Assigned','Assigned','Acknowledged','Scheduled','In Progress','Completed','Overdue'].filter(s => statuses.has(s)));

    // Due time quick chips and group
    const dueVals = new Set(getCheckedValuesByLabel('Due time'));
    if (dueVals.has('Due today')) filters.timeWindow = 'today';
    else if (dueVals.has('This week')) filters.timeWindow = 'week';
    else if (dueVals.has('Next 7 days')) filters.timeWindow = 'next7';
    else filters.timeWindow = 'none';
    filters.twFrom = '';
    filters.twTo = '';
    // If Overdue was checked under Due time group, treat it as a Status filter
    if (dueVals.has('Overdue')) {
      filters.statuses.add('Overdue');
      console.log('[FilterBar] Overdue selected in Due time – applying as Status filter');
    }

    // Ownership: Unassigned, emails, My Actions (owner=current user)
    const ownVals = new Set(getCheckedValuesByLabel('Ownership'));
    filters.unassigned = ownVals.has('Unassigned');
    const ownerEmails = Array.from(ownVals).filter(v => v.includes('@'));
    filters.ownerQuery = ownerEmails.join('|');
    // Quick chip: My Actions (only current user's actions)
    const myChipActive = Array.from(document.querySelectorAll('.quick-filters .chip')).some(c => c.textContent.trim() === 'My Actions' && c.classList.contains('active'));
    const currentUserEmail = (typeof getParam === 'function' ? (getParam('email') || '') : (window.Api && typeof window.Api.getQueryParam === 'function' ? window.Api.getQueryParam('email') : ''));
    filters.myActionsOnly = !!myChipActive && !!currentUserEmail;

    // Source: Hide Suggested quick chip
    const hideSuggested = Array.from(document.querySelectorAll('.quick-filters .chip')).some(c => c.textContent.trim() === 'Hide Suggested' && c.classList.contains('active'));
    filters.srcSuggested = hideSuggested;
    filters.srcMy = false;

    // Assessment
    const assessVals = new Set(getCheckedValuesByLabel('Assessment'));
    filters.campaigns = assessVals;

    console.log('[FilterBar] filters', {
      priorities: Array.from(filters.priorities),
      statuses: Array.from(filters.statuses),
      timeWindow: filters.timeWindow,
      ownerQuery: filters.ownerQuery,
      unassigned: filters.unassigned,
      srcSuggested: filters.srcSuggested,
      campaigns: Array.from(filters.campaigns)
    });
    applyFilter();
  }

  document.addEventListener('filterbar:changed', () => {
    try { console.log('[FilterBar] event received: changed'); } catch {}
    applyFilterFromBar();
  });

  function applyFilter() {
    console.log('[FilterBar] applying filter to items', rawItems.length);
    const q = (searchInput && searchInput.value ? searchInput.value.toLowerCase().trim() : '');
    const currentUserEmail = (typeof getParam === 'function' ? (getParam('email') || '') : (window.Api && typeof window.Api.getQueryParam === 'function' ? window.Api.getQueryParam('email') : ''));
    filteredItems = rawItems.filter(it => {
      if (String(it.action && it.action.action_status) === 'Stage Changed') return false;
      const pr = derivePriorityFromStage(it.action && it.action.stage);
      if (filters.priorities.size > 0 && !filters.priorities.has(pr)) return false;
      const st = String(it.action && it.action.action_status || '');
      if (filters.statuses.size > 0 && !filters.statuses.has(st)) return false;
      if (!isWithinTimeWindow(it.action && it.action.invites, filters.timeWindow, filters.twFrom, filters.twTo)) return false;
      const ownersRaw = it.action && it.action.owner_email ? String(it.action.owner_email).toLowerCase() : '';
      const hasOwners = !!ownersRaw && ownersRaw.trim() !== '';
      if (filters.myActionsOnly) {
        if (!hasOwners) return false;
        const me = String(currentUserEmail || '').toLowerCase();
        if (!me || !ownersRaw.includes(me)) return false;
      } else {
        if (filters.unassigned && hasOwners) return false;
        if (filters.ownerQuery) {
          const toks = filters.ownerQuery.split('|').map(s => s.toLowerCase()).filter(Boolean);
          const any = toks.length === 0 ? true : toks.some(tok => ownersRaw.includes(tok));
          if (!any) return false;
        }
      }
      const addedBy = String(it.action && it.action.added_by || '');
      if (filters.srcSuggested && addedBy === 'Suggested Action') return false;
      if (filters.campaigns && filters.campaigns.size > 0) {
        const aId = String(it.action && it.action.assessment_id || '');
        let title = '';
        try {
          const match = (Array.isArray(loadedAssessInfo) ? loadedAssessInfo : []).find(x => String(x.assessment_id) === aId);
          title = match && match.title ? String(match.title) : '';
        } catch {}
        if (!title || !filters.campaigns.has(title)) return false;
      }
      if (!q) return true;
      const title = (it.recommendation && it.recommendation.action_title ? it.recommendation.action_title : '').toLowerCase();
      const code = (it.action && it.action.category_code ? it.action.category_code : '').toLowerCase();
      const name = (it.action && it.action.category_name ? it.action.category_name : '').toLowerCase();
      return title.includes(q) || code.includes(q) || name.includes(q);
    });
    // Sort: My Action > Suggested Action; question > category; priority High -> Low
    function sourceRank(it) {
      const ab = String(it.action && it.action.added_by || '');
      if (ab === 'My Action') return 0;
      if (ab === 'Suggested Action') return 1;
      return 2;
    }
    function typeRank(it) {
      const at = String(it.action && it.action.action_type || '');
      return at === 'question' ? 0 : 1;
    }
    function priorityRank(it) {
      const p = derivePriorityFromStage(it.action && it.action.stage);
      return p === 'High' ? 0 : (p === 'Medium' ? 1 : 2);
    }
    filteredItems.sort((a, b) => {
      const sa = sourceRank(a), sb = sourceRank(b);
      if (sa !== sb) return sa - sb;
      const ta = typeRank(a), tb = typeRank(b);
      if (ta !== tb) return ta - tb;
      const pa = priorityRank(a), pb = priorityRank(b);
      if (pa !== pb) return pa - pb;
      // stable fallback: list_order then id
      const la = Number(a.action && a.action.list_order) || 0;
      const lb = Number(b.action && b.action.list_order) || 0;
      if (la !== lb) return la - lb;
      const ia = Number(a.action && a.action.id) || 0;
      const ib = Number(b.action && b.action.id) || 0;
      return ia - ib;
    });
    console.log('[FilterBar] filtered count', filteredItems.length);
    visibleCount = PAGE_SIZE;
    renderList();
  }

  // After DOM loads partial, ensure bar changes apply
  document.addEventListener('DOMContentLoaded', () => {
    // initial attempt to bind owner list dynamically later
    setTimeout(() => { try { applyFilterFromBar(); populateOwnershipAndAssessmentsOptions(); } catch {} }, 50);
  });

  function renderList() {
    listEl.innerHTML = '';
    if (!filteredItems.length) {
      const li = document.createElement('li');
      li.className = 'text-slate-600 text-sm';
      li.textContent = 'No actions yet. Add from Details.';
      listEl.appendChild(li);
      detailsEl.innerHTML = '<div class="text-slate-600">Select an action on the left to view details.</div>';
      // Hide Show More if present
      let more = document.getElementById('actionsListMore');
      if (more) more.remove();
      return;
    }
    // Apply selection params only once (category_code, question_code, or action_id)
    if (!hasAppliedSelectParam) {
      const wantCat = getParam('select_category_code');
      const wantQ = getParam('select_question_code');
      const wantId = getParam('select_action_id');
      let found = null;
      if (wantId) {
        found = filteredItems.find(i => String(i.action.id) === String(wantId));
      } else if (wantQ) {
        found = filteredItems.find(i => String(i.action.question_code) === String(wantQ));
      } else if (wantCat) {
        found = filteredItems.find(i => String(i.action.category_code) === String(wantCat));
      }
      if (found) { selectedId = String(found.action.id); initialScrollPending = true; }
      hasAppliedSelectParam = true;
    }
    // Determine selected item (default to first)
    const selectedItem = filteredItems.find(i => String(i.action.id) === String(selectedId)) || filteredItems[0];
    selectedId = String(selectedItem.action.id);

    // Helper to render a single card li
    const renderCardLi = (it) => {
      const isSelected = String(it.action.id) === String(selectedId);
      const li = document.createElement('li');
      li.setAttribute('data-id', String(it.action.id));
      const title = it.recommendation && it.recommendation.action_title ? it.recommendation.action_title : '(Untitled)';
      const isQuestion = String(it.action && it.action.action_type) === 'question';
      const categoryNameNorm = normalizeCatName(it.action && it.action.category_name ? it.action.category_name : '');
      const categoryChipText = categoryNameNorm || (it.action && it.action.category_code ? it.action.category_code : '');
      const questionChipHtml = isQuestion && it.action && it.action.question_code
        ? `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style="background:#F1F5F9;color:#0F172A;border:1px solid #CBD5E1">Q ${it.action.question_code}</span>`
        : '';
      // map DB action_status -> UI label
      const dbStatus = it.action && it.action.action_status ? String(it.action.action_status) : null;
      const uiStatusFromDb = dbStatus
        ? (dbStatus === 'Active' ? 'In Progress'
          : (dbStatus === 'Postponed' ? 'On Hold' : dbStatus))
        : null;
      const status = uiStatusFromDb || (it.__status || (it.__status = randomPick(STATUS_OPTS)));
      const ownerContent = buildOwnerChipContent(it.action && it.action.owner_email ? String(it.action.owner_email) : '');
      const priority = derivePriorityFromStage(it.action && it.action.stage);
      const scoreImpact = 0;
      const progressPct = computeProgressFromAction(it.action);
      const statusStyle = status === 'Overdue'
        ? 'background:#FEF2F2;color:#B91C1C;border-color:#FECACA'
        : status === 'On Hold'
        ? 'background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'
        : status === 'In Progress'
          ? 'background:#ECFEFF;color:#00A8A8;border-color:#00A8A8'
          : status === 'Ready to Schedule'
            ? 'background:#E6F0FF;color:#0077FF;border-color:#0077FF'
            : status === 'Stage Changed'
              ? 'background:#FEF2F2;color:#B91C1C;border-color:#FECACA'
              : 'background:#F1F5F9;color:#0F172A;border-color:#CBD5E1';
      const prBg = priority === 'High' ? '#0077FF1a' : (priority === 'Medium' ? '#FFF7ED' : '#F1F5F9');
      const prFg = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#9A3412' : '#0F172A');
      const prBr = priority === 'High' ? '#0077FF' : (priority === 'Medium' ? '#FDBA74' : '#CBD5E1');
      // Stage badge colors matching legend
      const stage = Number(it.action && it.action.stage);
      const nextStage = Number.isFinite(stage) ? stage + 1 : null;
      const stageBg = Number.isFinite(stage)
        ? (stage === 0 ? '#f0f9ff'
          : stage === 1 ? '#e0f2fe'
          : stage === 2 ? '#bae6fd'
          : stage === 3 ? '#7dd3fc'
          : stage === 4 ? '#38bdf8'
          : '#0284c7')
        : '#e5e7eb';
      const stageText = Number.isFinite(stage) ? `${stage} → ${nextStage}` : '–';
      // Determine action date label from invites if present
      const inviteStr = it.action && it.action.invites ? String(it.action.invites) : '';
      let actionDateLabel = 'No date';
      if (inviteStr) {
        try {
          const parts = inviteStr.split('|');
          const ddmmyy = parts[0] || '';
          const timeHHMM = parts[1] || '';
          if (ddmmyy) actionDateLabel = ddmmyy + (timeHHMM ? (' at ' + timeHHMM) : '');
        } catch {}
      }
      li.innerHTML = `
        <div class="action-card w-full text-left rounded-2xl border p-4 transition hover:shadow cursor-pointer ${isSelected ? 'action-card-selected ring-2' : ''}" style="border-color:#E5E7EB; ${isSelected ? 'box-shadow: 0 0 0 2px #0077FF' : ''}; position: relative;" role="button" tabindex="0" ${it.action && it.action.assessment_id ? `data-assessment_id="${String(it.action.assessment_id)}"` : ''}>
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
                
                <div class="action-meta text-[12px] text-slate-500 mt-1 flex items-center gap-3">
                  <span class="action-status inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border" style="${statusStyle}">${statusIconSVG(status)} ${status}</span>
                  <span class="action-owner inline-flex items-center gap-1" style="${ownerContent.color ? `color:${ownerContent.color}` : ''}">${ownerContent.html}</span>
                  <span class="action-date inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${actionDateLabel}</span>
                  <span class="invite-count inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9 6 9-6"/><path d="M21 8v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/></svg> Invites ${Number(it.action && it.action.invites_count ? it.action.invites_count : 0)}</span>
              </div>
                <div class="action-progress mt-2 h-2 rounded-full bg-slate-200 overflow-hidden"><div class="h-2 bg-[#0077FF]" style="width:${progressPct}%"></div></div>
            </div>
            </div>
            <div class="flex flex-col items-end gap-2 action-card-right">
              <span class="inline-flex items-center rounded-md text-xs font-semibold" style="background:${stageBg}; padding: 4px 8px; color:#0F172A;">${stageText}</span>
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
      // Remove optional blocks
      try {
        const selChip = li.querySelector('.action-title + div.inline-flex');
        if (selChip && selChip.textContent && selChip.textContent.trim() === 'Selected') selChip.remove();
      } catch {}
      // backfill assessment id if needed
      setCardAssessmentIdAttr(li, it);
      // Delete wiring
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
    };

    // Render list only (no separate Selected section)
    const visibleItems = filteredItems.slice(0, visibleCount);
    for (const it of visibleItems) {
      renderCardLi(it);
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
    // Show More control
    let more = document.getElementById('actionsListMore');
    if (!more) {
      more = document.createElement('div');
      more.id = 'actionsListMore';
      more.style.marginTop = '12px';
      more.style.display = 'flex';
      more.style.justifyContent = 'center';
      listEl.parentNode.insertBefore(more, listEl.nextSibling);
    }
    const remainingItemsCount = filteredItems.length - visibleCount;
    if (remainingItemsCount > 0) {
      more.innerHTML = '<button id="actionsShowMoreBtn" class="rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0F172A">Show More</button>';
      const btn = more.querySelector('#actionsShowMoreBtn');
      if (btn) {
        btn.onclick = () => { visibleCount += PAGE_SIZE; renderList(); };
      }
    } else {
      more.innerHTML = '';
    }
    // If initial selection came from URL, scroll it into view once
    if (initialScrollPending) {
      try {
        const el = listEl.querySelector(`li[data-id="${String(selectedId)}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
      initialScrollPending = false;
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
      const resources = Array.isArray(it.resources) ? it.resources : [];
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
          ${resources.length ? resources.map(r => `
            <a href="${r.url}" target="_blank" rel="noopener" class="resource-link inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-slate-50" style="border-color:#E5E7EB">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              ${r.title || 'Resource'}
            </a>
          `).join('') : `
            <div class="text-sm text-slate-600">There are no resources available for instant download — request resources and we'll send them to you soon.</div>
            <button class="rounded-xl px-4 py-2 text-sm font-medium text-white shadow" id="requestResourcesBtn" style="background:#0F172A; align-self:start;">Request Resources</button>
          `}
        </div>
      </div>

      <div class="detail-panel mt-3 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Ownership & scheduling</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4 grid grid-cols-1 gap-4">
          <div class="ownership block rounded-xl border p-3 col-span-1" style="border-color:#E5E7EB">
            <div class="flex items-center gap-2 mb-2">
              <div class="text-sm font-medium whitespace-nowrap">Assign or add an owner</div>
              <input id="ownerEmailInput" type="email" placeholder="Enter your colleague's email address" value="" class="rounded-xl border px-3 py-2 text-sm flex-1" style="border-color:#E5E7EB" />
              <button id="assignOwnerBtn" class="rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0077FF">Assign</button>
            </div>
            <div id="ownersHeader" class="mt-3 text-sm font-medium">Assigned Owners:</div>
            <ul id="ownersList" class="mt-2 space-y-2"></ul>
          </div>
          <div class="scheduling block rounded-xl border p-3 col-span-1" style="border-color:#E5E7EB">
            <div class="text-sm font-medium mb-2 flex items-center justify-between"><span>Scheduling — Send a calendar invite</span><span id="inviteCount" class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]" style="border-color:#CBD5E1;color:#475569;background:#F8FAFC">Invites Sent ${Number(it.action && it.action.invites_count ? it.action.invites_count : 0)}</span></div>
            <div class="flex items-center gap-3 flex-wrap">
              <div id="schedEmailsContainer" class="flex items-center flex-wrap" style="padding:6px;border:1px solid #E5E7EB;border-radius:10px;min-height:40px;cursor:text;flex:1;min-width:320px;max-width:100%">
                <input id="schedEmailsInput" type="text" placeholder="Add recipients…" class="text-sm" style="border:none;outline:none;flex:1;min-width:140px;padding:4px 6px;" />
                <input id="schedEmailsValue" type="hidden" value="" />
              </div>
            </div>
            <div class="flex items-center gap-3 flex-wrap mt-2">
              <label for="schedDate" class="text-xs text-slate-600">Date</label>
              <input id="schedDate" type="date" class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB" />
              <label for="schedTime" class="text-xs text-slate-600">Time</label>
              <input id="schedTime" type="time" class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB" />
        
            </div>
            <div class="flex items-center gap-3 flex-wrap mt-2">
                <label for="schedDuration" class="text-xs text-slate-600">Duration</label>
                <select id="schedDuration" class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB">
                  <option value="15">15 min</option>
                  <option value="30" selected>30 min</option>
                  <option value="60">1 hr</option>
                  <option value="90">1.5 hr</option>
                  <option value="120">2 hr</option>
                  <option value="180">3 hr</option>
                  <option value="240">4 hr</option>
                </select>
                <label for="schedReminder" class="text-xs text-slate-600">Reminder</label>
                <select id="schedReminder" class="rounded-xl border px-3 py-2 text-sm" style="border-color:#E5E7EB">
                  <option value="5">5 min</option>
                  <option value="10">10 min</option>
                  <option value="15" selected>15 min</option>
                  <option value="20">20 min</option>
                  <option value="30">30 min</option>
                  <option value="60">1 hr</option>
                  <option value="120">2 hr</option>
                  <option value="180">3 hr</option>
            </select>
          </div>
            <div class="flex items-center gap-3 flex-wrap mt-2">
              <textarea id="schedDesc" rows="2" class="rounded-xl border p-3 text-sm flex-1 min-w-[320px]" placeholder="Add Description (optional)" style="border-color:#E5E7EB"></textarea>
              <button id="schedSendBtn" class="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow" style="background:#0077FF">Send</button>
          </div>
            <div id="schedStatus" class="mt-2 text-sm text-slate-600">Invite not sent yet</div>
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
        <div class="px-4 py-3 text-sm font-semibold">Status</div>
        <div class="px-4 pb-4">
          <div class="status block rounded-xl border p-3" style="border-color:#E5E7EB">
            <div id="statusHeader" class="text-sm font-medium mb-2">Status</div>
            <div class="status-pills mt-1 flex flex-wrap gap-2">
              <button class="status-pill button-secondary" data-status="Not Assigned">Not Assigned</button>
              <button class="status-pill button-secondary" data-status="Assigned">Assigned</button>
              <button class="status-pill button-secondary" data-status="Acknowledged">Acknowledged</button>
              <button class="status-pill button-secondary" data-status="Scheduled">Scheduled</button>
              <button class="status-pill button-secondary" data-status="In Progress">In Progress</button>
              <button class="status-pill button-secondary" data-status="Completed">Completed</button>
              <button class="status-pill button-secondary" data-status="Overdue">Overdue</button>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-panel mt-3 rounded-xl border" style="border-color:#E5E7EB">
        <button class="panel-header w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Activity log</span>
          <span aria-hidden>▾</span>
        </button>
        <div class="panel-body px-4 pb-4 hidden">
          <pre id="activityLog" class="text-xs text-slate-700 whitespace-pre-wrap"></pre>
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

    // Improve picker UX: open pickers when clicking anywhere on inputs/labels
    (function wirePickers() {
      const dateEl = detailsEl.querySelector('#schedDate');
      const timeEl = detailsEl.querySelector('#schedTime');
      const durEl = detailsEl.querySelector('#schedDuration');
      const dateLabel = detailsEl.querySelector('label[for="schedDate"]');
      const timeLabel = detailsEl.querySelector('label[for="schedTime"]');
      const durLabel = detailsEl.querySelector('label[for="schedDuration"]');

      function openDate() {
        if (!dateEl) return;
        if (typeof dateEl.showPicker === 'function') { try { dateEl.showPicker(); return; } catch {} }
        dateEl.focus();
      }
      function openTime() {
        if (!timeEl) return;
        if (typeof timeEl.showPicker === 'function') { try { timeEl.showPicker(); return; } catch {} }
        timeEl.focus();
      }
      function openDuration() {
        if (!durEl) return;
        try {
          durEl.focus();
          const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
          durEl.dispatchEvent(evt);
        } catch {
          durEl.click();
        }
      }

      if (dateEl) {
        dateEl.addEventListener('focus', openDate);
        dateEl.addEventListener('click', openDate);
      }
      if (timeEl) {
        timeEl.addEventListener('focus', openTime);
        timeEl.addEventListener('click', openTime);
      }
      if (durEl) {
        durEl.addEventListener('focus', openDuration);
        durEl.addEventListener('click', openDuration);
      }
      if (dateLabel) dateLabel.addEventListener('click', (e) => { e.preventDefault(); openDate(); });
      if (timeLabel) timeLabel.addEventListener('click', (e) => { e.preventDefault(); openTime(); });
      if (durLabel) durLabel.addEventListener('click', (e) => { e.preventDefault(); openDuration(); });
    })();

    // Populate activity log
    try {
      const logEl = detailsEl.querySelector('#activityLog');
      if (logEl) {
        const logText = it.action && it.action.log ? String(it.action.log) : '';
        logEl.textContent = logText || '—';
      }
    } catch {}

    // Wire Request Resources button if present
    const rrBtn = detailsEl.querySelector('#requestResourcesBtn');
    if (rrBtn) {
      rrBtn.addEventListener('click', () => {
        const email = getParam('email') || '';
        const isQuestion = String(it.action && it.action.action_type) === 'question';
        const qCode = isQuestion ? (it.action && it.action.question_code ? String(it.action.question_code) : '') : '';
        const qText = title || '';
        const stage = Number(it.action && it.action.stage);
        if (window.UI && typeof window.UI.showRequestResourcesModal === 'function') {
          window.UI.showRequestResourcesModal({ email, question_code: qCode, question_text: qText, stage });
        }
      });
    }

    // Render owners list from composite field owner_email: "email|Status|dd/mm/yy HH:mm,email2|Status|dd/mm/yy HH:mm"
    const ownersList = detailsEl.querySelector('#ownersList');
    const ownersHeader = detailsEl.querySelector('#ownersHeader');
    const formatDateTimeShort = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      const dd = pad(d.getDate());
      const mm = pad(d.getMonth() + 1);
      const yy = String(d.getFullYear()).slice(-2);
      const hh = pad(d.getHours());
      const mi = pad(d.getMinutes());
      return `${dd}/${mm}/${yy} ${hh}:${mi}`;
    };
    const parseDateTimeShort = (s) => {
      if (!s) return null;
      // expected dd/mm/yy HH:mm
      const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
      if (!m) return null;
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yy = Number(m[3]);
      const hh = Number(m[4] || '0');
      const mi = Number(m[5] || '0');
      const fullYear = 2000 + yy;
      const dt = new Date(fullYear, mm - 1, dd, hh, mi, 0, 0);
      if (isNaN(dt.getTime())) return null;
      return dt;
    };
    const parseOwners = (raw) => {
      if (!raw) return [];
      return String(raw).split(',').map(s => s.trim()).filter(Boolean).map(tok => {
        const parts = tok.split('|');
        const em = (parts[0] || '').trim();
        const status = (parts[1] || 'Pending').trim();
        const sentStr = (parts[2] || '').trim();
        return { email: em, status, sentAt: sentStr };
      }).filter(x => x.email);
    };
    const owners = parseOwners(it.action && it.action.owner_email ? it.action.owner_email : '');
    function statusIcon(status) {
      if (String(status).toLowerCase() === 'acknowledged') {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      }
      if (String(status).toLowerCase() === 'expired') {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      }
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    }
    function renderOwners() {
      if (!ownersList) return;
      // Auto-expire owners older than 7 days since sentAt, if not acknowledged
      let changed = false;
      const now = new Date();
      owners.forEach(o => {
        if (String(o.status).toLowerCase() === 'acknowledged') return;
        const dt = parseDateTimeShort(o.sentAt);
        if (dt) {
          const diffDays = (now - dt) / (1000 * 60 * 60 * 24);
          if (diffDays > 7 && String(o.status).toLowerCase() !== 'expired') {
            o.status = 'Expired';
            changed = true;
          }
        }
      });
      if (changed) { persistOwners(); }
      ownersList.innerHTML = '';
      if (ownersHeader) {
        if (owners.length) {
          ownersHeader.textContent = 'Assigned Owners:';
        } else {
          ownersHeader.innerHTML = '<span class="inline-flex items-center gap-2 text-slate-600"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No Owners Assigned</span>';
        }
      }
      owners.forEach((o, idx) => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between rounded-lg border px-3 py-2';
        li.style.borderColor = '#E5E7EB';
        li.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="text-slate-800 text-sm">${o.email}</span>
            <button class="owner-status inline-flex items-center gap-1 text-xs font-medium ${String(o.status).toLowerCase()==='acknowledged' ? 'text-green-600' : (String(o.status).toLowerCase()==='expired' ? 'text-red-600' : 'text-amber-600')}" data-idx="${idx}" data-status="${o.status}">${statusIcon(o.status)} ${o.status}</button>
          </div>
          <div class="flex items-center gap-3">
            ${o.sentAt ? `<span class="text-xs text-slate-400">${o.sentAt}</span>` : ''}
            <button class="owner-remove text-red-600" data-idx="${idx}" title="Remove owner" aria-label="Remove owner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>`;
        ownersList.appendChild(li);
      });
      // Status change dropdown
      ownersList.querySelectorAll('.owner-status').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = Number(btn.getAttribute('data-idx'));
          if (!Number.isInteger(idx)) return;
          const menu = document.createElement('div');
          menu.className = 'absolute bg-white border rounded-lg shadow text-sm';
          menu.style.borderColor = '#E5E7EB';
          menu.style.zIndex = '10000';
          menu.innerHTML = `
            <button class="block px-3 py-1 w-full text-left hover:bg-slate-50" data-new-status="Acknowledged">Acknowledged</button>
            <button class="block px-3 py-1 w-full text-left hover:bg-slate-50" data-new-status="Pending">Pending</button>
            <button class="block px-3 py-1 w-full text-left hover:bg-slate-50" data-new-status="Expired">Expired</button>
          `;
          // Position near button
          const rect = btn.getBoundingClientRect();
          menu.style.position = 'fixed';
          menu.style.top = (rect.bottom + 6) + 'px';
          menu.style.left = (rect.left) + 'px';
          document.body.appendChild(menu);
          const close = () => { try { menu.remove(); } catch {} };
          menu.querySelectorAll('[data-new-status]').forEach(opt => {
            opt.addEventListener('click', async () => {
              const ns = String(opt.getAttribute('data-new-status'));
              owners[idx].status = ns;
              if (ns === 'Acknowledged') {
                // keep original sentAt; do not change
              } else if (!owners[idx].sentAt) {
                owners[idx].sentAt = formatDateTimeShort(new Date());
              }
              await persistOwners();
              // If owner changed to Acknowledged, set action status to Acknowledged
              if (ns === 'Acknowledged') {
                try {
                  await fetch(`/api/v1/setActionStatus?action_id=${encodeURIComponent(it.action.id)}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_status: 'Acknowledged' })
                  });
                  if (it.action) it.action.action_status = 'Acknowledged';
                  // reflect in pills and left badge
                  const pillsWrap = detailsEl.querySelector('.status .status-pills');
                  if (pillsWrap) {
                    pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
                      const isActive = b.getAttribute('data-status') === 'Acknowledged';
                      if (isActive) { b.classList.remove('button-secondary'); b.classList.add('button-primary'); b.setAttribute('aria-pressed','true'); }
                      else { b.classList.remove('button-primary'); b.classList.add('button-secondary'); b.setAttribute('aria-pressed','false'); }
                    });
                  }
                  const card = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-status`);
                  if (card) { card.setAttribute('style','background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'); card.innerHTML = `${statusIconSVG('Acknowledged')} Acknowledged`; }
                } catch {}
              }
              renderOwners();
              close();
            });
          });
          document.addEventListener('click', function one(e2){ if (!menu.contains(e2.target) && e2.target !== btn) { close(); document.removeEventListener('click', one); } });
        });
      });
      ownersList.querySelectorAll('.owner-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.getAttribute('data-idx'));
          if (!Number.isInteger(idx)) return;
          owners.splice(idx, 1);
          await persistOwners();
          renderOwners();
          // Reflect left card owner text if removing current owner email
          updateOwnerChipForAction(it.action.id, owners.map(o => `${o.email}|${o.status}${o.sentAt ? '|' + o.sentAt : ''}`).join(','));
          // If no owners remain, set status back to Not Assigned and update UI
          if (owners.length === 0) {
            try {
              await fetch(`/api/v1/setActionStatus?action_id=${encodeURIComponent(it.action.id)}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_status: 'Not Assigned' })
              });
              if (it.action) it.action.action_status = 'Not Assigned';
              const pillsWrap = detailsEl.querySelector('.status .status-pills');
              if (pillsWrap) {
                pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
                  const isActive = b.getAttribute('data-status') === 'Not Assigned';
                  if (isActive) { b.classList.remove('button-secondary'); b.classList.add('button-primary'); b.setAttribute('aria-pressed','true'); }
                  else { b.classList.remove('button-primary'); b.classList.add('button-secondary'); b.setAttribute('aria-pressed','false'); }
                });
              }
              const card = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-status`);
              if (card) { card.setAttribute('style','background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'); card.innerHTML = `${statusIconSVG('Not Assigned')} Not Assigned`; }
              showToast('Status set to Not Assigned', 'success');
            } catch {}
          }
        });
      });
      // Update left card owner chip for expired state
      try { updateOwnerChipForAction(it.action.id, owners.map(o => `${o.email}|${o.status}${o.sentAt ? '|' + o.sentAt : ''}`).join(',')); } catch {}
    }
    async function persistOwners() {
      const composite = owners.map(o => `${o.email}|${o.status}${o.sentAt ? '|' + o.sentAt : ''}`).join(',');
      try {
        const resp = await fetch(`/api/v1/setActionOwnersRaw?action_id=${encodeURIComponent(it.action.id)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owners: composite })
        });
        if (!resp.ok) {
          const t = await resp.text().catch(() => '');
          throw new Error(t || `Failed (${resp.status})`);
        }
        // Update in-memory
        if (it.action) it.action.owner_email = composite;
      } catch (e) {
        console.error('persistOwners error', e);
        showToast('Failed to save owners', 'error');
      }
    }
    renderOwners();

    // Wire Assign button to send email via backend
    const assignBtn = detailsEl.querySelector('#assignOwnerBtn');
    if (assignBtn) {
      assignBtn.addEventListener('click', async () => {
        const emailInput = detailsEl.querySelector('#ownerEmailInput');
        const toEmail = emailInput && emailInput.value ? String(emailInput.value).trim() : '';
        const statusVal = 'Assigned';
        if (!toEmail || !toEmail.includes('@')) { showToast('Please enter a valid owner email', 'warning'); return; }
        const deepLink = window.location.href;
        try {
          assignBtn.disabled = true;
          assignBtn.style.opacity = '0.6';
          const senderEmail = (window.Api && typeof window.Api.getQueryParam === 'function') ? (window.Api.getQueryParam('email') || '') : (typeof getParam === 'function' ? (getParam('email') || '') : '');
          const url = `/api/v1/sendAssignmentEmail${senderEmail ? `?email=${encodeURIComponent(senderEmail)}` : ''}`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_email: toEmail, status: statusVal, link: deepLink, action_title: title, action_id: it.action.id, why_it_matters: why })
          });
          if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(t || `Failed (${resp.status})`);
          }
          showToast('Assignment email sent', 'success');
          // Add to owners with Pending status
          owners.push({ email: toEmail, status: 'Pending', sentAt: formatDateTimeShort(new Date()) });
          try {
            await fetch(`/api/v1/setActionStatus?action_id=${encodeURIComponent(it.action.id)}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_status: 'Assigned' })
            });
            if (it.action) it.action.action_status = 'Assigned';
            // Reflect in pills and left badge
            const pillsWrap = detailsEl.querySelector('.status .status-pills');
            if (pillsWrap) {
              pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
                const isActive = b.getAttribute('data-status') === 'Assigned';
                if (isActive) { b.classList.remove('button-secondary'); b.classList.add('button-primary'); b.setAttribute('aria-pressed', 'true'); }
                else { b.classList.remove('button-primary'); b.classList.add('button-secondary'); b.setAttribute('aria-pressed', 'false'); }
              });
            }
            const card = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-status`);
            if (card) { card.setAttribute('style','background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'); card.innerHTML = `${statusIconSVG('Assigned')} Assigned`; }
          } catch {}
          await persistOwners();
          renderOwners();
          // reflect list chip
          const ownerChip = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-owner`);
          if (ownerChip) ownerChip.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg> ' + owners.map(o => o.email).join(', ');
          // clear input
          if (emailInput) emailInput.value = '';
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
    // Wire Schedule description toggle
    // Description now always visible in row 3
    // Invite status renderer
    function setInviteStatus(sent, text) {
      const statusEl = detailsEl.querySelector('#schedStatus');
      if (!statusEl) return;
      const alertIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      const clockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      if (sent) {
        statusEl.style.background = '#ECFDF5';
        statusEl.style.border = '1px solid #A7F3D0';
        statusEl.style.color = '#065F46';
        statusEl.style.borderRadius = '10px';
        statusEl.style.padding = '6px 10px';
        statusEl.innerHTML = `${clockIcon} ${text}`;
      } else {
        statusEl.style.background = '#FEF2F2';
        statusEl.style.border = '1px solid #FECACA';
        statusEl.style.color = '#B91C1C';
        statusEl.style.borderRadius = '10px';
        statusEl.style.padding = '6px 10px';
        statusEl.innerHTML = `${alertIcon} ${text}`;
      }
    }
      // Initialize invite status based on existing invites
    try {
      const inv = it.action && it.action.invites ? String(it.action.invites) : '';
      if (inv) {
        const parts = inv.split('|');
          const schedOn = parts[0] || ''; // dd/mm/yy
          const schedAt = parts[1] || ''; // HH:MM
          const emailsStr = parts[2] || '';
        const names = emailsStr.split(',').map(s => s.trim()).filter(Boolean).map(e => formatOwnerNameFromEmail(e));
        const sentWhen = (() => { const d = new Date(); return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`; })();
        const namesStr = joinNamesWithCommaAnd(names);
          setInviteStatus(true, `Scheduled to ${schedOn}${schedAt ? ' at ' + schedAt : ''} on ${sentWhen}${namesStr ? ' for ' + namesStr : ''}`);
      } else {
        setInviteStatus(false, 'Invite not sent yet');
      }
    } catch { setInviteStatus(false, 'Invite not sent yet'); }
    // Wire Send (save invites to DB and update status + log handled backend)
    const sendBtn = detailsEl.querySelector('#schedSendBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        if (sendBtn.__busy) return;
        const dateEl = detailsEl.querySelector('#schedDate');
        const emailsHidden = detailsEl.querySelector('#schedEmailsValue');
        const durEl = detailsEl.querySelector('#schedDuration');
        const remEl = detailsEl.querySelector('#schedReminder');
        const descEl = detailsEl.querySelector('#schedDesc');
        const timeEl = detailsEl.querySelector('#schedTime');
        const statusEl = detailsEl.querySelector('#schedStatus');
        const dateRaw = dateEl && dateEl.value ? String(dateEl.value) : '';
        const emails = emailsHidden && emailsHidden.value ? String(emailsHidden.value) : '';
        const timeRaw = timeEl && timeEl.value ? String(timeEl.value) : '';
        if (!dateRaw) { showToast('Please select a date', 'error'); return; }
        if (!timeRaw) { showToast('Please select a time', 'error'); return; }
        const duration = durEl && durEl.options && durEl.selectedOptions && durEl.selectedOptions[0] ? durEl.selectedOptions[0].textContent : '30 min';
        const reminder = remEl && remEl.options && remEl.selectedOptions && remEl.selectedOptions[0] ? remEl.selectedOptions[0].textContent : '15 min';
        const desc = descEl && descEl.value ? String(descEl.value) : '';
        // Format date dd/mm/yy
        let dateOut = '';
        if (dateRaw) {
          try {
            const d = new Date(dateRaw);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yy = String(d.getFullYear()).slice(-2);
            dateOut = `${dd}/${mm}/${yy}`;
          } catch { dateOut = dateRaw; }
        }
        const invitesStr = `${dateOut}|${timeRaw}|${emails}|${duration}|${reminder}|${desc}`;
        try {
          sendBtn.__busy = true;
          const prevText = sendBtn.textContent;
          sendBtn.textContent = 'Sending…';
          sendBtn.disabled = true;
          const resp = await fetch(`/api/v1/setActionOwnersRaw?action_id=${encodeURIComponent(it.action.id)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owners: it.action.owner_email || '' })
          });
          // Save invites
          await fetch(`/api/v1/setActionInvites?action_id=${encodeURIComponent(it.action.id)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invites: invitesStr })
          });
          // Update UI line: Sent on Apr 20 to James and Lo
          const names = emails.split(',').map(s => s.trim()).filter(Boolean).map(e => formatOwnerNameFromEmail(e));
          const sentWhen = (() => { const d = new Date(); return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`; })();
          setInviteStatus(true, `Scheduled to ${dateOut || '—'} at ${timeRaw} on ${sentWhen}${names.length ? ' for ' + joinNamesWithCommaAnd(names) : ''}`);
          // Increment invite counts in UI
          try {
            const badge = detailsEl.querySelector('#inviteCount');
            if (badge) {
              const current = Number((badge.textContent || '').replace(/[^0-9]/g, '')) || 0;
              badge.textContent = `Invites Sent ${current + 1}`;
            }
            const card = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .invite-count`);
            if (card) {
              const current = Number((card.textContent || '').replace(/[^0-9]/g, '')) || 0;
              card.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9 6 9-6"/><path d="M21 8v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/></svg> Invites ' + (current + 1);
            }
            const dateSpan = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-date`);
            if (dateSpan) {
              dateSpan.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ' + (dateOut || '—') + ' at ' + timeRaw;
            }
          } catch {}
          showToast('Invite Sent', 'success');
          // Set status to Scheduled
          try {
            await fetch(`/api/v1/setActionStatus?action_id=${encodeURIComponent(it.action.id)}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_status: 'Scheduled' })
            });
            if (it.action) it.action.action_status = 'Scheduled';
            // Reflect in pills and left badge
            const pillsWrap = detailsEl.querySelector('.status .status-pills');
            if (pillsWrap) {
              pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
                const isActive = b.getAttribute('data-status') === 'Scheduled';
                if (isActive) { b.classList.remove('button-secondary'); b.classList.add('button-primary'); b.setAttribute('aria-pressed', 'true'); }
                else { b.classList.remove('button-primary'); b.classList.add('button-secondary'); b.setAttribute('aria-pressed', 'false'); }
              });
            }
            const card = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-status`);
            if (card) { card.setAttribute('style','background:#E6F0FF;color:#0077FF;border-color:#0077FF'); card.innerHTML = `${statusIconSVG('Scheduled')} Scheduled`; }
          } catch {}
          sendBtn.textContent = prevText;
          sendBtn.disabled = false;
          sendBtn.__busy = false;
        } catch (e) {
          console.error('save invites error', e);
          showToast('Failed to save invite', 'error');
          sendBtn.disabled = false;
          sendBtn.__busy = false;
        }
      });
    }

    // Wire multi-email input (Gmail-like)
    (function wireMultiEmail() {
      const cont = detailsEl.querySelector('#schedEmailsContainer');
      const input = detailsEl.querySelector('#schedEmailsInput');
      const hiddenVal = detailsEl.querySelector('#schedEmailsValue');
      if (!cont || !input || !hiddenVal) return;
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const tags = [];
      function updateHidden() { hiddenVal.value = tags.join(','); }
      function makeTag(email) {
        const span = document.createElement('span');
        span.className = 'email-tag inline-flex items-center rounded-full border text-xs';
        span.style.background = '#F1F5F9';
        span.style.borderColor = '#E5E7EB';
        span.style.padding = '3px 8px';
        span.style.margin = '2px';
        span.textContent = email;
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'ml-2';
        rm.textContent = '×';
        rm.style.color = '#64748B';
        rm.onclick = () => {
          const idx = tags.indexOf(email);
          if (idx >= 0) tags.splice(idx, 1);
          span.remove();
          updateHidden();
        };
        span.appendChild(rm);
        cont.insertBefore(span, input);
      }
      function addEmail(email) {
        const e = String(email || '').trim();
        if (!e || !emailRe.test(e) || tags.includes(e)) return false;
        tags.push(e);
        makeTag(e);
        updateHidden();
        return true;
      }
      function tryConsume() {
        const text = String(input.value || '').trim();
        if (!text) return;
        const parts = text.split(/[\s,;]+/).filter(Boolean);
        let added = false;
        parts.forEach(p => {
          if (addEmail(p)) added = true;
        });
        if (added) { input.value = ''; updateHidden(); }
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
          e.preventDefault();
          tryConsume();
        } else if (e.key === 'Backspace' && !input.value) {
          // remove last
          const last = cont.querySelector('.email-tag:last-of-type');
          if (last) {
            const email = last.firstChild && last.firstChild.textContent ? last.firstChild.textContent : last.textContent.replace('×','').trim();
            const idx = tags.lastIndexOf(email);
            if (idx >= 0) tags.splice(idx, 1);
            last.remove();
            updateHidden();
          }
        }
      });
      input.addEventListener('blur', tryConsume);
      cont.addEventListener('click', () => input.focus());
      // Expose method to add initial emails
      cont.__addEmails = function(arr) {
        if (!Array.isArray(arr)) return;
        arr.forEach(addEmail);
      };
    })();

    // Pre-populate emails with owners, prior invite emails, and current user (if different)
    try {
      const cont = detailsEl.querySelector('#schedEmailsContainer');
      const currentUserEmail = getParam('email');
      const ownerEmailsInit = (owners || []).map(o => String(o.email || '').trim()).filter(Boolean);
      const initSet = new Set(ownerEmailsInit);
      // Add from previous invites if present
      try {
        const inv = it.action && it.action.invites ? String(it.action.invites) : '';
        if (inv) {
          const parts = inv.split('|');
          const emailsStr = parts[1] || '';
          emailsStr.split(',').map(s => s.trim()).filter(Boolean).forEach(e => initSet.add(e));
        }
      } catch {}
      if (currentUserEmail) {
        const me = String(currentUserEmail).trim();
        if (me && !initSet.has(me)) initSet.add(me);
      }
      const initList = Array.from(initSet);
      if (cont && typeof cont.__addEmails === 'function') cont.__addEmails(initList);
    } catch {}
    // Removed legacy Owner acknowledged checkbox UI

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

      const updateLeftStatusBadge = (uiLabel) => {
        const card = listEl.querySelector(`li[data-id="${String(it.action.id)}"] .action-status`);
        if (!card) return;
        const style = uiLabel === 'Completed'
          ? 'background:#ECFDF5;color:#065F46;border-color:#A7F3D0'
          : uiLabel === 'In Progress'
            ? 'background:#ECFEFF;color:#00A8A8;border-color:#00A8A8'
            : uiLabel === 'Scheduled'
              ? 'background:#E6F0FF;color:#0077FF;border-color:#0077FF'
              : 'background:#F1F5F9;color:#0F172A;border-color:#CBD5E1';
        card.setAttribute('style', style);
        card.innerHTML = `${statusIconSVG(uiLabel)} ${uiLabel}`;
      };

      // Initialize selection from server value if present
      const normalizeStatusForPills = (s) => {
        const v = String(s || '').trim();
        if (v === 'Active') return 'In Progress';
        if (v === 'Ready' || v === 'Ready to Schedule') return 'Scheduled';
        return v;
      };
      let initialStatus = it.action && it.action.action_status ? String(it.action.action_status) : '';
      if (!initialStatus) {
        // Fallback inference when DB status missing
        const hasInvites = !!(it.action && it.action.invites);
        const hasOwners = !!(it.action && it.action.owner_email);
        if (hasInvites) initialStatus = 'Scheduled';
        else if (hasOwners) initialStatus = 'Assigned';
        else initialStatus = 'Not Assigned';
      }
      setPillsSelection(normalizeStatusForPills(initialStatus));

      // Only owners can change status via pills
      const currentUserEmail = (getParam('email') || '').trim().toLowerCase();
      const isOwner = Array.isArray(owners) && owners.some(o => String(o.email || '').trim().toLowerCase() === currentUserEmail);
      if (!isOwner) {
        // Show hint in header instead of dimming
        const hdr = detailsEl.querySelector('#statusHeader');
        if (hdr) hdr.innerHTML = '<b>Status</b> - <span class="text-slate-600">Can only be changed by owner</span>';
        pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
          b.setAttribute('aria-disabled', 'true');
          b.style.cursor = 'not-allowed';
          b.title = 'Only assigned owners can change status';
        });
      }

      pillsWrap.querySelectorAll('button[data-status]').forEach(btn => {
        btn.addEventListener('click', async () => {
          // Block non-owners
          if (!isOwner) { showToast('Only owners can change status', 'warning'); return; }
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
            updateLeftStatusBadge(newStatus);
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
      const data = await fetchRecommendationsByDomain(email);
      let items = Array.isArray(data.items) ? data.items.slice() : [];
      // Hide Stage Changed
      items = items.filter(i => String(i.action && i.action.action_status) !== 'Stage Changed');
      // Sort order:
      // 1) Non-postponed first
      // 2) My Action before Suggested Action
      // 3) Question-based before Category-based
      // 4) Priority High > Medium > Low
      // 5) list_order asc as final tiebreaker
      items.sort((a, b) => {
        const aPost = String(a.action && a.action.action_status) === 'Postponed';
        const bPost = String(b.action && b.action.action_status) === 'Postponed';
        if (aPost !== bPost) return aPost ? 1 : -1;

        const aAdded = (a.action && a.action.added_by) === 'My Action' ? 0 : 1;
        const bAdded = (b.action && b.action.added_by) === 'My Action' ? 0 : 1;
        if (aAdded !== bAdded) return aAdded - bAdded;

        const aType = (a.action && String(a.action.action_type) === 'question') ? 0 : 1;
        const bType = (b.action && String(b.action.action_type) === 'question') ? 0 : 1;
        if (aType !== bType) return aType - bType;

        const prRank = (it) => {
          const pr = derivePriorityFromStage(it.action && it.action.stage);
          return pr === 'High' ? 0 : (pr === 'Medium' ? 1 : 2);
        };
        const aPr = prRank(a);
        const bPr = prRank(b);
        if (aPr !== bPr) return aPr - bPr;

        const ao = Number(a.action && a.action.list_order) || 0;
        const bo = Number(b.action && b.action.list_order) || 0;
        return ao - bo;
      });
      rawItems = items;
      filteredItems = items.slice();
      visibleCount = PAGE_SIZE;
      if (rawItems.length) {
        const wantCat = getParam('select_category_code');
        const wantQ = getParam('select_question_code');
        const wantId = getParam('select_action_id');
        let found = null;
        if (wantId) {
          found = rawItems.find(i => String(i.action.id) === String(wantId));
        } else if (wantQ) {
          found = rawItems.find(i => String(i.action.question_code) === String(wantQ));
        } else if (wantCat) {
          found = rawItems.find(i => String(i.action.category_code) === String(wantCat));
        }
        selectedId = found ? String(found.action.id) : String(rawItems[0].action.id);
        hasAppliedSelectParam = true;
      }
      renderList();

      // Handle acknowledge banner if requested
      try { handleAcknowledgeBanner(); } catch {}
    } catch (err) {
      listEl.innerHTML = `<li class="text-red-700 text-sm">Failed to load: ${err && err.message ? err.message : String(err)}</li>`;
    }

    if (searchInput) searchInput.addEventListener('input', applyFilter);
    if (filterSelect) filterSelect.addEventListener('change', applyFilter);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Acknowledge banner: slide-in bottom prompt when acknowledge=true is in URL
  let ackBannerShown = false;
  function handleAcknowledgeBanner() {
    const ack = String(getParam('acknowledge') || '').toLowerCase();
    if ((ack !== 'true' && ack !== 'direct') || ackBannerShown) return;
    const email = getParam('email');
    if (!email) return;
    const selected = rawItems.find(i => String(i.action.id) === String(selectedId));
    if (!selected) return;
    const ownerRaw = selected.action && selected.action.owner_email ? String(selected.action.owner_email) : '';
    const ownerEmails = ownerRaw
      .split(',')
      .map(s => s.split('|')[0])
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const matches = ownerEmails.includes(String(email).trim().toLowerCase());

    const banner = document.createElement('div');
    banner.id = 'ackBanner';
    banner.style.position = 'fixed';
    banner.style.left = '0';
    banner.style.right = '0';
    banner.style.bottom = '0';
    banner.style.zIndex = '9999';
    banner.style.background = 'rgba(0,0,0,0.92)';
    banner.style.color = '#fff';
    banner.style.padding = '24px';
    banner.style.minHeight = '140px';
    banner.style.transform = 'translateY(100%)';
    banner.style.transition = 'transform 260ms ease';
    banner.style.alignItems = 'center';
    banner.style.display = 'flex';
    banner.innerHTML = `
      <button id="ackBannerClose" aria-label="Close" title="Close" style="position:absolute;top:10px;right:12px;background:transparent;border:none;color:#fff;font-size:20px;line-height:1;cursor:pointer">×</button>
      <div style="max-width: 1080px; margin: 0 auto; display:flex; flex-direction:column; align-items:center; justify-content:center; gap: 14px; text-align:center; height:100%">
        <div style="font-size: 18px; line-height: 1.6;">
          ${ack === 'direct' && matches
            ? 'You are now among the owners of this action.'
            : (matches
              ? 'This task has been assigned to you. Do you want to acknowledge it?'
              : 'This task has been assigned to another user. Only the account linked to the assigned email can acknowledge it.')}
        </div>
        ${(ack === 'direct' || !matches) ? '' : '<button id="ackBannerBtn" style="background:#16A34A;color:#fff;border:none;border-radius:12px;padding:10px 16px;font-weight:700;font-size:14px">Acknowledge</button>'}
      </div>`;
    document.body.appendChild(banner);
    setTimeout(() => { try { banner.style.transform = 'translateY(0)'; } catch {} }, 1600);
    ackBannerShown = true;

    function closeBanner() {
      try {
        banner.style.transform = 'translateY(100%)';
        setTimeout(() => banner.remove(), 300);
      } catch {}
    }

    const closeBtn = banner.querySelector('#ackBannerClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeBanner());
    }

    async function autoAcknowledge() {
      try {
        // First update the boolean flag if API exists
        try {
          await fetch(`/api/v1/setOwnerAcknowledged?action_id=${encodeURIComponent(selected.action.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged: true })
          });
          selected.action.owner_acknowledged = true;
        } catch {}

        // Then persist composite owners string with Acknowledged for current email
        try {
          const ownersListRaw = (selected.action && selected.action.owner_email) ? String(selected.action.owner_email) : '';
          const parts = ownersListRaw ? ownersListRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
          const updated = parts.map(p => {
            const [em, st] = p.split('|');
            if (em && email && em.trim().toLowerCase() === String(email).trim().toLowerCase()) return `${em}|Acknowledged`;
            return p;
          }).join(',');
          if (updated && updated !== ownersListRaw) {
            await fetch(`/api/v1/setActionOwnersRaw?action_id=${encodeURIComponent(selected.action.id)}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owners: updated })
            });
            selected.action.owner_email = updated;
          }
        } catch {}

        updateCardProgress(selected.action.id, selected.action);
        try { renderDetails(); } catch {}
        showToast('Acknowledged', 'success');
        // Reflect status-pill and left badge
        try {
          const pillsWrap = detailsEl && detailsEl.querySelector ? detailsEl.querySelector('.status .status-pills') : null;
          if (pillsWrap) {
            pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
              const isActive = b.getAttribute('data-status') === 'Acknowledged';
              if (isActive) { b.classList.remove('button-secondary'); b.classList.add('button-primary'); b.setAttribute('aria-pressed','true'); }
              else { b.classList.remove('button-primary'); b.classList.add('button-secondary'); b.setAttribute('aria-pressed','false'); }
            });
          }
          const card = listEl && listEl.querySelector ? listEl.querySelector(`li[data-id="${String(selected.action.id)}"] .action-status`) : null;
          if (card) { card.setAttribute('style','background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'); card.innerHTML = `${statusIconSVG('Acknowledged')} Acknowledged`; }
        } catch {}
        try {
          await fetch(`/api/v1/setActionStatus?action_id=${encodeURIComponent(selected.action.id)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_status: 'Acknowledged' })
          });
          if (selected.action) selected.action.action_status = 'Acknowledged';
        } catch {}
        try {
          const current = new URL(window.location.href);
          current.searchParams.delete('acknowledge');
          window.history.replaceState({}, '', current.toString());
        } catch {}
      } catch (err) {
        console.error('auto acknowledge error', err);
        showToast('Failed to acknowledge', 'error');
      }
    }

    if (ack === 'direct' && matches) {
      autoAcknowledge();
    } else if (matches) {
      const btn = banner.querySelector('#ackBannerBtn');
      if (btn) {
        btn.addEventListener('click', async () => {
          try {
            btn.disabled = true; btn.style.opacity = '0.7';
            const resp = await fetch(`/api/v1/setOwnerAcknowledged?action_id=${encodeURIComponent(selected.action.id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ acknowledged: true })
            });
            if (!resp.ok) {
              const t = await resp.text().catch(() => '');
              throw new Error(t || `Failed (${resp.status})`);
            }
            // Update model and UI
            selected.action.owner_acknowledged = true;
            // Update owners list composite and UI list row to Acknowledged
            try {
              const ownersListRaw = (selected.action && selected.action.owner_email) ? String(selected.action.owner_email) : '';
              const parts = ownersListRaw ? ownersListRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
              const email = getParam('email');
              const updated = parts.map(p => {
                const [em, st] = p.split('|');
                if (em && email && em.trim().toLowerCase() === String(email).trim().toLowerCase()) return `${em}|Acknowledged`;
                return p;
              }).join(',');
              if (updated !== ownersListRaw) {
                await fetch(`/api/v1/setActionOwnersRaw?action_id=${encodeURIComponent(selected.action.id)}`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owners: updated })
                });
                selected.action.owner_email = updated;
                // Re-render details to refresh owners list UI
                try { renderDetails(); } catch {}
              }
            } catch {}
            updateCardProgress(selected.action.id, selected.action);
            showToast('Acknowledged', 'success');
            // Reflect pills and left badge immediately
            try {
              const pillsWrap = detailsEl && detailsEl.querySelector ? detailsEl.querySelector('.status .status-pills') : null;
              if (pillsWrap) {
                pillsWrap.querySelectorAll('button[data-status]').forEach(b => {
                  const isActive = b.getAttribute('data-status') === 'Acknowledged';
                  if (isActive) { b.classList.remove('button-secondary'); b.classList.add('button-primary'); b.setAttribute('aria-pressed','true'); }
                  else { b.classList.remove('button-primary'); b.classList.add('button-secondary'); b.setAttribute('aria-pressed','false'); }
                });
              }
              const card = listEl && listEl.querySelector ? listEl.querySelector(`li[data-id="${String(selected.action.id)}"] .action-status`) : null;
              if (card) { card.setAttribute('style','background:#F1F5F9;color:#0F172A;border-color:#CBD5E1'); card.innerHTML = `${statusIconSVG('Acknowledged')} Acknowledged`; }
            } catch {}
            try {
              await fetch(`/api/v1/setActionStatus?action_id=${encodeURIComponent(selected.action.id)}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_status: 'Acknowledged' })
              });
              if (selected.action) selected.action.action_status = 'Acknowledged';
            } catch {}
            // Reflect checkbox in details panel if present
            try {
              const cb = detailsEl && detailsEl.querySelector ? detailsEl.querySelector('#ownerAckCheckbox') : null;
              if (cb) cb.checked = true;
            } catch {}
            // Remove acknowledge=true from URL without reloading
            try {
              const current = new URL(window.location.href);
              current.searchParams.delete('acknowledge');
              window.history.replaceState({}, '', current.toString());
            } catch {}
            // Close banner after acknowledge
            try {
              const bn = document.getElementById('ackBanner');
              if (bn) {
                bn.style.transform = 'translateY(100%)';
                setTimeout(() => bn.remove(), 300);
              }
            } catch {}
          } catch (err) {
            console.error('acknowledge error', err);
            showToast('Failed to acknowledge', 'error');
            btn.disabled = false; btn.style.opacity = '';
          }
        });
      }
    }
  }

  // Initialize filters and load info
  loadFilters();
  loadAssessmentInfoForFilters().then(() => wireFilterBar()).catch(() => wireFilterBar());

  function populateOwnershipAndAssessmentsOptions() {
    try {
      const root = document.querySelector('.filter-bar');
      if (!root) { console.warn('[FilterBar] root not found'); return; }
      // Ownership emails
      const ownershipFilter = Array.from(root.querySelectorAll('.filter')).find(f => (f.getAttribute('data-filter') || '').toLowerCase() === 'ownership');
      if (!ownershipFilter) { console.warn('[FilterBar] ownership filter not found'); }
      if (ownershipFilter) {
        const opts = ownershipFilter.querySelector('.options');
        if (!opts) { console.warn('[FilterBar] ownership options not found'); }
        if (opts) {
          console.log('[FilterBar] building ownership list from rawItems count', (rawItems || []).length);
          // Preserve first two: Unassigned, My Actions (if present)
          const allLabels = Array.from(opts.querySelectorAll('label'));
          const staticLabels = allLabels.slice(0, 2);
          opts.innerHTML = '';
          const clearBtn = document.createElement('button');
          clearBtn.className = 'clear-btn';
          clearBtn.textContent = 'Clear';
          clearBtn.addEventListener('click', () => {
            opts.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.dispatchEvent(new CustomEvent('filterbar:changed'));
          });
          opts.appendChild(clearBtn);
          staticLabels.forEach(l => opts.appendChild(l));
          const emailsSet = new Set();
          (rawItems || []).forEach(it => {
            const ownersRaw = it.action && it.action.owner_email ? String(it.action.owner_email) : '';
            if (!ownersRaw) return;
            ownersRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(tok => {
              const email = tok.split('|')[0];
              if (email && email.includes('@')) emailsSet.add(email);
            });
          });
          const emails = Array.from(emailsSet).sort((a,b) => a.localeCompare(b));
          console.log('[FilterBar] ownership unique emails', emails);
          emails.forEach(em => {
            const lab = document.createElement('label');
            lab.innerHTML = `<input type=\"checkbox\" value=\"${em}\"> ${em}`;
            opts.appendChild(lab);
          });
        }
      }
      // Assessments by titles present in current list
      const assessFilter = Array.from(root.querySelectorAll('.filter')).find(f => (f.getAttribute('data-filter') || '').toLowerCase() === 'assessment');
      if (!assessFilter) { console.warn('[FilterBar] assessment filter not found'); }
      if (assessFilter) {
        const opts = assessFilter.querySelector('.options');
        if (!opts) { console.warn('[FilterBar] assessment options not found'); }
        if (opts) {
          const clearBtn = opts.querySelector('.clear-btn');
          opts.innerHTML = '';
          if (clearBtn) opts.appendChild(clearBtn);
          const titlesSet = new Set();
          const infoArr = Array.isArray(loadedAssessInfo) ? loadedAssessInfo : [];
          console.log('[FilterBar] mapping assessments; info count', infoArr.length);
          (rawItems || []).forEach((it, idx) => {
            const aId = String(it.action && it.action.assessment_id || '');
            if (!aId) return;
            const match = infoArr.find(x => String(x.assessment_id) === aId);
            const title = match && match.title ? String(match.title) : '';
            console.log('[FilterBar] map action', idx, 'aId=', aId, 'title=', title);
            if (title) titlesSet.add(title);
          });
          const titles = Array.from(titlesSet).sort((a,b) => a.localeCompare(b));
          console.log('[FilterBar] assessment titles present', titles);
          titles.forEach(t => {
            const lab = document.createElement('label');
            lab.innerHTML = `<input type=\"checkbox\" value=\"${t}\"> ${t}`;
            opts.appendChild(lab);
          });
        }
      }
    } catch (e) { console.error('[FilterBar] populate error', e); }
  }

  // After items are loaded or filtered, refresh dynamic options
  function afterListUpdate() {
    populateOwnershipAndAssessmentsOptions();
    console.log('[FilterBar] afterListUpdate rawItems=', (rawItems||[]).length, 'filtered=', (filteredItems||[]).length);
  }

  // Bootstrap data load
  (async function initData() {
    try {
      const email = getParam('email') || '';
      if (!email) return;
      // Ensure assessment info is loaded first
      await loadAssessmentInfoForFilters();
      console.log('[FilterBar] loadedAssessInfo count', Array.isArray(loadedAssessInfo) ? loadedAssessInfo.length : 0);
      const data = await fetchRecommendationsByDomain(email);
      const items = Array.isArray(data && data.items) ? data.items : [];
      rawItems = items;
      console.log('[FilterBar] rawItems loaded', rawItems.length);
      console.log('[FilterBar] rawItems', rawItems);
      filteredItems = rawItems.slice();
      visibleCount = PAGE_SIZE;
      renderList();
      populateOwnershipAndAssessmentsOptions();
      document.dispatchEvent(new CustomEvent('filterbar:changed'));
    } catch (e) { console.error('initData error', e); }
  })();
})();


