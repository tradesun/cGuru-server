// repositories/recommendations.repository.js
// Fetch recommendation content for a given category_code and stage.
const pool = require('../db');

// getRecommendationByCategoryAndStage: returns a single record or null
async function getRecommendationByCategoryAndStage(categoryCode, stage) {
  const sql = `
    SELECT id, category_code, stage, action_title, why_it_matters,
           bullet_1, bullet_2, bullet_3
    FROM subcategory_plan
    WHERE category_code = ? AND stage = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [categoryCode, stage]);
  return rows && rows[0] ? rows[0] : null;
}

// getQuestionPlanByCodeAndStage: returns a single question-level recommendation by (question_code, stage)
async function getQuestionPlanByCodeAndStage(questionCode, stage) {
  const sql = `
    SELECT id, question_code,
           action_title, why_it_matters,
           recommended_step_1 AS bullet_1,
           recommended_step_2 AS bullet_2,
           recommended_step_3 AS bullet_3,
           progression_comment, benefit
    FROM question_plan
    WHERE question_code = ? AND stage = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [questionCode, stage]);
  return rows && rows[0] ? rows[0] : null;
}

module.exports = { getRecommendationByCategoryAndStage, getQuestionPlanByCodeAndStage };



