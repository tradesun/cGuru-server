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

  window.Api = { getQueryParam, fetchTotalScoresByEmail };
})();


