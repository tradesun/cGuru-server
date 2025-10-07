(() => {
  // Query 1 loader
  async function loadQuery1Rows() {
    try {
      // Try to reuse size/country controls if present to filter Query 1 as well
      const szEl = document.getElementById('sizeSelect2');
      const ctEl = document.getElementById('countrySelect2');
      const params = new URLSearchParams();
      if (szEl && szEl.value) params.set('size_range', szEl.value);
      if (ctEl && ctEl.value) params.set('country', ctEl.value);
      const url = `/api/v1/benchmark/user_totals${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      const rows = Array.isArray(data.items) ? data.items : [];
      const tbody = document.querySelector('#resultsTable1 tbody');
      if (tbody) {
        tbody.innerHTML = rows.map(r => `
          <tr>
            <td>${r.email || ''}</td>
            <td>${r.total_score_percent != null ? r.total_score_percent : ''}</td>
            <td>${r.assessments_count != null ? r.assessments_count : ''}</td>
            <td>${r.size != null ? r.size : ''}</td>
            <td>${r.country != null ? r.country : ''}</td>
            <td>${r.region != null ? r.region : ''}</td>
            <td>${r.location != null ? r.location : ''}</td>
          </tr>
        `).join('');
      }
    } catch {}
  }

  // Query 2 dynamic controls
  const sizeSelect = document.getElementById('sizeSelect2');
  const countrySelect = document.getElementById('countrySelect2');
  const applyBtn = document.getElementById('applyBtn2');
  const resetBtn = document.getElementById('resetBtn2');
  const resultsBody = document.querySelector('#resultsTable2 tbody');
  const sqlBlock = document.getElementById('sqlBlock2');
  const aggAvgEl = document.getElementById('aggAvg');
  const aggCountEl = document.getElementById('aggCount');
  const sqlBlock2b = document.getElementById('sqlBlock2b');
  const perAssessmentBody = document.querySelector('#perAssessmentTable tbody');

  const BASE_SQL = `WITH latest_per_assessment AS (
  SELECT
    s.email,
    s.assessment_id,
    s.total_percent,
    ROW_NUMBER() OVER (
      PARTITION BY s.email, s.assessment_id
      ORDER BY s.finished_at DESC, s.id DESC
    ) AS rn
  FROM submissions s
)
SELECT
  l.email,
  ROUND(AVG(l.total_percent))      AS total_score_percent,
  COUNT(*)                         AS assessments_count,
  MAX(p.size)                      AS size,
  MAX(p.country)                   AS country,
  MAX(p.region)                    AS region,
  MAX(p.location)                  AS location
FROM latest_per_assessment l
LEFT JOIN profile p
  ON p.email = l.email
WHERE l.rn = 1 /* AND [filters] */
GROUP BY l.email
ORDER BY l.email;`;

  function updateSqlBlock() {
    const filters = [];
    const size = sizeSelect.value;
    const country = countrySelect.value;
    if (size) filters.push(`CAST(p.size AS UNSIGNED) BETWEEN ${size.replace('-', ' AND ')}`);
    if (country) filters.push(`p.country = '${country}'`);
    const sql = BASE_SQL.replace('[filters]', filters.join(' AND '));
    sqlBlock.textContent = sql;
    // Update per-assessment SQL preview
    const perAssessmentSQL = `WITH latest_per_assessment AS (\n  SELECT\n    s.email,\n    s.assessment_id,\n    s.total_percent,\n    ROW_NUMBER() OVER (\n      PARTITION BY s.email, s.assessment_id\n      ORDER BY s.finished_at DESC, s.id DESC\n    ) AS rn\n  FROM submissions s\n),\nfiltered AS (\n  SELECT\n    l.email,\n    l.assessment_id,\n    l.total_percent\n  FROM latest_per_assessment l\n  LEFT JOIN profile p\n    ON p.email = l.email\n  WHERE l.rn = 1${filters.length ? `\n    AND ${filters.join(' AND ')}` : ''}\n)\nSELECT\n  assessment_id,\n  ROUND(AVG(total_percent)) AS avg_total_score_percent,\n  COUNT(*)                  AS users_count\nFROM filtered\nGROUP BY assessment_id\nORDER BY CAST(assessment_id AS UNSIGNED);`;
    if (sqlBlock2b) sqlBlock2b.textContent = perAssessmentSQL;
  }

  async function loadCountries() {
    try {
      const res = await fetch('/api/v1/benchmark/countries');
      const data = await res.json();
      const countries = Array.isArray(data.countries) ? data.countries : [];
      for (const c of countries) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        countrySelect.appendChild(opt);
      }
    } catch (e) {
      // ignore errors, dropdown will stay with All only
    }
  }

  async function fetchAndRender() {
    const params = new URLSearchParams();
    if (sizeSelect.value) params.set('size_range', sizeSelect.value);
    if (countrySelect.value) params.set('country', countrySelect.value);
    const [aggRes, perRes] = await Promise.all([
      fetch(`/api/v1/benchmark/user_totals_avg${params.toString() ? `?${params.toString()}` : ''}`),
      fetch(`/api/v1/benchmark/user_totals_avg_per_assessment${params.toString() ? `?${params.toString()}` : ''}`)
    ]);
    const aggData = await aggRes.json();
    const perData = await perRes.json();
    aggAvgEl.textContent = aggData && aggData.avg_total_score_percent != null ? aggData.avg_total_score_percent : '-';
    aggCountEl.textContent = aggData && aggData.users_count != null ? aggData.users_count : '-';
    resultsBody.innerHTML = '';
    const perRows = Array.isArray(perData.items) ? perData.items : [];
    if (perAssessmentBody) {
      perAssessmentBody.innerHTML = perRows.map(r => `
        <tr>
          <td>${r.assessment_id != null ? r.assessment_id : ''}</td>
          <td>${r.avg_total_score_percent != null ? r.avg_total_score_percent : ''}</td>
          <td>${r.users_count != null ? r.users_count : ''}</td>
        </tr>
      `).join('');
    }
    updateSqlBlock();
  }

  applyBtn.addEventListener('click', fetchAndRender);
  resetBtn.addEventListener('click', () => {
    sizeSelect.value = '';
    countrySelect.value = '';
    fetchAndRender();
  });

  // init
  loadQuery1Rows();
  loadCountries().then(fetchAndRender);
  updateSqlBlock();
})();


