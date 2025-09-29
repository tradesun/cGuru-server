(function() {
  let hasAnimatedChart = false;
  let hasAnimatedOverall = false;

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

  function renderOverview(data) {
    const title = qid('detailsTitle');
    const percent = qid('overallPercent');
    const updated = qid('overallUpdated');
    const trend = qid('overallTrend');
    const peers = qid('overallPeers');
    const benchmark = qid('overallBenchmark');

    if (title) {
      const id = data && data.submission ? String(data.submission.assessment_id) : '';
      const friendly = (window.Constants && window.Constants.ASSESSMENT_TITLES && window.Constants.ASSESSMENT_TITLES[id]) || (id ? `Assessment ${id}` : 'Assessment');
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
    // keep trend/benchmark/peers hidden; placeholders ready
    trend && trend.classList.add('hidden');
    peers && peers.classList.add('hidden');
    benchmark && benchmark.classList.add('hidden');
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
      const { code, text } = extractCodeAndText(q.question_text);
      const div = document.createElement('div');
      div.className = 'p-5';
      const answers = Array.isArray(q.answers) ? q.answers.map(a => a && a.answer_text).filter(Boolean) : [];
      div.innerHTML = `
        <div class="md:max-w-[100%]">
          <div class="text-xs text-slate-500 question_code">${code ? `Question ${code}` : ''}</div>
          <div class="font-medium">${text}</div>
          <div class="mt-1 text-sm text-slate-600">${answers.length ? answers.join('; ') : ''}</div>
        </div>
      `;
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
      const data = await fetchSubmissionDetails(resultKey);
      renderOverview(data);
      renderCategories(data);
      renderMaturityChart(data);
      wireCategorySelection(data);
    } catch (err) {
      alert(`Failed to load details: ${err && err.message ? err.message : String(err)}`);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();


