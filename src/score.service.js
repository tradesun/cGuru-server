// score.service.js
// Transforms raw webhook payloads into normalized objects for DB persistence.
// toSafeString: coerce values to non-null strings
function toSafeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

// toNumberOrZero: convert value to finite number or 0
function toNumberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

// normalize: extract and normalize submission, questions, and category scores
function normalize(payload, assessmentId) {
  const data = payload && payload.data ? payload.data : {};

  const submission = {
    externalId: toSafeString(data.id),
    resultKey: toSafeString(data.key),
    email: toSafeString(data.email).toLowerCase(),
    assessmentId: toSafeString(assessmentId),
    finishedAt: data.finished_at ? new Date(data.finished_at) : new Date(),
    totalActual: toNumberOrZero(data.total_score && data.total_score.actual),
    totalPercent: toNumberOrZero(data.total_score && data.total_score.percent),
    totalTier: toSafeString(data.total_score && data.total_score.tier)
  };

  const questions = Array.isArray(data.quiz_questions) ? data.quiz_questions.map(q => ({
    questionId: toSafeString(q.id),
    questionText: toSafeString(q.question),
    answers: Array.isArray(q.answers) ? q.answers
      .map(a => toSafeString(a && (a.answer !== undefined ? a.answer : a)))
      .filter(a => a.length > 0) : []
  })) : [];

  const categoryScores = Array.isArray(data.category_scores) ? data.category_scores.map(cs => ({
    categoryId: toSafeString(cs.category && cs.category.id),
    categoryTitle: toSafeString(cs.category && cs.category.title),
    percent: toNumberOrZero(cs.percent),
    tier: toSafeString(cs.tier)
  })).filter(cs => cs.categoryId) : [];

  return { submission, questions, categoryScores };
}

module.exports = { normalize };


