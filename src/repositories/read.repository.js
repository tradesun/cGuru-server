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

// findLowestCategoriesForEmail: returns 5 lowest percent categories across all submissions
async function findLowestCategoriesForEmail(email, limit = 5) {
  const sql = `
    WITH latest AS (
      SELECT s.id AS submission_id, s.assessment_id
      FROM (
        SELECT s.*, ROW_NUMBER() OVER (
          PARTITION BY s.assessment_id
          ORDER BY s.finished_at DESC, s.id DESC
        ) rn
        FROM submissions s
        WHERE s.email = ?
      ) s
      WHERE s.rn = 1
    )
    SELECT c.title, c.code AS category_code, c.id AS category_id, l.assessment_id, scs.percent AS min_percent
    FROM latest l
    JOIN submission_category_scores scs ON scs.submission_id = l.submission_id
    JOIN categories c ON c.id = scs.category_id
    WHERE (c.code IS NULL OR c.code NOT REGEXP '^[0-9]+(\\.[0-9]+)*$')
    ORDER BY scs.percent ASC
    LIMIT ?
  `;
  const [rows] = await pool.execute(sql, [email, Number(limit)]);
  return rows;
}

module.exports.findLowestCategoriesForEmail = findLowestCategoriesForEmail;

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

// findQuestionsAndAnswersWithCategory: questions/answers joined with mapping table (questions table)
async function findQuestionsAndAnswersWithCategory(submissionId, assessmentId) {
  const sql = `
    SELECT
      q.id AS question_row_id,
      q.question_id,
      q.question_code,
      q.question_text,
      sa.id AS answer_row_id,
      sa.answer_text,
      qc.category_id,
      ans.stage AS answer_stage
    FROM questions q
    JOIN submission_answers sa ON sa.question_id = q.question_id AND sa.submission_id = ?
    LEFT JOIN question_categories qc
      ON qc.assessment_id = ? AND qc.question_id = q.question_id
    LEFT JOIN answers ans
      ON ans.question_code = q.question_code AND ans.answer = sa.answer_text
    WHERE q.assessment_id = ?
    ORDER BY CAST(REPLACE(q.question_code, '.', '') AS UNSIGNED) ASC, sa.id ASC
  `;
  const [rows] = await pool.execute(sql, [submissionId, assessmentId, assessmentId]);
  // Debug rows to verify answer matching and origin
  try {
    const sample = rows.slice(0, 5).map(r => ({ code: r.question_code, ans: r.answer_text, matchStage: r.answer_stage })).slice(0, 5);
    // removed noisy server-side console
  } catch {}
  return rows;
}

module.exports.findSubmissionByResultKey = findSubmissionByResultKey;
module.exports.findCategoryScoresBySubmissionId = findCategoryScoresBySubmissionId;
module.exports.findQuestionsAndAnswersWithCategory = findQuestionsAndAnswersWithCategory;

// findLatestQuestionStageByEmailAndCode: stage for a question based on the latest submission's answer
async function findLatestQuestionStageByEmailAndCode(email, questionCode) {
  const sql = `
    SELECT ans.stage AS answer_stage
    FROM questions q
    JOIN submission_answers sa ON sa.question_id = q.question_id
    JOIN submissions s ON s.id = sa.submission_id AND s.email = ?
    LEFT JOIN answers ans ON ans.question_code = q.question_code AND ans.answer = sa.answer_text
    WHERE q.question_code = ?
    ORDER BY s.finished_at DESC, s.id DESC
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [email, questionCode]);
  return rows && rows[0] && (rows[0].answer_stage || rows[0].answer_stage === 0) ? Number(rows[0].answer_stage) : null;
}

module.exports.findLatestQuestionStageByEmailAndCode = findLatestQuestionStageByEmailAndCode;

// findLatestCategoryPercentByEmailAndCode: latest percent for a category code and email
async function findLatestCategoryPercentByEmailAndCode(email, categoryCode) {
  const sql = `
    SELECT scs.percent
    FROM submission_category_scores scs
    JOIN submissions s ON s.id = scs.submission_id AND s.email = ?
    JOIN categories c ON c.id = scs.category_id AND c.code = ?
    ORDER BY s.finished_at DESC, s.id DESC
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [email, categoryCode]);
  return rows && rows[0] && rows[0].percent != null ? Number(rows[0].percent) : null;
}

module.exports.findLatestCategoryPercentByEmailAndCode = findLatestCategoryPercentByEmailAndCode;

