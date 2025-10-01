(function() {
  let hasAnimatedChart = false;
  let hasAnimatedOverall = false;
  let loadedAssessInfo = [];

  function animatePercent(element, targetPercent, durationMs) {
    if (!element) return;
    const duration = typeof durationMs === 'number' ? durationMs : 900;
    const start = performance.now();
    const cappedTarget = Math.max(0, Math.min(100, Number(targetPercent) || 0));
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const value = Math.round(eased * cappedTarget);
      element.textContent = `${value}%`;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function qs(sel) { return document.querySelector(sel); }
  function qid(id) { return document.getElementById(id); }
  function getParam(name) { const p = new URLSearchParams(window.location.search); return p.get(name); }

  function extractCodeAndText(questionText) {
    if (!questionText) return { code: '', text: '' };
    const m = String(questionText).match(/^\s*([0-9]+(?:\.[0-9]+)?)\s+(.+)$/);
    if (m) { return { code: m[1], text: m[2] }; }
    return { code: '', text: String(questionText) };
  }

  async function fetchSubmissionDetails(resultKey) {
    const url = `/api/v1/submissionDetails?result_key=${encodeURIComponent(resultKey)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  async function fetchAssessmentInfo() {
    const res = await fetch('/js/assessment_info.json', { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  }

  function renderOverview(data) {
    const title = qid('detailsTitle');
    const percent = qid('overallPercent');
    const updated = qid('overallUpdated');
    const trend = qid('overallTrend');
    const peers = qid('overallPeers');
    const benchmark = qid('overallBenchmark');
    const completeBtn = qid('btnCompleteAssessment');
    const videoEl = qid('overviewVideo');

    if (title) {
      const id = data && data.submission ? String(data.submission.assessment_id) : '';
      const info = Array.isArray(loadedAssessInfo) ? loadedAssessInfo.find(x => String(x.assessment_id) === id) : null;
      const friendly = (info && info.title) ? String(info.title) : (id ? `Assessment ${id}` : 'Assessment');
      title.textContent = `${friendly} — Detailed Assessment`;
    }
    if (percent) {
      const val = data && data.submission && data.submission.total_score ? Number(data.submission.total_score.percent) : NaN;
      if (!hasAnimatedOverall && Number.isFinite(val)) {
        percent.textContent = '0%';
        animatePercent(percent, val, 900);
        hasAnimatedOverall = true;
      } else {
        percent.textContent = Number.isFinite(val) ? `${val}%` : '--%';
      }
    }
    if (updated) {
      const iso = data && data.submission ? data.submission.finished_at : '';
      try { updated.textContent = new Date(iso).toLocaleDateString(); } catch { updated.textContent = iso || '--'; }
    }
    // Show trend text if we can compute a simple last-30d delta from history if present
    if (trend) {
      // If the API later provides history here, we can compute; for now keep the static label
      trend.textContent = '+0% last 30 days';
    }

    // Wire Complete Assessment button using per-assessment URLs map
    if (completeBtn) {
      completeBtn.onclick = () => {
        const id = data && data.submission ? String(data.submission.assessment_id) : '';
        const email = data && data.submission ? String(data.submission.email || '') : '';
        const urls = (window.Constants && window.Constants.ASSESSMENT_TAKE_URLS) || {};
        const direct = id && urls[id] ? urls[id] : '';
        if (direct) {
          const url = new URL(direct);
          if (email) url.searchParams.set('email', email);
          window.location.href = url.toString();
          return;
        }
        // fallback to base if provided
        const base = (window.Constants && window.Constants.ASSESSMENT_TAKE_URL) || '';
        if (base && id) {
          const url = new URL(base, window.location.origin);
          url.searchParams.set('assessmentId', id);
          if (email) url.searchParams.set('email', email);
          window.location.href = url.toString();
        }
      };
    }

    // Set video source per assessment id
    if (videoEl && data && data.submission && data.submission.assessment_id) {
      const id = String(data.submission.assessment_id);
      videoEl.src = `https://cguru-server.s3.ap-southeast-2.amazonaws.com/${id}.mp4`;
    }
  }

  function renderCategories(data) {
    const ul = qid('categoryList');
    if (!ul) return;
    ul.innerHTML = '';
    const catsAll = Array.isArray(data.categories) ? data.categories : [];
    const NUMBERED_RE = /^\s*\d+\s*(?:[.\)\-–—])?\s/;
    const cats = catsAll.filter(c => NUMBERED_RE.test(String(c && c.title ? c.title : '')));
    cats.forEach((c, idx) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="w-full h-12 flex items-center justify-between rounded-xl border px-3 transition hover:bg-slate-50" data-cat-id="${c.category_id}">
          <div class="font-semibold text-sm truncate pr-3">${c.title || ''}</div>
          <div class="px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">${Number(c.percent) || 0}%</div>
        </button>
      `;
      ul.appendChild(li);
    });
  }

  function renderMaturityChart(data) {
    const container = qid('maturityChart');
    if (!container) return;
    container.innerHTML = '';
    const catsAll = Array.isArray(data.categories) ? data.categories : [];
    const NUMBERED_RE = /^\s*\d+\s*(?:[.\)\-–—])?\s/;
    const categories = catsAll.filter(c => NUMBERED_RE.test(String(c && c.title ? c.title : '')));

    // Determine segment widths based on configured stages
    const STAGES = (window.Constants && window.Constants.STAGES) || [];
    const getMax = (label, fallback) => {
      const s = STAGES.find(x => String(x.name).toLowerCase().startsWith(label));
      return s && Number.isFinite(Number(s.max)) ? Number(s.max) : fallback;
    };
    const getStageMax = (exactName, fallback) => {
      const s = STAGES.find(x => String(x.name).toLowerCase() === exactName);
      return s && Number.isFinite(Number(s.max)) ? Number(s.max) : fallback;
    };
    const maxAwareness = getStageMax('awareness', 10);
    const maxFoundation = getMax('found', 30);
    const maxDeveloping = getMax('develop', 50);
    const maxScaling = getMax('scal', 70);
    const maxOptimizing = getMax('opt', 90);
    const maxLeading = getMax('lead', 100);
    // Create explicit breakpoints including 0–10% Awareness as its own band
    const bounds = [0, maxAwareness, maxFoundation, maxDeveloping, maxScaling, maxOptimizing, maxLeading]
      .map(n => Math.max(0, Math.min(100, n)));
    const widths = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      widths.push(Math.max(0, bounds[i + 1] - bounds[i]));
    }

    categories.forEach((cat) => {
      const percent = Math.max(0, Math.min(100, Number(cat.percent) || 0));
      const row = document.createElement('div');
      row.className = 'relative h-12';
      row.setAttribute('data-cat-id', String(cat.category_id));

      // Background maturity bands (5 equal segments)
      const bands = document.createElement('div');
      bands.className = 'flex w-full h-12 rounded overflow-hidden';
      const bandClasses = ['bg-sky-50','bg-sky-100','bg-sky-200','bg-sky-300','bg-sky-400','bg-sky-600'];
      for (let i = 0; i < bandClasses.length; i++) {
        const seg = document.createElement('div');
        seg.className = bandClasses[i];
        seg.style.width = `${widths[i] || 0}%`;
        seg.style.height = '100%';
        bands.appendChild(seg);
      }

      // Overlay outline representing the category percent
      const overlay = document.createElement('div');
      overlay.className = 'absolute left-0 top-1/2 -translate-y-1/2 h-12 border-2 border-black/80 bg-transparent rounded';
      // Animate only on first render
      if (!hasAnimatedChart) {
        overlay.style.width = '0%';
        overlay.style.transition = 'width 900ms ease-out';
      } else {
        overlay.style.width = `${percent}%`;
      }
      overlay.setAttribute('data-cat-id', String(cat.category_id));

      // Percent label inside the outlined box, near the right edge
      const label = document.createElement('div');
      label.className = 'absolute right-1 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-900';
      label.textContent = `${percent}%`;
      overlay.appendChild(label);

      row.appendChild(bands);
      row.appendChild(overlay);

      container.appendChild(row);

      // Trigger animation after first frame so width transitions from 0 to target
      if (!hasAnimatedChart) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            overlay.style.width = `${percent}%`;
          });
        });
      }
    });
    hasAnimatedChart = true;
  }

  function setActiveChartRow(categoryId) {
    const container = qid('maturityChart');
    if (!container) return;
    const rows = Array.from(container.querySelectorAll('[data-cat-id]'));
    rows.forEach((el) => {
      const isActive = String(el.getAttribute('data-cat-id')) === String(categoryId);
      el.classList.toggle('ring-2', isActive);
      el.classList.toggle('ring-teal-400', isActive);
    });
  }

  function setActiveCategoryButton(categoryId) {
    const ul = qid('categoryList');
    if (!ul) return;
    const btns = Array.from(ul.querySelectorAll('button[data-cat-id]'));
    btns.forEach((b) => {
      const isActive = String(b.getAttribute('data-cat-id')) === String(categoryId);
      b.classList.toggle('border-teal-400', isActive);
      b.classList.toggle('bg-[rgba(31,181,172,0.06)]', isActive);
    });
  }

  let currentEmail = '';

  async function addAction(email, categoryId, stage) {
    try {
      const res = await fetch('/api/v1/add_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, category_id: String(categoryId), stage: Number(stage) })
      });
      if (res.status === 409) {
        alert('Action already added');
        if (email) window.location.href = `/next.html?email=${encodeURIComponent(email)}`;
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Request failed: ${res.status}`);
      }
      // On success, navigate to Next Steps
      if (email) window.location.href = `/next.html?email=${encodeURIComponent(email)}`;
    } catch (err) {
      alert(`Failed to add action: ${err && err.message ? err.message : String(err)}`);
    }
  }

  function renderQuestionsForCategory(data, categoryId) {
    const container = qid('questionsContainer');
    const titleEl = qid('selectedCategoryTitle');
    const titleTopEl = qid('selectedCategoryTitleTop');
    const percentEl = qid('selectedCategoryPercent');
    const stageEl = qid('selectedCategoryStage');
    const stageNameEl = qid('selectedCategoryStageName');
    const addNextBtn = qid('addNextBtn');
    const stageWrapEl = document.querySelector('.selectedCat-stageWrap');
    if (!container) return;
    container.innerHTML = '';

    const cat = (data.categories || []).find(c => String(c.category_id) === String(categoryId)) || {};
    if (titleEl) titleEl.textContent = cat.title || '—';
    if (titleTopEl) titleTopEl.textContent = cat.title || '—';
    if (percentEl) percentEl.textContent = `${Number(cat.percent) || 0}%`;
    // Use API-provided stage and stage_name if present
    let stageNum = cat && (cat.stage || cat.stage === 0) ? String(cat.stage) : '';
    let stageName = cat && cat.stage_name ? String(cat.stage_name) : '';
    if (stageEl) stageEl.textContent = stageNum ? `Stage ${stageNum}` : 'Stage —';
    if (stageNameEl) stageNameEl.textContent = stageName || '—';
    // Update stage wrap background color according to stage
    if (stageWrapEl) {
      const colors = {
        '0': '#f0f9ff', // sky-50
        '1': '#e0f2fe', // sky-100
        '2': '#bae6fd', // sky-200
        '3': '#7dd3fc', // sky-300
        '4': '#38bdf8', // sky-400
        '5': '#0284c7'  // sky-600
      };
      const bg = stageNum !== '' && colors[String(stageNum)] ? colors[String(stageNum)] : '#38bdf8';
      stageWrapEl.style.backgroundColor = bg;
      stageWrapEl.style.color = (stageNum === '5') ? '#ffffff' : '#0b2530';
    }
    if (addNextBtn) {
      addNextBtn.onclick = () => {
        const sVal = stageNum === '' ? null : Number(stageNum);
        if (!currentEmail) { alert('Missing email'); return; }
        addAction(currentEmail, categoryId, sVal);
      };
    }

    const qs = (data.questions || []).filter(q => String(q.category_id) === String(categoryId));
    qs.forEach(q => {
      const code = q && q.question_code ? String(q.question_code) : '';
      const text = q && q.question_text ? String(q.question_text) : '';
      const answers = Array.isArray(q.answers) ? q.answers.map(a => a && a.answer_text).filter(Boolean) : [];
      const div = document.createElement('div');
      div.className = 'p-5 rounded-xl border mb-3 question-card';

      // Determine stage for this question from its category
      const cat = (data.categories || []).find(c => String(c.category_id) === String(categoryId)) || {};
      const stageNum = (cat && (cat.stage || cat.stage === 0)) ? Number(cat.stage) : null;

      // Top row: left code badge, right controls (stage pill + add button)
      const topRow = document.createElement('div');
      topRow.className = 'flex items-center justify-between gap-3 question-card-top';

      const leftTop = document.createElement('div');
      leftTop.className = 'question-card-left';
      leftTop.innerHTML = `<span class="inline-block px-2 py-1 text-xs rounded-md bg-slate-100 text-slate-600 question_code_badge">${code ? `Question ${code}` : ''}</span>`;
      topRow.appendChild(leftTop);

      const rightTop = document.createElement('div');
      rightTop.className = 'flex items-center gap-2 question-card-actions';
      const stagePill = document.createElement('span');
      stagePill.className = 'inline-block rounded-lg bg-sky-300 text-slate-900 px-4 py-1.5 text-sm font-semibold stage-pill';
      stagePill.textContent = `Stage ${Number.isInteger(stageNum) ? stageNum : '—'}`;
      rightTop.appendChild(stagePill);
      // Add button (only if plan available) appended later after we know plan availability

      topRow.appendChild(rightTop);
      div.appendChild(topRow);

      // Question text
      const qtext = document.createElement('div');
      qtext.className = 'mt-3 font-semibold leading-6 text-slate-900 question-text';
      qtext.textContent = text;
      div.appendChild(qtext);

      // Body wrapper for plan details or user response
      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'mt-3 question-card-body';

      if (q && q.plan_available) {
        // Plan available: show progression and benefit
        const details = document.createElement('div');
        details.className = 'text-sm text-slate-700 question-plan-details';
        const nextStage = Number.isInteger(stageNum) ? stageNum + 1 : '…';
        const progTitle = document.createElement('div');
        progTitle.className = 'font-semibold text-slate-900 question-progression-title';
        progTitle.textContent = `Stage ${Number.isInteger(stageNum) ? stageNum : '—'} \u2192 Stage ${nextStage}`;
        const progBody = document.createElement('div');
        progBody.className = 'mt-1 question-progression-body';
        {
          const raw = q && q.progression_comment ? String(q.progression_comment) : '';
          let cleaned = raw;
          if (Number.isInteger(stageNum)) {
            const arrowSet = '(?:\\u2192|→|->)';
            const prefixRe = new RegExp('^\\s*Stage\\s+' + stageNum + '\\s*' + arrowSet + '\\s*Stage\\s+' + nextStage + '\\s*(?:progression)?\\s*[:\\-–—]?\\s*', 'i');
            cleaned = raw.replace(prefixRe, '').trim();
          }
          progBody.textContent = cleaned;
        }
        const benTitle = document.createElement('div');
        benTitle.className = 'mt-3 font-semibold text-slate-900 question-benefit-title';
        benTitle.textContent = 'The benefit';
        const benBody = document.createElement('div');
        benBody.className = 'mt-1 question-benefit-body';
        benBody.textContent = q.benefit || '';
        details.appendChild(progTitle);
        details.appendChild(progBody);
        details.appendChild(benTitle);
        details.appendChild(benBody);
        bodyWrap.appendChild(details);
      } else {
        // No plan available: show user's response instead
        const respTitle = document.createElement('div');
        respTitle.className = 'mt-3 font-semibold text-slate-900 text-sm';
        respTitle.textContent = 'Your response';
        const respBody = document.createElement('div');
        respBody.className = 'mt-1 text-sm text-slate-700';
        respBody.textContent = answers.length ? answers.join('; ') : '—';
        bodyWrap.appendChild(respTitle);
        bodyWrap.appendChild(respBody);
      }

      div.appendChild(bodyWrap);

      // Add button (only if plan available) appended to rightTop
      if (q && q.plan_available && code && Number.isInteger(stageNum)) {
        const addedCodesQ = Array.isArray(data.added_actions) ? data.added_actions.map(String) : [];
        const alreadyAddedQ = code && addedCodesQ.includes(String(code));
        console.log('[details] question add/show check', { code, addedCodes: addedCodesQ, alreadyAddedQ });

        const btn = document.createElement('button');
        if (alreadyAddedQ) {
          btn.textContent = 'Show Action >';
          btn.className = 'button-plain text-xs add-next-btn';
          btn.style.borderRadius = '6px';
          btn.style.padding = '5px 10px';
          btn.onclick = () => {
            const email = currentEmail || getParam('email') || '';
            const selCode = (cat && cat.code) ? String(cat.code) : '';
            if (email) window.location.href = `/next.html?email=${encodeURIComponent(email)}&select_category_code=${encodeURIComponent(selCode)}`;
          };
          rightTop.appendChild(btn);
        } else {
          btn.textContent = 'Add to Next Steps >';
          btn.className = 'button-primary text-xs px-3 py-1.5 add-next-btn';
          btn.onclick = async () => {
          const email = currentEmail || getParam('email') || '';
          if (!email) { alert('Missing email'); return; }
          try {
            const res = await fetch('/api/v1/add_action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ email, action_type: 'question', question_code: code, stage: Number(stageNum), category_id: String(categoryId), category_code: (cat && cat.code) ? String(cat.code) : null })
            });
            if (res.status === 409) { alert('Action already added'); return; }
            if (!res.ok) {
              const msg = await res.text().catch(() => '');
              throw new Error(msg || `Request failed: ${res.status}`);
            }
            // Navigate to Next Steps, preselect this category
            window.location.href = `/next.html?email=${encodeURIComponent(email)}&select_category_code=${encodeURIComponent(cat && cat.code ? String(cat.code) : '')}`;
          } catch (err) {
            alert(`Failed to add action: ${err && err.message ? err.message : String(err)}`);
          }
          };
          rightTop.appendChild(btn);
        }
      }
      container.appendChild(div);
    });

    // Populate recommendation panel (right)
    const whyEl = qid('whyText');
    const actionTitleEl = qid('actionTitle');
    const bulletsEl = qid('actionBullets');
    const rec = cat && cat.recommendation ? cat.recommendation : null;
    if (whyEl) whyEl.textContent = rec && rec.why_it_matters ? String(rec.why_it_matters) : 'No recommendation available';
    if (actionTitleEl) actionTitleEl.textContent = rec && rec.action_title ? String(rec.action_title) : '';
    if (bulletsEl) {
      bulletsEl.innerHTML = '';
      const items = [];
      if (rec && rec.bullet_1) items.push(String(rec.bullet_1));
      if (rec && rec.bullet_2) items.push(String(rec.bullet_2));
      if (rec && rec.bullet_3) items.push(String(rec.bullet_3));
      if (items.length) {
        for (const t of items) {
          const li = document.createElement('li');
          li.textContent = t;
          bulletsEl.appendChild(li);
        }
      }
    }

    // Toggle Add vs Show Action button based on added_actions codes
    const addedCodes = Array.isArray(data.added_actions) ? data.added_actions.map(String) : [];
    const thisCode = cat && cat.code ? String(cat.code) : '';
    const alreadyAdded = thisCode && addedCodes.includes(thisCode);
    const addBtn = qid('addNextBtn');
    if (addBtn) {
      if (alreadyAdded) {
        addBtn.textContent = 'Show Action >';
        addBtn.classList.add('button-plain');
        addBtn.onclick = () => {
          const email = currentEmail || getParam('email') || '';
          if (email) window.location.href = `/next.html?email=${encodeURIComponent(email)}&select_category_code=${encodeURIComponent(thisCode)}`;
          else window.location.href = '/next.html';
        };
      } else {
        addBtn.textContent = 'Add to Next Steps >';
        addBtn.classList.remove('button-plain');
        addBtn.onclick = () => {
          const sVal = stageNum === '' ? null : Number(stageNum);
          if (!currentEmail) { alert('Missing email'); return; }
          addAction(currentEmail, categoryId, sVal);
        };
      }
    }
  }

  function wireCategorySelection(data) {
    const ul = qid('categoryList');
    if (!ul) return;
    ul.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cat-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-cat-id');
      setActiveCategoryButton(id);
      renderQuestionsForCategory(data, id);
      setActiveChartRow(id);
    });
    // Select first category by default
    const NUMBERED_RE = /^\s*\d+\s*(?:[.\)\-–—])?\s/;
    const first = (data.categories || []).find(c => NUMBERED_RE.test(String(c && c.title ? c.title : '')));
    if (first) {
      setActiveCategoryButton(first.category_id);
      renderQuestionsForCategory(data, first.category_id);
      setActiveChartRow(first.category_id);
    }
  }

  function wireBackLink(email) {
    const back = qid('backLink');
    if (!back) return;
    if (email) back.href = `/index.html?email=${encodeURIComponent(email)}`;
  }

  async function init() {
    const resultKey = getParam('result_key');
    const email = getParam('email');
    wireBackLink(email);
    currentEmail = email || '';
    const overallEl = qid('overallPercent');
    if (overallEl) overallEl.textContent = '0%';
    if (!resultKey) {
      alert('Missing result_key');
      return;
    }
    try {
      const [data, assessInfo] = await Promise.all([
        fetchSubmissionDetails(resultKey),
        fetchAssessmentInfo()
      ]);
      loadedAssessInfo = Array.isArray(assessInfo) ? assessInfo : [];
      renderOverview(data);
      renderCategories(data);
      renderMaturityChart(data);
      wireCategorySelection(data);
      // Render assessment-level Why and Quick tips
      try {
        const id = data && data.submission ? Number(data.submission.assessment_id) : NaN;
        const info = Array.isArray(assessInfo) ? assessInfo.find(x => Number(x.assessment_id) === id) : null;
        const whyEl = qid('assessWhyText');
        const tipsEl = qid('assessQuickTips');
        if (whyEl) whyEl.textContent = info && info['Why this matters'] ? String(info['Why this matters']) : '—';
        if (tipsEl) {
          tipsEl.innerHTML = '';
          const tips = info && Array.isArray(info['Quick tips']) ? info['Quick tips'] : [];
          tips.forEach(t => {
            const li = document.createElement('li');
            li.textContent = String(t);
            tipsEl.appendChild(li);
          });
        }
      } catch {}
    } catch (err) {
      alert(`Failed to load details: ${err && err.message ? err.message : String(err)}`);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();


