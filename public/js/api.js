(function() {
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  async function fetchTotalScoresByEmail(email) {
    const url = `/api/v1/getTotalScores?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Request failed with status ${res.status}`);
    }
    return res.json();
  }

  async function fetchBenchmarkAverage(sizeRange, country) {
    const params = new URLSearchParams();
    if (sizeRange) params.set('size_range', sizeRange);
    if (country) params.set('country', country);
    const url = `/api/v1/benchmark/user_totals_avg${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Request failed with status ${res.status}`);
    }
    return res.json();
  }

  async function fetchAssessmentPeerAverages(sizeRange, country) {
    const params = new URLSearchParams();
    if (sizeRange) params.set('size_range', sizeRange);
    if (country) params.set('country', country);
    const url = `/api/v1/benchmark/assessment_avgs${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Request failed with status ${res.status}`);
    }
    return res.json();
  }

  // Removed: MEF now comes with user_totals_avg

  window.Api = { getQueryParam, fetchTotalScoresByEmail, fetchBenchmarkAverage, fetchAssessmentPeerAverages };
})();


