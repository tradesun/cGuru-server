(function() {
  const messageEl = document.getElementById('message');
  const gridEl = document.getElementById('assessmentsGrid');
  const avgPercentEl = document.getElementById('avgPercent');
  const trendTextEl = document.getElementById('trendText');
  const tabsRoot = document.querySelector('.timeframe-tabs');
  const tabsCaptionEl = tabsRoot ? tabsRoot.querySelector('.tabs-caption') : null;
  const tabButtons = tabsRoot ? Array.from(tabsRoot.querySelectorAll('.tabs-list button')) : [];
  // region buttons inside summary
  const summaryRegionBtns = Array.from(document.querySelectorAll('.summary-block .tabs-list button'));
  const bmToggleBtn = document.getElementById('bmToggleBtn');
  const bmGrid = document.getElementById('bmGrid');
  const bmGridInner = document.getElementById('bmGridInner');

  let loadedData = null;
  let loadedEmail = null;
  let loadedAssessInfo = [];
  let selectedWindowDays = 90;
  let hasAnimatedAvg = false;
  let peersChipSet = false;
  const CARD_COLORS = ['#5BC8AF','#439EDA', '#5FB0B7', '#278BFD']

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

  function setProfileBand(data) {
    const profile = (data && data.profile) ? data.profile : null;
    const last = document.getElementById('profileLastUpdated');
    const bandCountry = document.getElementById('profileCountry');
    const bandRegion = document.getElementById('profileRegion');
    const bandLocation = document.getElementById('profileLocation');
    const bandSize = document.getElementById('profileSize');
    const bandType = document.getElementById('profileType');
    if (profile) {
      if (bandCountry && profile.country) bandCountry.textContent = String(profile.country);
      if (bandRegion && profile.region) bandRegion.textContent = String(profile.region);
      if (bandLocation && profile.location) bandLocation.textContent = String(profile.location);
      if (bandSize && (profile.size !== undefined && profile.size !== null)) bandSize.textContent = `${profile.size} staff`;
      if (bandType && profile.type) bandType.textContent = String(profile.type);
      if (last) {
        try { last.textContent = profile.last_updated ? new Date(profile.last_updated).toLocaleDateString() : '--'; }
        catch { last.textContent = '--'; }
      }
    } else if (last) {
      try {
        const iso = data && data.assessments && data.assessments[0] && data.assessments[0].latest ? data.assessments[0].latest.finished_at : '';
        last.textContent = iso ? new Date(iso).toLocaleDateString() : '--';
      } catch { last.textContent = '--'; }
    }
    const editBtn = document.getElementById('profileEditBtn');
    const panel = document.getElementById('profileEditPanel');
    const band = document.querySelector('.profile-band');
    const cancelBtn = document.getElementById('profileCancelBtn');
    const saveBtn = document.getElementById('profileSaveBtn');
    const lastEdit = document.getElementById('profileEditLast');
    const locMetroBtn = document.getElementById('locMetroBtn');
    const locRegionalBtn = document.getElementById('locRegionalBtn');
    if (lastEdit && last) lastEdit.textContent = last.textContent;
    function togglePanel(show) {
      if (!panel) return;
      panel.classList.toggle('hidden', !show);
      if (band) band.classList.toggle('hidden', !!show);
    }
    if (editBtn) editBtn.addEventListener('click', () => {
      // Prefill before show
      const bandCountry = document.getElementById('profileCountry');
      const bandRegion = document.getElementById('profileRegion');
      const bandLocation = document.getElementById('profileLocation');
      const bandSize = document.getElementById('profileSize');
      const bandType = document.getElementById('profileType');
      const inCountry = document.getElementById('profileCountryInput');
      const inRegion = document.getElementById('profileRegionInput');
      const inSize = document.getElementById('profileSizeInput');
      const inYears = document.getElementById('profileYearsInput');
      const inType = document.getElementById('profileTypeInput');
      const inRevenue = document.getElementById('profileRevenueInput');
      const inManagers = document.getElementById('profileManagersInput');
      if (inCountry && bandCountry) inCountry.value = bandCountry.textContent.trim();
      if (inRegion && bandRegion) inRegion.value = bandRegion.textContent.trim();
      if (inSize && bandSize) inSize.value = String((bandSize.textContent || '').replace(/[^0-9]/g, '')) || '';
      if (inType && bandType) inType.value = bandType.textContent.trim();
      // Prefill from profile object when available
      try {
        const prof = (data && data.profile) ? data.profile : null;
        if (prof) {
          if (inYears && (prof.years_operating !== undefined && prof.years_operating !== null)) inYears.value = String(prof.years_operating);
          if (inManagers && (prof.managers_beyond_ceo !== undefined && prof.managers_beyond_ceo !== null)) inManagers.value = String(prof.managers_beyond_ceo);
          if (inRevenue) inRevenue.value = (prof.top_line_revenue !== null && prof.top_line_revenue !== undefined) ? String(prof.top_line_revenue) : '';
        }
      } catch {}
      if (bandLocation && locMetroBtn && locRegionalBtn) {
        const loc = bandLocation.textContent.trim().toLowerCase();
        if (loc === 'regional') { locRegionalBtn.classList.add('is-active'); locMetroBtn.classList.remove('is-active'); }
        else { locMetroBtn.classList.add('is-active'); locRegionalBtn.classList.remove('is-active'); }
      }
      // Seed regions based on country selection
      try {
        const inCountry = document.getElementById('profileCountryInput');
        const inRegion = document.getElementById('profileRegionInput');
        const countryOtherWrap = document.getElementById('countryOtherWrap');
        if (inCountry && inRegion) {
          const isOther = String(inCountry.value).trim().toLowerCase() === 'other';
          if (countryOtherWrap) countryOtherWrap.classList.toggle('hidden', !isOther);
          inCountry.style.width = isOther ? '200px' : '';
          if (!isOther) {
            populateRegionsForCountry(inCountry.value, inRegion);
          } else {
            inRegion.disabled = true;
            inRegion.innerHTML = '<option>—</option>';
          }
        }
      } catch {}
      togglePanel(true);
    });
    if (cancelBtn) cancelBtn.addEventListener('click', () => togglePanel(false));
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      try {
        const email = window.Api.getQueryParam('email');
        if (!email) { alert('Missing email'); return; }
        const domain = String(email).toLowerCase().split('@')[1] || '';
        if (!domain) { alert('Invalid email'); return; }
        const inCountry = document.getElementById('profileCountryInput');
        const inRegion = document.getElementById('profileRegionInput');
        const inSize = document.getElementById('profileSizeInput');
        const inYears = document.getElementById('profileYearsInput');
        const inType = document.getElementById('profileTypeInput');
        const inRevenue = document.getElementById('profileRevenueInput');
        const inManagers = document.getElementById('profileManagersInput');
        const country = inCountry ? inCountry.value.trim() : '';
        const region = inRegion ? inRegion.value.trim() : '';
        const location = (locRegionalBtn && locRegionalBtn.classList.contains('is-active')) ? 'Regional' : 'Metro';
        const sizeVal = inSize ? parseInt(inSize.value, 10) : NaN;
        const yearsVal = inYears ? parseInt(inYears.value, 10) : NaN;
        const type = inType ? inType.value.trim() : '';
        const managersVal = inManagers && inManagers.value !== '' ? parseInt(inManagers.value, 10) : null;
        const revenueVal = inRevenue && inRevenue.value ? Number(String(inRevenue.value).replace(/[^0-9.\-]/g, '')) : null;
        const msgEl = document.getElementById('profileFormMsg');
        function showMsg(text, isError) {
          if (!msgEl) return;
          msgEl.textContent = text;
          msgEl.classList.remove('hidden');
          msgEl.classList.toggle('error', !!isError);
          msgEl.classList.toggle('success', !isError);
        }
        function clearMsg() { if (msgEl) { msgEl.textContent=''; msgEl.classList.add('hidden'); msgEl.classList.remove('error','success'); } }
        clearMsg();

        if (!country || !region || !location || !Number.isFinite(sizeVal) || sizeVal <= 0 || !type) {
          showMsg('Please complete Country, Region, Location, Size (>0), and Organisation Type.', true);
          return;
        }
        if (!Number.isFinite(yearsVal) || yearsVal < 0) { showMsg('Years operating must be a non‑negative number.', true); return; }
        const body = { email: String(email).toLowerCase(), domain: String(domain).toLowerCase(), country, region, location, size: sizeVal, type, years_operating: yearsVal };
        if (managersVal !== null && Number.isFinite(managersVal) && managersVal >= 0) body.managers_beyond_ceo = managersVal;
        if (revenueVal !== null && Number.isFinite(revenueVal)) body.top_line_revenue = revenueVal;
        const res = await fetch('/api/v1/updateProfile', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) });
        if (res.status === 200 || res.status === 201) {
          // Update band
          const bandCountry = document.getElementById('profileCountry');
          const bandRegion = document.getElementById('profileRegion');
          const bandLocation = document.getElementById('profileLocation');
          const bandSize = document.getElementById('profileSize');
          const bandType = document.getElementById('profileType');
          if (bandCountry) bandCountry.textContent = country;
          if (bandRegion) bandRegion.textContent = region;
          if (bandLocation) bandLocation.textContent = location;
          if (bandSize) bandSize.textContent = `${sizeVal} staff`;
          if (bandType) bandType.textContent = type;
          const nowStr = new Date().toLocaleDateString();
          const last = document.getElementById('profileLastUpdated');
          const lastEdit = document.getElementById('profileEditLast');
          if (last) last.textContent = nowStr;
          if (lastEdit) lastEdit.textContent = nowStr;
          showMsg('Profile saved successfully.', false);
          togglePanel(false);
        } else if (res.status === 400) {
          const j = await res.json().catch(() => ({}));
          showMsg(j && j.error ? j.error : 'Please check the form and try again.', true);
        } else {
          showMsg('Something went wrong while saving. Please try again.', true);
        }
      } catch (e) {
        const msgEl = document.getElementById('profileFormMsg');
        if (msgEl) {
          msgEl.textContent = 'Unable to save at the moment. Please try again shortly.';
          msgEl.classList.remove('hidden');
          msgEl.classList.add('error');
        }
      }
    });
    if (locMetroBtn && locRegionalBtn) {
      locMetroBtn.addEventListener('click', () => { locMetroBtn.classList.add('is-active'); locRegionalBtn.classList.remove('is-active'); });
      locRegionalBtn.addEventListener('click', () => { locRegionalBtn.classList.add('is-active'); locMetroBtn.classList.remove('is-active'); });
    }

    // Populate benchmarking simple viz
    try {
      const bmArc = document.getElementById('bmArc');
      const bmPeers = document.getElementById('bmPeers');
      const bmCompare = document.getElementById('bmCompare');
      const bmBarPeer = document.getElementById('bmBarPeer');
      const bmBarScore = document.getElementById('bmBarScore');
      const bmPeerVal = document.getElementById('bmPeerVal');
      const bmScoreVal = document.getElementById('bmScoreVal');
      const bmSummaryPeer = document.getElementById('bmSummaryPeer');
      const bmSummaryScore = document.getElementById('bmSummaryScore');
      const bmSummaryStatus = document.getElementById('bmSummaryStatus');
      // Compute user average of latest per assessment
      const latestPercents = (data.assessments || []).map(a => a && a.latest && a.latest.total_score ? Number(a.latest.total_score.percent) : null).filter(v => Number.isFinite(v));
      const avg = latestPercents.length ? Math.round(latestPercents.reduce((s, v) => s + v, 0) / latestPercents.length) : null;
      // Determine size range from profile.size if possible (tiers e.g., 15-29, 30-49, etc.). For now, derive a simple band.
      const profile = data && data.profile ? data.profile : null;
      const sizeVal = profile && profile.size != null ? parseInt(String(profile.size), 10) : NaN;
      function sizeToRange(val) {
        if (!Number.isFinite(val)) return '';
        if (val <= 4) return '1-4';           // Micro
        if (val <= 9) return '5-9';           // Small
        if (val <= 14) return '10-14';        // Growing
        if (val <= 29) return '15-29';        // Mid-size
        return '30-50';                       // Established (30–50 and above clamped here)
      }
      const sizeRange = sizeToRange(sizeVal);
      // Determine peer scope from active region button (Global/US/UK/Australia/NZ)
      function getSelectedRegionMap() {
        try {
          const btns = Array.from(document.querySelectorAll('.summary-block .tabs-list button'));
          const active = btns.find(b => b.getAttribute('data-state') === 'active');
          const label = active && active.textContent ? active.textContent.trim() : 'Global';
          if (label === 'US') return { type: 'single', country: 'United States', label: 'United States' };
          if (label === 'UK') return { type: 'single', country: 'United Kingdom', label: 'United Kingdom' };
          if (label.toLowerCase().includes('australia')) return { type: 'multi', countries: ['Australia','New Zealand'], label: 'Australia/NZ' };
          return { type: 'global', label: 'Global' };
        } catch { return { type: 'global', label: 'Global' }; }
      }
      const regionMap = getSelectedRegionMap();
      // Fetch peer average and render
      let currentPeer = null;
      const scopeLabel = regionMap.label || 'Global';
      function renderPeer(peer) {
        const isFinitePeer = Number.isFinite(peer);
        const diff = (avg !== null && isFinitePeer) ? (avg - peer) : null;
        if (bmArc && isFinitePeer) {
          bmArc.setAttribute('stroke-dasharray', `${peer} ${100 - peer}`);
        }
        if (bmPeers) bmPeers.textContent = isFinitePeer ? `Peers: ${scopeLabel} (${peer}%)` : `Peers: ${scopeLabel} (—%)`;
        if (bmCompare) {
          bmCompare.textContent = (diff !== null) ? `${diff > 0 ? '+' : ''}${diff}% ${diff >= 0 ? 'Ahead' : 'Behind'} vs ${scopeLabel}` : '--';
          if (diff !== null) {
            bmCompare.style.color = diff > 0 ? '#16a34a' : (diff < 0 ? '#b91c1c' : '')
          } else {
            bmCompare.style.color = '';
          }
        }
        if (bmBarPeer) bmBarPeer.style.width = isFinitePeer ? `${peer}%` : '0%';
        if (bmBarScore && avg !== null) bmBarScore.style.width = `${avg}%`;
        if (bmPeerVal) bmPeerVal.textContent = isFinitePeer ? `${peer}%` : '–';
        const chip = document.getElementById('chipBenchmark');
        if (chip) chip.textContent = isFinitePeer ? `${peer}%` : '–';
        // Set peers chip only once on first render to lock to user's region
        if (!peersChipSet) {
          const chipPeersLabel = document.getElementById('chipPeersRegionLabel');
          const chipPeersVal = document.getElementById('chipPeersRegionVal');
          if (chipPeersLabel) chipPeersLabel.textContent = scopeLabel;
          if (chipPeersVal) chipPeersVal.textContent = isFinitePeer ? `${peer}%` : '–';
          peersChipSet = true;
        }
        if (bmScoreVal && avg !== null) bmScoreVal.textContent = `${avg}%`;
        if (bmSummaryPeer) bmSummaryPeer.textContent = isFinitePeer ? `${peer}%` : '–';
        if (bmSummaryScore && avg !== null) bmSummaryScore.textContent = `${avg}%`;
        if (bmSummaryStatus) bmSummaryStatus.textContent = (diff !== null) ? `${diff > 0 ? '+' : ''}${diff}% ${diff >= 0 ? 'Ahead' : 'Behind'}` : '–';
        // If grid is expanded, re-render with new peer
        if (bmGrid && !bmGrid.classList.contains('hidden')) {
          renderBenchmarkGrid(data, isFinitePeer ? peer : 0);
        }
        // Update dial peer arc and stacking with user arc
        try {
          const userArc = document.getElementById('dialUserArc');
          const peerArc = document.getElementById('dialPeerArc');
          if (peerArc) {
            if (isFinitePeer) {
              peerArc.style.display = '';
              peerArc.setAttribute('stroke-dasharray', `${peer} ${100 - peer}`);
            } else {
              peerArc.style.display = 'none';
            }
          }
          const dial = document.getElementById('dialRings');
          const userVal = Number.isFinite(avg) ? avg : 0;
          if (dial && userArc && peerArc && isFinitePeer) {
            const userHigher = userVal >= peer;
            if (userHigher) { dial.appendChild(userArc); dial.appendChild(peerArc); }
            else { dial.appendChild(peerArc); dial.appendChild(userArc); }
          }
        } catch {}
      }
      function fetchPeerPromise() {
        if (regionMap.type === 'global') {
          return window.Api.fetchBenchmarkAverage(sizeRange, '');
        }
        if (regionMap.type === 'single') {
          return window.Api.fetchBenchmarkAverage(sizeRange, regionMap.country);
        }
        const p1 = window.Api.fetchBenchmarkAverage(sizeRange, regionMap.countries[0]).catch(() => null);
        const p2 = window.Api.fetchBenchmarkAverage(sizeRange, regionMap.countries[1]).catch(() => null);
        return Promise.all([p1, p2]).then(([r1, r2]) => {
          const a1 = r1 && r1.avg_total_score_percent != null ? Number(r1.avg_total_score_percent) : null;
          const c1 = r1 && r1.users_count != null ? Number(r1.users_count) : 0;
          const a2 = r2 && r2.avg_total_score_percent != null ? Number(r2.avg_total_score_percent) : null;
          const c2 = r2 && r2.users_count != null ? Number(r2.users_count) : 0;
          const denom = c1 + c2;
          const num = (Number.isFinite(a1) ? a1 * c1 : 0) + (Number.isFinite(a2) ? a2 * c2 : 0);
          const avg = denom > 0 ? Math.round(num / denom) : null;
          return { avg_total_score_percent: avg, users_count: denom };
        });
      }
      fetchPeerPromise()
        .then(peerResp => {
          currentPeer = (peerResp && peerResp.avg_total_score_percent != null) ? Math.round(Number(peerResp.avg_total_score_percent)) : null;
          // Update MEF summary if present in response
          try {
            const yourMEF = (() => {
              const prof = (data && data.profile) ? data.profile : null;
              const size = prof && prof.size != null ? Number(prof.size) : null;
              const mgr = prof && prof.managers_beyond_ceo != null ? Number(prof.managers_beyond_ceo) : null;
              if (Number.isFinite(size) && size > 0 && Number.isFinite(mgr) && mgr >= 0) return (mgr / size);
              return null;
            })();
            const peerMEF = peerResp && peerResp.avg_mef != null ? Number(peerResp.avg_mef) : null;
            const yourMEFEl = document.getElementById('bmSummaryYourMEF');
            const peerMEFEl = document.getElementById('bmSummaryPeerMEF');
            const diffEl = document.getElementById('bmSummaryYourMEFDiff');
            if (yourMEFEl) yourMEFEl.textContent = Number.isFinite(yourMEF) ? yourMEF.toFixed(3) : '—';
            if (peerMEFEl) peerMEFEl.textContent = Number.isFinite(peerMEF) ? peerMEF.toFixed(3) : '—';
            if (diffEl) {
              // Clear previous state
              diffEl.classList.remove('diff-up','diff-down');
              if (yourMEFEl) yourMEFEl.classList.remove('diff-up','diff-down');
              if (Number.isFinite(yourMEF) && Number.isFinite(peerMEF)) {
                const pct = peerMEF === 0 ? 0 : ((yourMEF - peerMEF) / peerMEF) * 100;
                const sign = pct > 0 ? '+' : '';
                // Up icon as provided; down = same rotated 180deg
                const upIcon = '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"></path><path d="M14 7h7v7"></path></svg>';
                const downIcon = '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(180deg);"><path d="M3 17l6-6 4 4 8-8"></path><path d="M14 7h7v7"></path></svg>';
                const isWorse = pct > 0; // higher MEF than peers = worse (red)
                diffEl.innerHTML = `${isWorse ? upIcon : downIcon} ${sign}${Math.abs(pct).toFixed(0)}%`;
                diffEl.classList.add(isWorse ? 'diff-down' : 'diff-up');
                if (yourMEFEl) yourMEFEl.classList.add(isWorse ? 'diff-down' : 'diff-up');
                // Inline color (mirror classes): red if worse, green if better
                diffEl.style.color = isWorse ? '#b91c1c' : '#16a34a';
                if (yourMEFEl) yourMEFEl.style.color = isWorse ? '#b91c1c' : '#16a34a';
              } else {
                diffEl.textContent = '—';
                diffEl.style.color = '';
                if (yourMEFEl) yourMEFEl.style.color = '';
              }
            }
          } catch {}
          renderPeer(currentPeer);
        })
        .catch(() => { renderPeer(null); });

      if (bmToggleBtn && bmGrid && bmGridInner) {
        bmToggleBtn.addEventListener('click', () => {
          const wasHidden = bmGrid.classList.contains('hidden');
          bmGrid.classList.toggle('hidden');
          bmToggleBtn.textContent = wasHidden ? 'Collapse' : 'Expand';
          if (wasHidden) {
            // Fetch per-assessment peers using same size/region mapping
            function fetchAssessPeersPromise() {
              return window.Api.fetchAssessmentPeerAverages(sizeRange, '');
            }
            fetchAssessPeersPromise().then(resp => {
              const peersByAssess = new Map();
              const rows = resp && Array.isArray(resp.items) ? resp.items : [];
              for (const r of rows) {
                peersByAssess.set(String(r.assessment_id), Number(r.avg_total_score_percent));
              }
              renderBenchmarkGridWithPeers(data, peersByAssess);
            }).catch(() => {
              renderBenchmarkGridWithPeers(data, new Map());
            });
          }
        });
      }
    } catch {}
  }

  function populateRegionsForCountry(country, regionSelect) {
    if (!regionSelect) return;
    const regionsMap = (window.Constants && window.Constants.COUNTRY_REGIONS) || {};
    const isOther = String(country).trim().toLowerCase() === 'other';
    const list = regionsMap[country] || [];
    regionSelect.innerHTML = '';
    if (isOther) {
      regionSelect.disabled = true;
      const opt = document.createElement('option');
      opt.textContent = '—';
      regionSelect.appendChild(opt);
      return;
    }
    regionSelect.disabled = false;
    for (const r of list) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      regionSelect.appendChild(opt);
    }
  }

  function renderBenchmarkGrid(data, peerPercent) {
    if (!bmGridInner) return;
    bmGridInner.innerHTML = '';
    const infoSorted = Array.isArray(loadedAssessInfo)
      ? loadedAssessInfo.slice().sort((a, b) => (Number(a.assessment_id) || 0) - (Number(b.assessment_id) || 0))
      : [];
    const byId = new Map((data.assessments || []).map(a => [String(a.assessment_id), a]));
    for (let idx = 0; idx < infoSorted.length; idx++) {
      const meta = infoSorted[idx];
      const a = byId.get(String(meta.assessment_id));
      const latest = a && a.latest && a.latest.total_score ? Number(a.latest.total_score.percent) : null;
      const color = '#00a6a6';
      const card = document.createElement('div');
      card.className = 'bm-card';
      // Create a few explicit "-20% Behind" examples by forcing index pattern
      const forceBehind = (idx % 4 === 1); // affects some cards only
      const displayLatest = forceBehind ? Math.max(0, peerPercent - 20) : (latest !== null ? latest : 0);
      const diff = forceBehind ? -20 : (latest !== null ? (latest - peerPercent) : null);
      const statusText = (diff !== null) ? `${diff > 0 ? '+' : ''}${diff}% ${diff >= 0 ? 'Ahead' : 'Behind'}` : '';
      const isBehind = (diff !== null) && diff < 0;
      card.innerHTML = `
        <div class="bm-card-head">
          <div class="bm-title">${meta.title}</div>
          <div class="bm-card-status ${isBehind ? 'is-behind' : ''}">${statusText}</div>
        </div>
        <div class="bm-mini-row">
          <div class="bm-mini-label">Benchmark</div>
          <div class="bm-mini-track"><div class="bm-mini-bar bm-peer" style="width:${peerPercent}%"></div></div>
          <div class="bm-mini-val">${peerPercent}%</div>
        </div>
        <div class="bm-mini-row">
          <div class="bm-mini-label">Score</div>
          <div class="bm-mini-track"><div class="bm-mini-bar bm-score" style="width:${displayLatest}%"></div></div>
          <div class="bm-mini-val">${latest !== null ? displayLatest : '--'}%</div>
        </div>
      `;
      bmGridInner.appendChild(card);
    }
  }

  function renderBenchmarkGridWithPeers(data, peersByAssess) {
    if (!bmGridInner) return;
    bmGridInner.innerHTML = '';
    const infoSorted = Array.isArray(loadedAssessInfo)
      ? loadedAssessInfo.slice().sort((a, b) => (Number(a.assessment_id) || 0) - (Number(b.assessment_id) || 0))
      : [];
    const byId = new Map((data.assessments || []).map(a => [String(a.assessment_id), a]));
    for (let idx = 0; idx < infoSorted.length; idx++) {
      const meta = infoSorted[idx];
      const a = byId.get(String(meta.assessment_id));
      const latest = a && a.latest && a.latest.total_score ? Number(a.latest.total_score.percent) : null;
      const peer = peersByAssess.has(String(meta.assessment_id)) ? Number(peersByAssess.get(String(meta.assessment_id))) : null;
      const card = document.createElement('div');
      card.className = 'bm-card';
      const diff = (latest !== null && Number.isFinite(peer)) ? (latest - peer) : null;
      const statusText = (diff !== null) ? `${diff > 0 ? '+' : ''}${diff}% ${diff >= 0 ? 'Ahead' : 'Behind'}` : '';
      const isBehind = (diff !== null) && diff < 0;
      const peerWidth = Number.isFinite(peer) ? `${peer}%` : '0%';
      const peerValText = Number.isFinite(peer) ? `${peer}%` : '—';
      const displayLatest = latest !== null ? latest : 0;
      card.innerHTML = `
        <div class="bm-card-head">
          <div class="bm-title">${meta.title}</div>
          <div class="bm-card-status ${isBehind ? 'is-behind' : ''}">${statusText}</div>
        </div>
        <div class="bm-mini-row">
          <div class="bm-mini-label">Benchmark</div>
          <div class="bm-mini-track"><div class="bm-mini-bar bm-peer" style="width:${peerWidth}"></div></div>
          <div class="bm-mini-val">${peerValText}</div>
        </div>
        <div class="bm-mini-row">
          <div class="bm-mini-label">Score</div>
          <div class="bm-mini-track"><div class="bm-mini-bar bm-score" style="width:${displayLatest}%"></div></div>
          <div class="bm-mini-val">${latest !== null ? displayLatest : '--'}%</div>
        </div>
      `;
      bmGridInner.appendChild(card);
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
      const numericDelta = Number(delta);
      const sign = numericDelta > 0 ? '+' : '';
      trendTextEl.textContent = `${sign}${Number.isFinite(numericDelta) ? numericDelta : 0}% ${caption}`;
      const trendContainer = trendTextEl.parentElement && trendTextEl.parentElement.classList && trendTextEl.parentElement.classList.contains('trend')
        ? trendTextEl.parentElement
        : null;
      if (Number.isFinite(numericDelta)) {
        if (numericDelta > 0) {
          trendTextEl.style.color = '#16a34a'; // green for up
          if (trendContainer) trendContainer.style.color = '#16a34a';
        } else if (numericDelta < 0) {
          trendTextEl.style.color = '#b91c1c'; // red for down
          if (trendContainer) trendContainer.style.color = '#b91c1c';
        } else {
          trendTextEl.style.color = '';
          if (trendContainer) trendContainer.style.color = '';
        }
      }
    }
    // Re-render sparklines to reflect selected window
    if (loadedData) {
      renderAssessments(loadedData, loadedEmail);
    }
  }

  function buildSparkline(container, values, labels, key, colorHex) {
    const strokeColor = colorHex || '#278BFD';
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
    stop1.setAttribute('offset', '5%'); stop1.setAttribute('stop-color', strokeColor); stop1.setAttribute('stop-opacity', '0.35');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '95%'); stop2.setAttribute('stop-color', strokeColor); stop2.setAttribute('stop-opacity', '0.02');
    grad.appendChild(stop1); grad.appendChild(stop2); defs.appendChild(grad); svg.appendChild(defs);

    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', areaPathD);
    areaPath.setAttribute('fill', `url(#${gradId})`);
    svg.appendChild(areaPath);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', linePathD);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', strokeColor);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);

    // Hover marker
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('r', '3.5');
    marker.setAttribute('fill', '#278BFD');
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
    // Update dial rings: user score and benchmark (hardcoded 64)
    try {
      const userArc = document.getElementById('dialUserArc');
      const peerArc = document.getElementById('dialPeerArc');
      const userVal = Number.isFinite(avg) ? avg : 0;
      const peerVal = 64;
      // Set arc lengths
      if (peerArc) peerArc.setAttribute('stroke-dasharray', `${peerVal} ${100 - peerVal}`);
      if (userArc) userArc.setAttribute('stroke-dasharray', `${userVal} ${100 - userVal}`);
      // Ensure higher percentage arc sits on top for visibility
      const dial = document.getElementById('dialRings');
      if (dial && userArc && peerArc) {
        const userHigher = userVal >= peerVal;
        // Place higher percentage below (earlier in DOM), lower on top (later)
        if (userHigher) {
          // user below, peer on top
          dial.appendChild(userArc);
          dial.appendChild(peerArc);
        } else {
          // peer below, user on top
          dial.appendChild(peerArc);
          dial.appendChild(userArc);
        }
      }
    } catch {}

    // Build full list: include assessments with no records, using order and titles from assessment_info.json
    const infoSorted = Array.isArray(loadedAssessInfo)
      ? loadedAssessInfo.slice().sort((a, b) => (Number(a.assessment_id) || 0) - (Number(b.assessment_id) || 0))
      : [];
    const allIds = infoSorted.map(i => String(i.assessment_id));
    const infoById = new Map(infoSorted.map(i => [String(i.assessment_id), i]));
    const byId = new Map();
    for (const a of data.assessments) {
      byId.set(String(a.assessment_id), a);
    }

    for (let idx = 0; idx < allIds.length; idx++) {
      const id = allIds[idx];
      const a = byId.get(String(id)) || { assessment_id: id, latest: null, history: [] };
      const latest = a.latest;
      const card = document.createElement('div');
      card.className = 'assessment-card' + (latest && latest.total_score ? '' : ' is-empty');
      const color = CARD_COLORS[idx % CARD_COLORS.length];

      const header = document.createElement('div');
      header.className = 'card-header';
      const title = document.createElement('h2');
      title.className = 'text-sm font-medium';
      // Use regular text color for title; do not color-cycle here
      title.style.color = '';
      const info = infoById.get(String(a.assessment_id));
      const assessmentName = (info && info.title) ? String(info.title) : `Assessment ${a.assessment_id}`;
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
      gauge.className = 'inline-block h-4 w-4';
      gauge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0-9-9"/><path d="M12 3v4"/><path d="M12 12l-3 3"/></svg>`;
      const current = document.createElement('span');
      current.className = 'current-label';
      current.textContent = 'Current';
      left.appendChild(gauge); left.appendChild(current);
      const right = document.createElement('div');
      right.className = 'current-value';
      // Keep default text color for current value
      right.style.color = '';
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
          sparkWrap.appendChild(buildSparkline(sparkWrap, series.values, series.labels, String(a.assessment_id), color));
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
      // Use regular text color; styling comes from CSS class .meta-text
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
      const [data, assessInfo] = await Promise.all([
        window.Api.fetchTotalScoresByEmail(email),
        fetch('/js/assessment_info.json', { headers: { 'Accept': 'application/json' } }).then(r => r.ok ? r.json() : [])
      ]);
      messageEl.classList.add('hidden');
      loadedEmail = email;
      loadedAssessInfo = Array.isArray(assessInfo) ? assessInfo : [];
      setProfileBand(data);
      // Wire country → regions linkage on the edit form
      const inCountry = document.getElementById('profileCountryInput');
      const inRegion = document.getElementById('profileRegionInput');
      const countryOtherWrap = document.getElementById('countryOtherWrap');
      const countryOtherInput = document.getElementById('profileCountryOtherInput');
      const datalist = document.getElementById('allCountriesList');
      // Populate datalist once
      if (datalist && window.Constants && Array.isArray(window.Constants.WORLD_COUNTRIES)) {
        datalist.innerHTML = '';
        window.Constants.WORLD_COUNTRIES.forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          datalist.appendChild(opt);
        });
      }
      if (inCountry && inRegion) {
        inCountry.addEventListener('change', () => {
          const val = String(inCountry.value).trim().toLowerCase();
          const isOther = val === 'other';
          if (countryOtherWrap) countryOtherWrap.classList.toggle('hidden', !isOther);
          inCountry.style.width = isOther ? '200px' : '';
          if (!isOther) {
            inRegion.disabled = false;
            populateRegionsForCountry(inCountry.value, inRegion);
          } else if (inRegion) {
            inRegion.disabled = true;
            inRegion.innerHTML = '<option>—</option>';
          }
        });
      }
      renderAssessments(data, email);
      // Wire timeframe tabs
      tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          tabButtons.forEach(b => b.setAttribute('data-state', ''));
          btn.setAttribute('data-state', 'active');
          updateTrendForSelectedWindow();
          // Recompute benchmarking using selected country
          setProfileBand(loadedData);
        });
      });
      // Wire summary region buttons: activate and refresh benchmarking
      summaryRegionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          summaryRegionBtns.forEach(b => b.setAttribute('data-state', ''));
          btn.setAttribute('data-state', 'active');
          console.log('[dashboard] region button clicked', btn.textContent.trim());
          // Recompute benchmarking using selected country
          setProfileBand(loadedData);
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


