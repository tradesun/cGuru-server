// controllers/api.controller.js
// REST API handlers using read repository.
const {
  findLatestPerAssessmentByEmail,
  findAllSubmissionsByEmail,
  findSubmissionByResultKey,
  findCategoryScoresBySubmissionId,
  findQuestionsAndAnswersWithCategory,
  findLowestCategoriesForEmail
} = require('../repositories/read.repository');
const { createAction, getActionsByEmail, reorderActions, removeActionById, setActionOwnerEmail, updateActionStatusAndPostpone, setActionOwnerAcknowledged, setActionNotes, setActionStatus } = require('../repositories/actions.repository');
const profileRepo = require('../repositories/profile.repository');
const { getRecommendationByCategoryAndStage, getQuestionPlanByCodeAndStage } = require('../repositories/recommendations.repository');
const nodemailer = require('nodemailer');
const { assignmentEmail } = require('../utils/emailTemplates');

// getTotalScores: GET /api/v1/getTotalScores?email=
async function getTotalScores(req, res) {
  try {
    const email = (req.query && req.query.email ? String(req.query.email) : '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });
    const rows = await findLatestPerAssessmentByEmail(email);
    const profile = await profileRepo.getByEmail(email).catch(() => null);
    const items = rows.map(r => ({
      assessment_id: r.assessment_id,
      submission_id: r.submission_id,
      result_key: r.result_key,
      finished_at: r.finished_at,
      total_score: {
        percent: Number(r.total_percent)
      }
    }));
    return res.json({ email, profile: profile || null, items });
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
    const profile = await profileRepo.getByEmail(email).catch(() => null);
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
    return res.json({ email, profile: profile || null, assessments: Array.from(byAssessment.values()) });
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

    // Group answers per question (preserves order by numeric question_code, then answer id)
    const byQuestionRow = new Map();
    for (const r of qaRows) {
      const key = r.question_row_id;
      if (!byQuestionRow.has(key)) {
        byQuestionRow.set(key, {
          question_id: r.question_id,
          question_code: r.question_code || null,
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
      const cats = userActions.map(a => a.category_code).filter(Boolean);
      const qs = userActions.map(a => a.question_code).filter(Boolean);
      addedActions = [...new Set([...cats, ...qs].map(String))];
    } catch (e) {
      // best-effort; ignore failures
    }

    // Build quick lookup of stage per category for question enrichment
    const stageByCategoryId = new Map();
    for (const ec of enrichedCategories) {
      stageByCategoryId.set(String(ec.category_id), Number(ec.stage));
    }

    // Enrich questions with progression_comment/benefit and availability flag from question_plan
    const questionsArray = Array.from(byQuestionRow.values());
    const enrichedQuestions = await Promise.all(questionsArray.map(async (q) => {
      const code = q && q.question_code ? String(q.question_code) : '';
      const catId = q && q.category_id ? String(q.category_id) : '';
      const stageForCat = stageByCategoryId.has(catId) ? stageByCategoryId.get(catId) : undefined;
      let progression_comment = null;
      let benefit = null;
      let plan_available = false;
      if (code && Number.isInteger(stageForCat)) {
        const plan = await getQuestionPlanByCodeAndStage(code, Number(stageForCat));
        if (plan) {
          progression_comment = plan.progression_comment || null;
          benefit = plan.benefit || null;
          plan_available = true;
        }
      }
      return {
        ...q,
        progression_comment,
        benefit,
        plan_available
      };
    }));

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
      questions: enrichedQuestions
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
    const categoryCodeFromClient = body.category_code ? String(body.category_code).trim() : '';
    const stageNum = Number(body.stage);
    const actionType = (body.action_type ? String(body.action_type) : 'category').toLowerCase();
    const questionCode = body.question_code ? String(body.question_code).trim() : '';

    // Debug log - incoming payload
    console.log('[api] addAction incoming', { email, actionType, categoryId, categoryCodeFromClient, questionCode, stageNum });

    // Basic validation
    if (!email || email.length > 200 || !email.includes('@')) {
      return res.status(400).json({ error: 'invalid email' });
    }
    if (actionType === 'question') {
      if (!questionCode) return res.status(400).json({ error: 'question_code is required' });
      if (!Number.isInteger(stageNum)) return res.status(400).json({ error: 'stage must be an integer' });
      const created = await createAction({ email, categoryId: categoryId || categoryCodeFromClient, stage: stageNum, actionType, questionCode, categoryCode: categoryCodeFromClient, addedBy: 'Manually added', actionStatus: 'Active' });
      console.log('[api] addAction created(question)', created);
      return res.status(201).json(created);
    }
    if (!categoryId) return res.status(400).json({ error: 'category_id is required' });
    if (!Number.isInteger(stageNum)) return res.status(400).json({ error: 'stage must be an integer' });

    const created = await createAction({ email, categoryId, stage: stageNum, actionType: 'category', questionCode: null, addedBy: 'Manually added', actionStatus: 'Active' });
    console.log('[api] addAction created(category)', created);
    return res.status(201).json(created);
  } catch (err) {
    if (err && err.status) {
      console.error('[api] addAction error (handled)', { status: err.status, message: err.message });
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[api] addAction error (unhandled):', err);
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
      let rec = null;
      if (a.action_type === 'question' && a.question_code) {
        rec = await getQuestionPlanByCodeAndStage(a.question_code, Number(a.stage));
      } else {
        rec = await getRecommendationByCategoryAndStage(a.category_code, Number(a.stage));
      }
      results.push({
        action: {
          id: a.id,
          email: a.email,
          action_type: a.action_type,
          category_code: a.category_code,
          question_code: a.question_code,
          category_name: a.category_title || null,
          added_by: a.added_by || null,
          action_status: a.action_status || null,
          stage: Number(a.stage),
          list_order: Number(a.list_order),
          owner_email: a.owner_email || null,
          owner_acknowledged: a.owner_acknowledged ? true : false,
          postpone_date: a.postpone_date || null,
          notes: a.notes || null
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
// updateProfile: POST /api/v1/updateProfile
async function updateProfile(req, res) {
  try {
    const body = req.body || {};
    const required = ['email','domain','country','region','location','size','type','years_operating'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `missing field: ${k}` });
      }
    }
    const payload = {
      email: String(body.email).toLowerCase().trim(),
      domain: String(body.domain).toLowerCase().trim(),
      country: String(body.country).trim(),
      region: String(body.region).trim(),
      location: String(body.location).trim(),
      size: String(body.size).trim(),
      type: String(body.type).trim(),
      years_operating: Number(body.years_operating),
      top_line_revenue: body.top_line_revenue != null ? Number(body.top_line_revenue) : null,
      last_updated: new Date()
    };
    if (!Number.isInteger(payload.years_operating) || payload.years_operating < 0) {
      return res.status(400).json({ error: 'years_operating must be a non-negative integer' });
    }

    const existing = await profileRepo.getByDomain(payload.domain);
    if (!existing) {
      const id = await profileRepo.insertProfile(payload);
      return res.status(201).json({ ok: true, created: true, id });
    }
    await profileRepo.updateByDomain(payload.domain, payload);
    return res.json({ ok: true, updated: true });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.updateProfile = updateProfile;

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

// systemRecommendations: GET /api/v1/systemRecommendations?email=
async function systemRecommendations(req, res) {
  try {
    const email = (req.query && req.query.email ? String(req.query.email) : '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });

    // Cap total active system recommendations at 20
    const db = require('../db');
    const [cntRows] = await db.execute(
      "SELECT COUNT(*) AS cnt FROM actions WHERE email = ? AND added_by = ? AND (action_status IS NULL OR action_status = 'Active')",
      [email, 'System Recommendation']
    );
    const currentCount = Number(cntRows && cntRows[0] ? cntRows[0].cnt : 0);
    const remaining = Math.max(0, 20 - currentCount);
    if (remaining <= 0) return res.json({ ok: true, added: 0, reason: 'limit_reached' });

    // 1) pick lowest subcategories from current submissions
    const lowest = await findLowestCategoriesForEmail(email, 50);

    let actionsAdded = 0;
    let remainingActions = remaining; // cap counts individual actions
    for (const row of lowest) {
      if (remainingActions <= 0) break;
      const categoryId = String(row.category_id);
      // Derive stage from the category percent
      const pct = Number(row.min_percent);
      let stageForCategory;
      if (Number.isFinite(pct)) {
        if (pct <= 10) stageForCategory = 0;        // Awareness
        else if (pct <= 30) stageForCategory = 1;   // Foundational
        else if (pct <= 50) stageForCategory = 2;   // Developing
        else if (pct <= 70) stageForCategory = 3;   // Scaling
        else if (pct <= 90) stageForCategory = 4;   // Optimizing
        else stageForCategory = 5;                  // Leading
      } else {
        stageForCategory = 0;
      }
      // Category action
      try {
        const createdCat = await createAction({ email, categoryId, stage: stageForCategory, actionType: 'category', questionCode: null, addedBy: 'System Recommendation', actionStatus: 'Active' });
        if (createdCat && createdCat.id) { actionsAdded += 1; remainingActions -= 1; }
      } catch {}

      // Pick 2 random questions by (assessment_id, category_id)
      const qsql = `
        SELECT DISTINCT q.question_code
        FROM questions q
        LEFT JOIN question_categories qc ON qc.question_id = q.question_id
        WHERE q.assessment_id = ? AND qc.category_id = ?
        ORDER BY RAND() LIMIT 2
      `;
      const [qrows] = await db.execute(qsql, [row.assessment_id, row.category_id]);
      for (const qr of qrows) {
        if (remainingActions <= 0) break;
        const qCode = String(qr.question_code);
        try {
          const createdQ = await createAction({ email, categoryId, stage: stageForCategory, actionType: 'question', questionCode: qCode, addedBy: 'System Recommendation', actionStatus: 'Active' });
          if (createdQ && createdQ.id) { actionsAdded += 1; remainingActions -= 1; }
        } catch {}
      }
    }
    return res.json({ ok: true, added: actionsAdded, existing: currentCount, limit: 20 });
  } catch (err) {
    console.error('systemRecommendations error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.systemRecommendations = systemRecommendations;

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

// sendAssignmentEmail: POST /api/v1/sendAssignmentEmail
async function sendAssignmentEmail(req, res) {
  try {
    const GMAIL_USER = 'support@robust-mcore.com'
    const GMAIL_APP_PASSWORD = 'mlkljfxmwrdkdoir'
    const body = req.body || {};
    const toEmail = (body.to_email ? String(body.to_email) : '').trim();
    const fromEmail = (GMAIL_USER ? String(GMAIL_USER) : '').trim();
    const status = body.status ? String(body.status) : 'Assigned';
    const actionTitle = body.action_title ? String(body.action_title) : 'Action assigned to you';
    const link = body.link ? String(body.link) : '';
    const actionId = Number(body.action_id);
    if (!toEmail || !toEmail.includes('@')) return res.status(400).json({ error: 'to_email is required' });
    if (!fromEmail) return res.status(500).json({ error: 'mail not configured' });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });

    const html = assignmentEmail({ actionTitle, status, link, assigneeEmail: toEmail, assignerName: 'ChannelGuru' });
    const info = await transporter.sendMail({
      from: fromEmail,
      to: toEmail,
      subject: `New assignment${actionTitle ? `: ${actionTitle}` : ''}`,
      html
    });
    // Save owner_email to the action if provided
    if (Number.isInteger(actionId)) {
      try { await setActionOwnerEmail(actionId, toEmail); } catch (e) { console.warn('setActionOwnerEmail failed', e && e.message ? e.message : e); }
    }
    return res.json({ ok: true, messageId: info && info.messageId ? info.messageId : undefined });
  } catch (err) {
    console.error('sendAssignmentEmail error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.sendAssignmentEmail = sendAssignmentEmail;

// postponeAction: PUT /api/v1/postponeAction?action_id=
async function postponeAction(req, res) {
  try {
    const actionId = Number(req.query && req.query.action_id);
    if (!Number.isInteger(actionId)) return res.status(400).json({ error: 'action_id must be an integer' });
    const body = req.body || {};
    const postponeDateStr = body.postpone_date ? String(body.postpone_date) : '';
    // Basic ISO date validation (YYYY-MM-DD or full ISO)
    const date = postponeDateStr ? new Date(postponeDateStr) : null;
    if (!date || isNaN(date.getTime())) return res.status(400).json({ error: 'invalid postpone_date' });
    const iso = date.toISOString().slice(0, 19).replace('T', ' ');
    const ok = await updateActionStatusAndPostpone(actionId, 'Postponed', iso);
    if (!ok) return res.status(404).json({ error: 'action not found' });
    return res.json({ ok: true, action_id: actionId, action_status: 'Postponed', postpone_date: iso });
  } catch (err) {
    console.error('postponeAction error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.postponeAction = postponeAction;

// setOwnerAcknowledged: PUT /api/v1/setOwnerAcknowledged?action_id=
async function setOwnerAcknowledged(req, res) {
  try {
    const actionId = Number(req.query && req.query.action_id);
    if (!Number.isInteger(actionId)) return res.status(400).json({ error: 'action_id must be an integer' });
    const body = req.body || {};
    const acknowledged = !!body.acknowledged;
    const ok = await setActionOwnerAcknowledged(actionId, acknowledged);
    if (!ok) return res.status(404).json({ error: 'action not found' });
    return res.json({ ok: true, action_id: actionId, owner_acknowledged: acknowledged });
  } catch (err) {
    console.error('setOwnerAcknowledged error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.setOwnerAcknowledged = setOwnerAcknowledged;

// setActionNotesApi: PUT /api/v1/setActionNotes?action_id=
async function setActionNotesApi(req, res) {
  try {
    const actionId = Number(req.query && req.query.action_id);
    if (!Number.isInteger(actionId)) return res.status(400).json({ error: 'action_id must be an integer' });
    const body = req.body || {};
    const notes = body && typeof body.notes === 'string' ? body.notes : '';
    const ok = await setActionNotes(actionId, notes);
    if (!ok) return res.status(404).json({ error: 'action not found' });
    return res.json({ ok: true, action_id: actionId });
  } catch (err) {
    console.error('setActionNotes error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.setActionNotesApi = setActionNotesApi;

// setActionStatusApi: PUT /api/v1/setActionStatus?action_id=
async function setActionStatusApi(req, res) {
  try {
    const actionId = Number(req.query && req.query.action_id);
    if (!Number.isInteger(actionId)) return res.status(400).json({ error: 'action_id must be an integer' });
    const body = req.body || {};
    const actionStatus = body && typeof body.action_status === 'string' ? body.action_status : '';
    if (!actionStatus) return res.status(400).json({ error: 'action_status is required' });
    const ok = await setActionStatus(actionId, actionStatus);
    if (!ok) return res.status(404).json({ error: 'action not found' });
    return res.json({ ok: true, action_id: actionId, action_status: actionStatus });
  } catch (err) {
    console.error('setActionStatus error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.setActionStatusApi = setActionStatusApi;