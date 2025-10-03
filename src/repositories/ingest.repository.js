// repositories/ingest.repository.js
// Persists submissions, questions, answers, categories, and category scores to MySQL.
const pool = require('../db');

// saveAll: upsert submission, refresh children, and upsert category scores in a transaction
async function saveAll(normalized) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const s = normalized.submission;
    const insertSubmissionSql = `
      INSERT INTO submissions (
        external_id, result_key, email, assessment_id, finished_at,
        total_actual, total_percent, total_tier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        result_key = VALUES(result_key),
        email = VALUES(email),
        assessment_id = VALUES(assessment_id),
        finished_at = VALUES(finished_at),
        total_actual = VALUES(total_actual),
        total_percent = VALUES(total_percent),
        total_tier = VALUES(total_tier)
    `;
    const [submissionResult] = await connection.execute(insertSubmissionSql, [
      s.externalId, s.resultKey, s.email, s.assessmentId, s.finishedAt,
      s.totalActual, s.totalPercent, s.totalTier
    ]);

    let submissionId = submissionResult.insertId;
    if (!submissionId) {
      const [rows] = await connection.execute(
        'SELECT id FROM submissions WHERE external_id = ? LIMIT 1',
        [s.externalId]
      );
      submissionId = rows && rows[0] ? rows[0].id : null;
    }
    if (!submissionId) throw new Error('Failed to resolve submission id');

    // Refresh answers for this submission
    await connection.execute('DELETE FROM submission_answers WHERE submission_id = ?', [submissionId]);

    // Insert answers, validating questions exist globally for this assessment
    for (const q of normalized.questions) {
      // Validate question exists in questions table for this assessment
      const [existsRows] = await connection.execute(
        'SELECT 1 FROM questions WHERE assessment_id = ? AND question_id = ? LIMIT 1',
        [s.assessmentId, q.questionId]
      );
      if (!existsRows || !existsRows[0]) {
        const err = new Error('Unknown question_id for assessment');
        err.status = 400;
        throw err;
      }
      for (const a of q.answers) {
        await connection.execute(
          'INSERT INTO submission_answers (submission_id, question_id, answer_text) VALUES (?, ?, ?)',
          [submissionId, q.questionId, a]
        );
      }
    }

    // Upsert categories and refresh submission category scores
    await connection.execute('DELETE FROM submission_category_scores WHERE submission_id = ?', [submissionId]);
    for (const cs of normalized.categoryScores) {
      await connection.execute(
        'INSERT INTO categories (id, title, code) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title)',
        [cs.categoryId, cs.categoryTitle, null]
      );
      await connection.execute(
        'INSERT INTO submission_category_scores (submission_id, category_id, percent, tier) VALUES (?, ?, ?, ?)',
        [submissionId, cs.categoryId, cs.percent, cs.tier]
      );
    }

    await connection.commit();
    return submissionId;
  } catch (err) {
    try { await connection.rollback(); } catch (e) {}
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = { saveAll };


