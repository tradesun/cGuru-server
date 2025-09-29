(function() {
  const messageEl = document.getElementById('message');
  const gridEl = document.getElementById('assessmentsGrid');
  const avgPercentEl = document.getElementById('avgPercent');
  const trendTextEl = document.getElementById('trendText');
  const tabsRoot = document.querySelector('.timeframe-tabs');
  const tabsCaptionEl = tabsRoot ? tabsRoot.querySelector('.tabs-caption') : null;
  const tabButtons = tabsRoot ? Array.from(tabsRoot.querySelectorAll('.tabs-list button')) : [];

  let loadedData = null;
  let loadedEmail = null;
  let selectedWindowDays = 90;
  let hasAnimatedAvg = false;

  function animateNumber(element, targetValue, durationMs) {
    if (!element) return;
    const duration = typeof durationMs === 'number' ? durationMs : 900;
    const start = performance.now();
    const target = Math.max(0, Math.min(100, Number(targetValue) || 0));
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const value = Math.round(eased * target);
      element.textContent = String(value);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function showMessage(text, tone) {
    messageEl.textContent = text;
    messageEl.classList.remove('hidden');
    if (tone === 'error') {
      messageEl.classList.add('message-error');
    } else {
      messageEl.classList.remove('message-error');
    }
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString();
    } catch {
      return iso;
    }
  }

  function formatMonthDay(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, { month: 'long', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  function getTrendSeries(latest, history) {
    const histEntries = Array.isArray(history) ? history.slice().reverse() : [];
    const values = [];
    const labels = [];
    for (const h of histEntries) {
      const v = h && h.total_score ? Number(h.total_score.percent) : null;
      if (Number.isFinite(v)) { values.push(v); labels.push(h.finished_at); }
    }
    const latestVal = latest && latest.total_score ? Number(latest.total_score.percent) : null;
    if (Number.isFinite(latestVal)) { values.push(latestVal); labels.push(latest.finished_at); }
    return { values, labels };
  }

  function filterSeriesByWindow(series, windowDays) {
    const now = Date.now();
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const values = [];
    const labels = [];
    for (let i = 0; i < series.labels.length; i++) {
      const t = new Date(series.labels[i]).getTime();
      if (Number.isFinite(t) && t >= now - windowMs) {
        values.push(series.values[i]);
        labels.push(series.labels[i]);
      }
    }
    return { values, labels };
  }

  function parseWindowFromButton(btn) {
    const label = (btn && btn.textContent ? btn.textContent.trim().toLowerCase() : '');
    if (!label) return { days: 90, caption: 'last 90 days' };
    if (label.endsWith('d')) {
      const days = parseInt(label, 10) || 90;
      return { days, caption: `last ${days} days` };
    }
    if (label.endsWith('m')) {
      const months = parseInt(label, 10) || 12;
      const days = months * 30; // simple month approximation
      const caption = months === 12 ? 'last 12 months' : `last ${months} months`;
      return { days, caption };
    }
    return { days: 90, caption: 'last 90 days' };
  }

  function computeAverageTrendDelta(data, windowDays) {
    if (!data || !Array.isArray(data.assessments)) return null;
    const now = Date.now();
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const deltas = [];
    for (const a of data.assessments) {
      if (!a || !a.latest || !a.latest.total_score) continue;
      const points = [];
      if (Array.isArray(a.history)) {
        for (const h of a.history) {
          if (h && h.total_score && h.finished_at) {
            points.push({ t: new Date(h.finished_at).getTime(), v: Number(h.total_score.percent) });
          }
        }
      }
      if (a.latest && a.latest.finished_at) {
        points.push({ t: new Date(a.latest.finished_at).getTime(), v: Number(a.latest.total_score.percent) });
      }
      if (!points.length) continue;
      points.sort((p, q) => p.t - q.t);
      const startTime = now - windowMs;
      const within = points.filter(p => p.t >= startTime);
      if (within.length >= 2) {
        const delta = within[within.length - 1].v - within[0].v;
        if (Number.isFinite(delta)) deltas.push(delta);
      } else if (within.length === 1) {
        // Only one point in window: compare to most recent point before window if available
        const idx = points.findIndex(p => p.t === within[0].t);
        if (idx > 0) {
          const delta = within[0].v - points[idx - 1].v;
          if (Number.isFinite(delta)) deltas.push(delta);
        }
      }
    }
    if (!deltas.length) return 0;
    const avg = deltas.reduce((s, v) => s + v, 0) / deltas.length;
    return Math.round(avg);
  }

  function updateTrendForSelectedWindow() {
    if (!loadedData) return;
    const activeBtn = tabButtons.find(b => b.getAttribute('data-state') === 'active') || tabButtons[0];
    const { days, caption } = parseWindowFromButton(activeBtn);
    if (tabsCaptionEl) tabsCaptionEl.textContent = `Viewing trends for: ${caption}`;
    const delta = computeAverageTrendDelta(loadedData, days);
    selectedWindowDays = days;
    if (trendTextEl) {
      const isPositive = Number(delta) > 0;
      const sign = delta > 0 ? '+' : '';
      trendTextEl.textContent = `${sign}${Number.isFinite(delta) ? delta : 0}% ${caption}`;
    }
    // Re-render sparklines to reflect selected window
    if (loadedData) {
      renderAssessments(loadedData, loadedEmail);
    }
  }

  function buildSparkline(container, values, labels, key) {
    const rect = container && container.getBoundingClientRect ? container.getBoundingClientRect() : { width: 0, height: 0 };
    const width = Math.max(200, Math.floor(rect.width || (container && container.clientWidth) || 200));
    const height = Math.max(48, Math.floor(rect.height || (container && container.clientHeight) || 64));
    const padding = 8;
    const n = values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = (width - padding * 2) / Math.max(1, n - 1);

    const pts = values.map((v, i) => {
      const x = padding + i * stepX;
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return [x, y];
    });

    // Smooth path (Catmull–Rom → Cubic Bezier)
    function buildSmoothPath(points, smoothing = 0.22) {
      if (points.length < 2) return '';
      const d = [`M ${points[0][0]},${points[0][1]}`];
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;

        const cp1x = p1[0] + (p2[0] - p0[0]) * smoothing;
        const cp1y = p1[1] + (p2[1] - p0[1]) * smoothing;
        const cp2x = p2[0] - (p3[0] - p1[0]) * smoothing;
        const cp2y = p2[1] - (p3[1] - p1[1]) * smoothing;

        d.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`);
      }
      return d.join(' ');
    }

    const linePathD = buildSmoothPath(pts, 0.22);
    const yBase = height - padding;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const areaPathD = `${linePathD} L ${last[0]},${yBase} L ${first[0]},${yBase} Z`;

    const gradId = `spark-grad-${key || Math.random().toString(36).slice(2)}`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('shape-rendering', 'geometricPrecision');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0'); grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '5%'); stop1.setAttribute('stop-color', '#0f766e'); stop1.setAttribute('stop-opacity', '0.35');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '95%'); stop2.setAttribute('stop-color', '#0f766e'); stop2.setAttribute('stop-opacity', '0.02');
    grad.appendChild(stop1); grad.appendChild(stop2); defs.appendChild(grad); svg.appendChild(defs);

    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', areaPathD);
    areaPath.setAttribute('fill', `url(#${gradId})`);
    svg.appendChild(areaPath);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', linePathD);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#0f766e');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);

    // Hover marker
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('r', '3.5');
    marker.setAttribute('fill', '#0f766e');
    marker.setAttribute('stroke', 'white');
    marker.setAttribute('stroke-width', '1');
    marker.style.visibility = 'hidden';
    svg.appendChild(marker);

    // Tooltip (HTML overlay)
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip absolute hidden -translate-x-1/2 -translate-y-full bg-white border border-teal-100 text-xs px-2 py-1 rounded shadow';
    tooltip.style.pointerEvents = 'none';
    container.appendChild(tooltip);

    function setHover(index) {
      const i = Math.max(0, Math.min(n - 1, index));
      const p = pts[i];
      marker.setAttribute('cx', String(p[0]));
      marker.setAttribute('cy', String(p[1]));
      marker.style.visibility = 'visible';
      tooltip.textContent = `${formatMonthDay(labels[i])} • ${values[i]}%`;
      tooltip.style.left = `${p[0]}px`;
      tooltip.style.top = `${p[1] - 10}px`;
      tooltip.classList.remove('hidden');
    }

    function clearHover() {
      marker.style.visibility = 'hidden';
      tooltip.classList.add('hidden');
    }

    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const idx = Math.round((x - padding) / stepX);
      setHover(idx);
    });
    svg.addEventListener('mouseleave', clearHover);

    return svg;
  }

  function renderAssessments(data, email) {
    loadedData = data;
    gridEl.innerHTML = '';
    if (!data || !Array.isArray(data.assessments) || data.assessments.length === 0) {
      showMessage('No assessments yet for this email.', 'info');
      if (avgPercentEl) avgPercentEl.textContent = '--';
      return;
    }

    // Average of latest percents
    const latestPercents = data.assessments
      .map(a => a && a.latest && a.latest.total_score ? Number(a.latest.total_score.percent) : null)
      .filter(v => Number.isFinite(v));
    const avg = latestPercents.length ? Math.round(latestPercents.reduce((s, v) => s + v, 0) / latestPercents.length) : null;
    if (avgPercentEl) {
      if (!hasAnimatedAvg && avg !== null) {
        animateNumber(avgPercentEl, avg, 900);
        hasAnimatedAvg = true;
      } else {
        avgPercentEl.textContent = avg !== null ? String(avg) : '--';
      }
    }

    // Build full list: include assessments with no records
    const titles = (window.Constants && window.Constants.ASSESSMENT_TITLES) || {};
    const allIds = Object.keys(titles);
    const byId = new Map();
    for (const a of data.assessments) {
      byId.set(String(a.assessment_id), a);
    }

    for (const id of allIds) {
      const a = byId.get(String(id)) || { assessment_id: id, latest: null, history: [] };
      const latest = a.latest;
      const card = document.createElement('div');
      card.className = 'assessment-card' + (latest && latest.total_score ? '' : ' is-empty');

      const header = document.createElement('div');
      header.className = 'card-header';
      const title = document.createElement('h2');
      title.className = 'text-sm font-medium text-teal-900';
      const assessmentName = (window.Constants && window.Constants.ASSESSMENT_TITLES && window.Constants.ASSESSMENT_TITLES[String(a.assessment_id)]) || `Assessment ${a.assessment_id}`;
      title.textContent = assessmentName;
      header.appendChild(title);
      card.appendChild(header);

      const content = document.createElement('div');
      content.className = 'card-content';

      const row = document.createElement('div');
      row.className = 'flex items-center justify-between';
      const left = document.createElement('div');
      left.className = 'flex items-center gap-2';
      const gauge = document.createElement('span');
      gauge.className = 'inline-block h-4 w-4 text-amber-600';
      gauge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0-9-9"/><path d="M12 3v4"/><path d="M12 12l-3 3"/></svg>';
      const current = document.createElement('span');
      current.className = 'current-label';
      current.textContent = 'Current';
      left.appendChild(gauge); left.appendChild(current);
      const right = document.createElement('div');
      right.className = 'current-value';
      right.textContent = `${latest && latest.total_score ? latest.total_score.percent : '—'}%`;
      row.appendChild(left); row.appendChild(right);
      content.appendChild(row);

      // Sparkline trend
      const sparkWrap = document.createElement('div');
      sparkWrap.className = 'sparkline-holder';
      content.appendChild(sparkWrap);
      let series = getTrendSeries(latest, a.history);
      series = filterSeriesByWindow(series, selectedWindowDays);
      if (series.values.length >= 2) {
        requestAnimationFrame(() => {
          sparkWrap.innerHTML = '';
          sparkWrap.appendChild(buildSparkline(sparkWrap, series.values, series.labels, String(a.assessment_id)));
        });
      }

      // Meta and CTA
      const metaRow = document.createElement('div');
      metaRow.className = 'meta-row';
      const meta = document.createElement('div');
      meta.className = 'meta-text';
      const calIcon = document.createElement('span');
      calIcon.className = 'inline-block h-3.5 w-3.5';
      calIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
      const metaText = document.createElement('span');
      metaText.textContent = latest ? `Last update: ${formatDate(latest.finished_at)}` : 'Not started yet';
      meta.appendChild(calIcon); meta.appendChild(metaText);
      const cta = document.createElement('button');
      if (latest && latest.total_score) {
        cta.className = 'cta';
        cta.innerHTML = 'View next step <span class="inline-block align-middle ml-1"><svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>';
        cta.addEventListener('click', () => {
          const params = new URLSearchParams();
          if (latest && latest.result_key) params.set('result_key', String(latest.result_key));
          if (email) params.set('email', email);
          window.location.href = `/details.html?${params.toString()}`;
        }); 
      } else {
        cta.className = 'cta primary'; 
        cta.textContent = 'Take assessment';
        cta.addEventListener('click', () => {
          const base = (window.Constants && window.Constants.ASSESSMENT_TAKE_URL) || '';
          if (base) {
            const url = new URL(base, window.location.origin);
            url.searchParams.set('assessmentId', String(a.assessment_id));
            if (email) url.searchParams.set('email', email);
            window.location.href = url.toString();
          }
        });
      }
      metaRow.appendChild(meta); metaRow.appendChild(cta);
      content.appendChild(metaRow);

      card.appendChild(content);
      gridEl.appendChild(card);
    }
  }

  async function init() {
    const email = window.Api.getQueryParam('email');
    if (!email) {
      showMessage('Missing required URL parameter: email', 'error');
      return;
    }
    if (avgPercentEl) avgPercentEl.textContent = '0';
    showMessage('Loading…', 'info');
    try {
      const data = await window.Api.fetchTotalScoresByEmail(email);
      messageEl.classList.add('hidden');
      loadedEmail = email;
      renderAssessments(data, email);
      // Wire timeframe tabs
      tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          tabButtons.forEach(b => b.setAttribute('data-state', ''));
          btn.setAttribute('data-state', 'active');
          updateTrendForSelectedWindow();
        });
      });
      updateTrendForSelectedWindow();
    } catch (err) {
      showMessage(`Error loading data: ${err && err.message ? err.message : String(err)}`, 'error');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


