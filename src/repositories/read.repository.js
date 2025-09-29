// repositories/read.repository.js
// Read-side queries for REST API.
const pool = require('../db');

// findLatestPerAssessmentByEmail: get latest submission per assessment for the given email
async function findLatestPerAssessmentByEmail(email) {
  const sql = `
    SELECT submission_id, assessment_id, result_key, finished_at, total_actual, total_percent, total_tier FROM (
      SELECT
        s.id AS submission_id,
        s.assessment_id,
        s.result_key,
        s.finished_at,
        s.total_actual,
        s.total_percent,
        s.total_tier,
        ROW_NUMBER() OVER (
          PARTITION BY s.assessment_id
          ORDER BY s.finished_at DESC, s.id DESC
        ) AS rn
      FROM submissions s
      WHERE s.email = ?
    ) ranked
    WHERE rn = 1
  `;
  const [rows] = await pool.execute(sql, [email]);
  return rows;
}

module.exports = { findLatestPerAssessmentByEmail };

// findAllSubmissionsByEmail: return all submissions for the email ordered by assessment, newest first
async function findAllSubmissionsByEmail(email) {
  const sql = `
    SELECT
      s.id AS submission_id,
      s.assessment_id,
      s.result_key,
      s.finished_at,
      s.total_actual,
      s.total_percent,
      s.total_tier
    FROM submissions s
    WHERE s.email = ?
    ORDER BY s.assessment_id ASC, s.finished_at DESC, s.id DESC
  `;
  const [rows] = await pool.execute(sql, [email]);
  return rows;
}

module.exports.findAllSubmissionsByEmail = findAllSubmissionsByEmail;

// findSubmissionByResultKey: header info for one submission
async function findSubmissionByResultKey(resultKey) {
  const sql = `
    SELECT id AS submission_id, assessment_id, email, finished_at, total_percent
    FROM submissions
    WHERE result_key = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [resultKey]);
  return rows[0] || null;
}

// findCategoryScoresBySubmissionId: categories with percent
async function findCategoryScoresBySubmissionId(submissionId) {
  const sql = `
    SELECT scs.category_id, c.title, c.code, scs.percent
    FROM submission_category_scores scs
    JOIN categories c ON c.id = scs.category_id
    WHERE scs.submission_id = ?
    ORDER BY scs.id DESC
  `;
  const [rows] = await pool.execute(sql, [submissionId]);
  return rows;
}

// findQuestionsAndAnswersWithCategory: questions/answers joined with mapping table
async function findQuestionsAndAnswersWithCategory(submissionId, assessmentId) {
  const sql = `
    SELECT
      sq.id AS submission_question_row_id,
      sq.question_id,
      sq.question_text,
      sa.answer_text,
      qc.category_id
    FROM submission_questions sq
    JOIN submission_answers sa ON sa.submission_question_id = sq.id
    LEFT JOIN question_categories qc
      ON qc.assessment_id = ? AND qc.question_id = sq.question_id
    WHERE sq.submission_id = ?
    ORDER BY sq.id DESC, sa.id DESC
  `;
  const [rows] = await pool.execute(sql, [assessmentId, submissionId]);
  return rows;
}

module.exports.findSubmissionByResultKey = findSubmissionByResultKey;
module.exports.findCategoryScoresBySubmissionId = findCategoryScoresBySubmissionId;
module.exports.findQuestionsAndAnswersWithCategory = findQuestionsAndAnswersWithCategory;

