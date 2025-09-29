// controllers/api.controller.js
// REST API handlers using read repository.
const {
  findLatestPerAssessmentByEmail,
  findAllSubmissionsByEmail,
  findSubmissionByResultKey,
  findCategoryScoresBySubmissionId,
  findQuestionsAndAnswersWithCategory
} = require('../repositories/read.repository');
const { createAction, getActionsByEmail, reorderActions, removeActionById } = require('../repositories/actions.repository');
const { getRecommendationByCategoryAndStage } = require('../repositories/recommendations.repository');

// getTotalScores: GET /api/v1/getTotalScores?email=
async function getTotalScores(req, res) {
  try {
    const email = (req.query && req.query.email ? String(req.query.email) : '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });
    const rows = await findLatestPerAssessmentByEmail(email);
    const items = rows.map(r => ({
      assessment_id: r.assessment_id,
      submission_id: r.submission_id,
      result_key: r.result_key,
      finished_at: r.finished_at,
      total_score: {
        percent: Number(r.total_percent)
      }
    }));
    return res.json({ email, items });
  } catch (err) {
    console.error('getTotalScores error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = { getTotalScores };

// getTotalScores with history: groups all submissions per assessment
module.exports.getTotalScores = async function(req, res) {
  try {
    const email = (req.query && req.query.email ? String(req.query.email) : '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const rows = await findAllSubmissionsByEmail(email);
    const byAssessment = new Map();
    for (const r of rows) {
      const key = r.assessment_id;
      const item = {
        submission_id: r.submission_id,
        result_key: r.result_key,
        finished_at: r.finished_at,
        total_score: {
          percent: Number(r.total_percent)
        }
      };
      if (!byAssessment.has(key)) {
        byAssessment.set(key, { assessment_id: key, latest: item, history: [] });
      } else {
        byAssessment.get(key).history.push(item);
      }
    }
    return res.json({ email, assessments: Array.from(byAssessment.values()) });
  } catch (err) {
    console.error('getTotalScores (history) error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// submissionDetails: GET /api/v1/submissionDetails?result_key=
async function submissionDetails(req, res) {
  try {
    const resultKey = (req.query && req.query.result_key ? String(req.query.result_key) : '').trim();
    if (!resultKey) return res.status(400).json({ error: 'result_key is required' });

    const sub = await findSubmissionByResultKey(resultKey);
    if (!sub) return res.status(404).json({ error: 'submission not found' });

    const categories = await findCategoryScoresBySubmissionId(sub.submission_id);
    const qaRows = await findQuestionsAndAnswersWithCategory(sub.submission_id, sub.assessment_id);

    // Group answers per question row id (preserves insert order by sq.id/sa.id)
    const byQuestionRow = new Map();
    for (const r of qaRows) {
      const key = r.submission_question_row_id;
      if (!byQuestionRow.has(key)) {
        byQuestionRow.set(key, {
          question_id: r.question_id,
          category_id: r.category_id || null,
          question_text: r.question_text,
          answers: []
        });
      }
      byQuestionRow.get(key).answers.push({ answer_text: r.answer_text });
    }

    // Enrich categories with code, stage, stage_name, and recommendation
    const stages = [
      { min: 0, max: 10, stage: 0, name: 'Awareness' },
      { min: 11, max: 30, stage: 1, name: 'Foundational' },
      { min: 11, max: 50, stage: 2, name: 'Developing' },
      { min: 51, max: 70, stage: 3, name: 'Scaling' },
      { min: 71, max: 90, stage: 4, name: 'Optimizing' },
      { min: 91, max: 100, stage: 5, name: 'Leading' }
    ];
    function classifyStage(percent) {
      for (const s of stages) {
        if (percent >= s.min && percent <= s.max) return { stage: s.stage, stage_name: s.name };
      }
      return { stage: 0, stage_name: 'Awareness' };
    }

    const enrichedCategories = [];
    for (const c of categories) {
      const cls = classifyStage(Number(c.percent));
      let recommendation = null;
      if (c.code && cls && Number.isInteger(cls.stage)) {
        const rec = await getRecommendationByCategoryAndStage(c.code, cls.stage);
        if (rec) {
          recommendation = {
            id: rec.id,
            action_title: rec.action_title,
            why_it_matters: rec.why_it_matters,
            bullet_1: rec.bullet_1,
            bullet_2: rec.bullet_2,
            bullet_3: rec.bullet_3
          };
        }
      }
      enrichedCategories.push({
        category_id: c.category_id,
        title: c.title,
        code: c.code || null,
        percent: Number(c.percent),
        stage: cls.stage,
        stage_name: cls.stage_name,
        recommendation
      });
    }

    // Fetch added actions for this email to include their category codes
    let addedActions = [];
    try {
      const userActions = await getActionsByEmail(String(sub.email).toLowerCase());
      addedActions = userActions.map(a => a.category_code).filter(Boolean);
    } catch (e) {
      // best-effort; ignore failures
    }

    return res.json({
      result_key: resultKey,
      submission: {
        submission_id: sub.submission_id,
        assessment_id: sub.assessment_id,
        email: sub.email,
        finished_at: sub.finished_at,
        total_score: { percent: Number(sub.total_percent) }
      },
      categories: enrichedCategories,
      added_actions: addedActions,
      questions: Array.from(byQuestionRow.values())
    });
  } catch (err) {
    console.error('submissionDetails error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.submissionDetails = submissionDetails;

// addAction: POST /api/v1/add_action
async function addAction(req, res) {
  try {
    const body = req.body || {};
    const email = (body.email ? String(body.email) : '').toLowerCase().trim();
    const categoryId = body.category_id ? String(body.category_id).trim() : '';
    const stageNum = Number(body.stage);

    // Basic validation
    if (!email || email.length > 200 || !email.includes('@')) {
      return res.status(400).json({ error: 'invalid email' });
    }
    if (!categoryId) {
      return res.status(400).json({ error: 'category_id is required' });
    }
    if (!Number.isInteger(stageNum)) {
      return res.status(400).json({ error: 'stage must be an integer' });
    }

    const created = await createAction({ email, categoryId, stage: stageNum });
    return res.status(201).json(created);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('addAction error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.addAction = addAction;

// getRecommendations: POST /api/v1/get_recommendations
async function getRecommendations(req, res) {
  try {
    const body = req.body || {};
    const categoryCode = body.category_code ? String(body.category_code).trim() : '';
    const stageNum = Number(body.stage);

    if (!categoryCode) {
      return res.status(400).json({ error: 'category_code is required' });
    }
    if (!Number.isInteger(stageNum)) {
      return res.status(400).json({ error: 'stage must be an integer' });
    }

    const rec = await getRecommendationByCategoryAndStage(categoryCode, stageNum);
    if (!rec) return res.status(404).json({ error: 'not found' });
    return res.json(rec);
  } catch (err) {
    console.error('getRecommendations error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.getRecommendations = getRecommendations;

// getAllRecommendations: GET /api/v1/get_all_recommendations?email=
async function getAllRecommendations(req, res) {
  try {
    const email = (req.query && req.query.email ? String(req.query.email) : '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const actions = await getActionsByEmail(email);
    const results = [];
    for (const a of actions) {
      const rec = await getRecommendationByCategoryAndStage(a.category_code, Number(a.stage));
      results.push({
        action: {
          id: a.id,
          email: a.email,
          category_code: a.category_code,
          category_name: a.category_title || null,
          stage: Number(a.stage),
          list_order: Number(a.list_order)
        },
        recommendation: rec || null
      });
    }
    return res.json({ email, items: results });
  } catch (err) {
    console.error('getAllRecommendations error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.getAllRecommendations = getAllRecommendations;

// getRecommendationsForDetailsPage: POST /api/v1/get_recommendations_for_details_page
async function getRecommendationsForDetailsPage(req, res) {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) return res.status(400).json({ error: 'items array is required' });

    // Normalize and validate input list
    const normalized = [];
    for (const it of items) {
      const code = it && it.code ? String(it.code).trim() : '';
      const stageNum = Number(it && it.stage);
      if (!code || !Number.isInteger(stageNum)) {
        return res.status(400).json({ error: 'each item must include code and integer stage' });
      }
      normalized.push({ code, stage: stageNum });
    }

    const results = await Promise.all(
      normalized.map(async (it) => {
        const rec = await getRecommendationByCategoryAndStage(it.code, it.stage);
        return { code: it.code, stage: it.stage, recommendation: rec || null };
      })
    );
    return res.json({ items: results });
  } catch (err) {
    console.error('getRecommendationsForDetailsPage error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.getRecommendationsForDetailsPage = getRecommendationsForDetailsPage;

// reorderAction: POST /api/v1/reorderAction?email=
async function reorderAction(req, res) {
  try {
    const email = (req.query && req.query.email ? String(req.query.email) : '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });
    const body = req.body || {};
    const orderArr = Array.isArray(body.order) ? body.order : null;
    if (!orderArr) return res.status(400).json({ error: 'order array is required' });

    const updates = [];
    for (const item of orderArr) {
      const actionId = Number(item && item.action_id);
      const ord = Number(item && item.order);
      if (!Number.isInteger(actionId) || !Number.isInteger(ord)) {
        return res.status(400).json({ error: 'order items must include integer action_id and order' });
      }
      updates.push({ action_id: actionId, order: ord });
    }

    const result = await reorderActions(email, updates);
    return res.json(result);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error('reorderAction error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.reorderAction = reorderAction;

// removeAction: PUT /api/v1/removeAction?action_id=
async function removeAction(req, res) {
  try {
    const actionId = Number(req.query && req.query.action_id);
    if (!Number.isInteger(actionId)) return res.status(400).json({ error: 'action_id must be an integer' });
    const ok = await removeActionById(actionId);
    if (!ok) return res.status(404).json({ error: 'action not found' });
    return res.json({ removed: true });
  } catch (err) {
    console.error('removeAction error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.removeAction = removeAction;