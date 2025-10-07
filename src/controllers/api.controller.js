// controllers/api.controller.js
// REST API handlers using read repository.
const {
  findLatestPerAssessmentByEmail,
  findAllSubmissionsByEmail,
  findSubmissionByResultKey,
  findCategoryScoresBySubmissionId,
  findQuestionsAndAnswersWithCategory,
  findLowestCategoriesForEmail,
  findLatestQuestionStageByEmailAndCode,
  findLatestCategoryPercentByEmailAndCode
} = require('../repositories/read.repository');
const { createAction, getActionsByEmail, reorderActions, removeActionById, setActionOwnerEmail, updateActionStatusAndPostpone, setActionOwnerAcknowledged, setActionNotes, setActionStatus, appendActionLog, getActionById, setActionInvites } = require('../repositories/actions.repository');
const profileRepo = require('../repositories/profile.repository');
const { getRecommendationByCategoryAndStage, getQuestionPlanByCodeAndStage, getResourcesByQuestionAndStage } = require('../repositories/recommendations.repository');
const nodemailer = require('nodemailer');
const { assignmentEmail, actionReviewEmail } = require('../utils/emailTemplates');
const db = require('../db');

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
          answers: [],
          answer_stage: (r.answer_stage || r.answer_stage === 0) ? Number(r.answer_stage) : null
        });
      }
      byQuestionRow.get(key).answers.push({ answer_text: r.answer_text });
      // Prefer first non-null numeric answer_stage if present on any row for this question
      const current = byQuestionRow.get(key);
      if ((r.answer_stage || r.answer_stage === 0) && (current.answer_stage === null || current.answer_stage === undefined)) {
        current.answer_stage = Number(r.answer_stage);
      }
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
    let questionActionStatusByCode = {};
    let categoryActionStatusByCode = {};
    try {
      const userActions = await getActionsByEmail(String(sub.email).toLowerCase());
      const cats = userActions.map(a => a.category_code).filter(Boolean);
      const qs = userActions.map(a => a.question_code).filter(Boolean);
      addedActions = [...new Set([...cats, ...qs].map(String))];
      // Build status map for question actions
      for (const a of userActions) {
        if (a && a.question_code) {
          questionActionStatusByCode[String(a.question_code)] = a.action_status || null;
        }
        if (a && a.category_code && a.action_type === 'category') {
          categoryActionStatusByCode[String(a.category_code)] = a.action_status || null;
        }
      }
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
      let has_resources = false;
      // Prefer the specific question's answer_stage; fall back to category stage only if missing
      const ansStage = (q && (q.answer_stage || q.answer_stage === 0)) ? Number(q.answer_stage) : null;
      const stageToUse = Number.isInteger(ansStage) ? ansStage : (Number.isInteger(stageForCat) ? Number(stageForCat) : null);
      if (code && Number.isInteger(stageToUse)) {
        const plan = await getQuestionPlanByCodeAndStage(code, Number(stageToUse));
        if (plan) {
          progression_comment = plan.progression_comment || null;
          benefit = plan.benefit || null;
          plan_available = true;
        }
        try {
          const resRows = await getResourcesByQuestionAndStage(code, Number(stageToUse));
          has_resources = Array.isArray(resRows) && resRows.length > 0;
        } catch {}
      }
      return {
        ...q,
        answer_stage: q && (q.answer_stage || q.answer_stage === 0) ? Number(q.answer_stage) : null,
        progression_comment,
        benefit,
        plan_available,
        has_resources
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
      question_actions_status: questionActionStatusByCode,
      category_actions_status: categoryActionStatusByCode,
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
      const created = await createAction({ email, categoryId: categoryId || categoryCodeFromClient, stage: stageNum, actionType, questionCode, categoryCode: categoryCodeFromClient, addedBy: 'My Action', actionStatus: 'Not Assigned' });
      console.log('[api] addAction created(question)', created);
      return res.status(201).json(created);
    }
    if (!categoryId) return res.status(400).json({ error: 'category_id is required' });
    if (!Number.isInteger(stageNum)) return res.status(400).json({ error: 'stage must be an integer' });

    const created = await createAction({ email, categoryId, stage: stageNum, actionType: 'category', questionCode: null, addedBy: 'My Action', actionStatus: 'Not Assigned' });
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

    // Overdue cleanup: invites format dd/mm/yy|HH:MM|...
    const today = new Date(); today.setHours(0,0,0,0);
    function parseDdMmYy(s){
      try { const [dd,mm,yy] = String(s||'').split('/'); const d = new Date(2000+parseInt(yy,10), parseInt(mm,10)-1, parseInt(dd,10)); return isNaN(d.getTime())?null:d; } catch { return null; }
    }
    for (const a of actions) {
      try {
        const inv = a && a.invites ? String(a.invites) : '';
        const due = parseDdMmYy(inv.split('|')[0] || '');
        if (due && due < today) {
          const st = a && a.action_status ? String(a.action_status) : '';
          if (st !== 'Completed' && st !== 'Overdue') {
            await setActionStatus(a.id, 'Overdue');
            a.action_status = 'Overdue';
            try {
              const ts = new Date().toLocaleString('en-US', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
              await appendActionLog(a.id, `${ts}: Action marked Overdue (due ${inv.split('|')[0] || '—'})`);
            } catch {}
          }
        }
      } catch {}
    }
    const results = [];
    for (const a of actions) {
      let rec = null;
      let resources = [];
      if (a.action_type === 'question' && a.question_code) {
        rec = await getQuestionPlanByCodeAndStage(a.question_code, Number(a.stage));
        try {
          resources = await getResourcesByQuestionAndStage(a.question_code, Number(a.stage));
        } catch {}
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
          assessment_id: a.assessment_id || null,
          category_name: a.category_title || null,
          added_by: a.added_by || null,
          action_status: a.action_status || null,
          stage: Number(a.stage),
          list_order: Number(a.list_order),
          owner_email: a.owner_email || null,
          owner_acknowledged: a.owner_acknowledged ? true : false,
          postpone_date: a.postpone_date || null,
          notes: a.notes || null,
          log: a.log || null,
          invites: a.invites || null
        },
        recommendation: rec || null,
        resources: Array.isArray(resources) ? resources : []
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
      managers_beyond_ceo: body.managers_beyond_ceo != null ? Number(body.managers_beyond_ceo) : null,
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

    // Cleanup: mark existing actions with mismatched current stage as 'Stage Changed'
    try {
      const existing = await getActionsByEmail(email);
      for (const a of existing) {
        if (a && a.action_type === 'question' && a.question_code) {
          const currentStage = await findLatestQuestionStageByEmailAndCode(email, String(a.question_code));
          if (currentStage !== null && Number.isFinite(Number(currentStage)) && Number(a.stage) !== Number(currentStage)) {
            try { await setActionStatus(Number(a.id), 'Stage Changed'); } catch {}
          }
        } else if (a && a.action_type === 'category' && a.category_code) {
          const pct = await findLatestCategoryPercentByEmailAndCode(email, String(a.category_code));
          if (pct !== null) {
            let stageNow;
            if (pct <= 10) stageNow = 0; else if (pct <= 30) stageNow = 1; else if (pct <= 50) stageNow = 2; else if (pct <= 70) stageNow = 3; else if (pct <= 90) stageNow = 4; else stageNow = 5;
            if (Number(a.stage) !== Number(stageNow)) {
              try { await setActionStatus(Number(a.id), 'Stage Changed'); } catch {}
            }
          }
        }
      }
    } catch (e) {
      console.warn('[api] systemRecommendations cleanup failed', e && e.message ? e.message : e);
    }

    const db = require('../db');
    // Build list of question_code + answer_stage from the user's latest submissions across assessments
    const qsql = `
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
      SELECT DISTINCT q.question_code,
             ans.stage AS answer_stage,
             qc.category_id
      FROM questions q
      JOIN submission_answers sa ON sa.question_id = q.question_id
      JOIN latest l ON l.submission_id = sa.submission_id
      JOIN submissions s2 ON s2.id = sa.submission_id
      LEFT JOIN question_categories qc ON qc.assessment_id = s2.assessment_id AND qc.question_id = q.question_id
      LEFT JOIN answers ans ON ans.question_code = q.question_code AND ans.answer = sa.answer_text
      WHERE ans.stage IS NOT NULL
      ORDER BY ans.stage ASC, q.question_code ASC
      LIMIT 200
    `;
    const [qrows] = await db.execute(qsql, [email]);

    let actionsAdded = 0;
    for (const qr of qrows) {
      if (actionsAdded >= 20) break;
      const qCode = String(qr.question_code);
      const qStage = Number(qr.answer_stage);
      const categoryId = qr && qr.category_id ? String(qr.category_id) : null;
      // Skip if any non–Stage Changed action already exists for this user+question+stage
      const [existsRows] = await db.execute(
        "SELECT 1 FROM actions WHERE email = ? AND question_code = ? AND stage = ? AND (action_status IS NULL OR action_status <> 'Stage Changed') LIMIT 1",
        [email, qCode, qStage]
      );
      if (existsRows && existsRows[0]) continue;
      // Require at least one resource
      try {
        const resRows = await getResourcesByQuestionAndStage(qCode, qStage);
        if (!resRows || resRows.length === 0) continue;
      } catch { continue; }
      try {
        const createdQ = await createAction({ email, categoryId, stage: qStage, actionType: 'question', questionCode: qCode, addedBy: 'Suggested Action', actionStatus: 'Active' });
        if (createdQ && createdQ.id) { actionsAdded += 1; }
      } catch {}
    }
    return res.json({ ok: true, added: actionsAdded });
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

    const senderEmailParam = req.query && req.query.email ? String(req.query.email).trim() : '';
    const derivedName = senderEmailParam && senderEmailParam.includes('@')
      ? String(senderEmailParam.split('@')[0] || '')
          .split(/[._-]+/)
          .filter(Boolean)
          .map(s => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ')
      : 'ChannelGuru';
    // Build deep link to the specific action with assignee email
    const publicUrl = process.env.PUBLIC_APP_URL && String(process.env.PUBLIC_APP_URL).trim();
    const reqOrigin = (req && req.headers && req.headers.origin) ? String(req.headers.origin) : '';
    const baseUrl = publicUrl || reqOrigin || 'http://127.0.0.1:3000';
    const actionLink = `${baseUrl.replace(/\/$/, '')}/next.html?email=${encodeURIComponent(toEmail)}${Number.isInteger(actionId) ? `&select_action_id=${encodeURIComponent(actionId)}` : ''}`;
    const ackDirectLink = `${actionLink}&acknowledge=direct`;
    const ackViewLink = `${actionLink}&acknowledge=true`;

    const html = assignmentEmail({
      actionTitle,
      status,
      link: actionLink,
      assigneeEmail: toEmail,
      assignerName: derivedName || 'ChannelGuru',
      assignerEmail: senderEmailParam || '',
      whyItMatters: body.why_it_matters ? String(body.why_it_matters) : '',
      acknowledgeDirectLink: ackDirectLink,
      acknowledgeViewLink: ackViewLink
    });
    const info = await transporter.sendMail({
      from: fromEmail,
      to: toEmail,
      subject: `New assignment${actionTitle ? `: ${actionTitle}` : ''}`,
      html
    });
    // Save owner_email to the action if provided
    if (Number.isInteger(actionId)) {
      try { await setActionOwnerEmail(actionId, toEmail); } catch (e) { console.warn('setActionOwnerEmail failed', e && e.message ? e.message : e); }
      try {
        const ts = new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        await appendActionLog(actionId, `${ts}: Owner assignment email sent to ${toEmail}`);
      } catch {}
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
    try {
      const ts = new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      await appendActionLog(actionId, `${ts}: Owner acknowledged set to ${acknowledged ? 'true' : 'false'}`);
    } catch {}
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
    try {
      const ts = new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      await appendActionLog(actionId, `${ts}: Action status changed to ${actionStatus}`);
    } catch {}
    return res.json({ ok: true, action_id: actionId, action_status: actionStatus });
  } catch (err) {
    console.error('setActionStatus error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.setActionStatusApi = setActionStatusApi;

// setActionOwnersRaw: PUT /api/v1/setActionOwnersRaw?action_id=
async function setActionOwnersRaw(req, res) {
  try {
    const actionId = Number(req.query && req.query.action_id);
    if (!Number.isInteger(actionId)) return res.status(400).json({ error: 'action_id must be an integer' });
    const body = req.body || {};
    const owners = typeof body.owners === 'string' ? body.owners : '';
    // Detect removed owners for logging
    try {
      const prev = await getActionById(actionId);
      const prevOwners = prev && prev.owner_email ? String(prev.owner_email) : '';
      const prevSet = new Set(prevOwners.split(',').map(s => s.trim()).filter(Boolean).map(s => s.split('|')[0]));
      const nextSet = new Set(String(owners).split(',').map(s => s.trim()).filter(Boolean).map(s => s.split('|')[0]));
      for (const em of prevSet) {
        if (!nextSet.has(em)) {
          const ts = new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
          try { await appendActionLog(actionId, `${ts}: Owner removed ${em}`); } catch {}
        }
      }
    } catch {}
    const ok = await setActionOwnerEmail(actionId, owners);
    if (!ok) return res.status(404).json({ error: 'action not found' });
    return res.json({ ok: true, action_id: actionId });
  } catch (err) {
    console.error('setActionOwnersRaw error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.setActionOwnersRaw = setActionOwnersRaw;

// Helper: send calendar invite emails per recipient
async function sendCalendarInviteEmails(req, actionId, body) {
  const GMAIL_USER = 'support@robust-mcore.com';
  const GMAIL_APP_PASSWORD = 'mlkljfxmwrdkdoir';

  // Fetch action details
  const action = await getActionById(actionId);
  if (!action) return;

  // Get recommendation for action_title and objective
  let recommendation = null;
  if (action.action_type === 'category' && action.category_code && action.stage) {
    recommendation = await getRecommendationByCategoryAndStage(action.category_code, action.stage);
  } else if (action.action_type === 'question' && action.question_code && action.stage) {
    recommendation = await getQuestionPlanByCodeAndStage(action.question_code, action.stage);
  }

  const actionTitle = recommendation?.action_title || 'Action Review';
  const objective = recommendation?.why_it_matters || 'Confirm status, decisions and owners';

  // Parse invite data from body
  // invites format: "dd/mm/yy|HH:MM|email1,email2|Duration|Reminder|description"
  const invites = body.invites || '';
  const parts = invites.split('|');
  const date = parts[0] || '';
  const time = parts[1] || '';
  const emailsStr = parts[2] || '';
  const duration = parts[3] || '30 min';
  const reminder = parts[4] || '15 min';
  const description = parts[5] || '';
  
  const emails = emailsStr.split(',').map(e => e.trim()).filter(Boolean);
  if (emails.length === 0) return; // No recipients

  const senderEmail = action.email || '';
  const senderName = senderEmail.split('@')[0] || 'ChannelGuru';

  // Build action link
  // Prefer configured PUBLIC_APP_URL, fallback to request origin, then http://127.0.0.1:3000
  const publicUrl = process.env.PUBLIC_APP_URL && String(process.env.PUBLIC_APP_URL).trim();
  const reqOrigin = (req && req.headers && req.headers.origin) ? String(req.headers.origin) : '';
  const baseUrl = publicUrl || reqOrigin || 'http://127.0.0.1:3000';
  const actionLink = `${baseUrl.replace(/\/$/, '')}/next.html?email=${encodeURIComponent(action.email)}&select_action_id=${action.id}`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });

  // Parse date for display (dd/mm/yy format)
  let dateLocal = date || 'TBD';
  let timeLocal = 'TBD';
  let timezone = 'Your local time';
  let eventStart = null;
  let eventEnd = null;
  const parseDurationMinutes = (label) => {
    const s = String(label || '').toLowerCase();
    if (s.includes('1.5')) return 90;
    if (s.includes('4')) return 240;
    if (s.includes('3')) return 180;
    if (s.includes('2')) return 120;
    if (s.includes('1 hr') || s === '60 min') return 60;
    const m = s.match(/(\d+)\s*min/);
    if (m) return Number(m[1]);
    return 30;
  };
  const parseReminderMinutes = (label) => {
    const s = String(label || '').toLowerCase();
    const m = s.match(/(\d+)\s*min|^(\d+)\s*hr/);
    if (!m) return 15;
    if (m[1]) return Number(m[1]);
    if (m[2]) return Number(m[2]) * 60;
    return 15;
  };
  const durationMinutes = parseDurationMinutes(duration);
  const reminderMinutes = parseReminderMinutes(reminder);
  
  if (date && date.match(/^\d{2}\/\d{2}\/\d{2}$/)) {
    // Parse dd/mm/yy
    const [dd, mm, yy] = date.split('/');
    const fullYear = `20${yy}`;
    const dateObj = new Date(`${fullYear}-${mm}-${dd}`);
    if (!isNaN(dateObj.getTime())) {
      dateLocal = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (time && time.match(/^\d{2}:\d{2}$/)) {
        try {
          const [hh, min] = time.split(':');
          const dt = new Date(dateObj);
          dt.setHours(Number(hh), Number(min), 0, 0);
          timeLocal = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Your local time';
          eventStart = dt;
          eventEnd = new Date(dt.getTime() + durationMinutes * 60000);
        } catch {}
      }
    }
  }

  // Send one email per recipient
  for (const recipientEmail of emails) {
    const firstName = recipientEmail.split('@')[0] || 'there';
    const acknowledgeDirectLink = `${actionLink}&acknowledge=direct`;
    const acknowledgeViewLink = `${actionLink}&acknowledge=true`;

    const { subject, html } = actionReviewEmail({
      actionTitle,
      firstName,
      objective: objective.substring(0, 120), // one sentence
      dateLocal,
      timeLocal,
      timezone,
      duration,
      reminder,
      actionLink,
      acknowledgeDirectLink,
      acknowledgeViewLink,
      senderName,
      description
    });

    // Build ICS (iCalendar) content
    function formatICSDate(d) {
      const pad = (n) => String(n).padStart(2, '0');
      const y = d.getUTCFullYear();
      const m = pad(d.getUTCMonth() + 1);
      const day = pad(d.getUTCDate());
      const hh = pad(d.getUTCHours());
      const mmu = pad(d.getUTCMinutes());
      const ss = pad(d.getUTCSeconds());
      return `${y}${m}${day}T${hh}${mmu}${ss}Z`;
    }
    const now = new Date();
    const dtstamp = formatICSDate(now);
    const dtstart = eventStart ? formatICSDate(eventStart) : dtstamp;
    const dtend = eventEnd ? formatICSDate(eventEnd) : dtstamp;
    const uid = `action-${action.id}-${now.getTime()}@channelguru`;
    const summary = `Action Review: ${actionTitle}${description ? ' — ' + description.replace(/\r|\n/g, ' ') : ''}`;
    const descriptionText = `${description ? description + '\n\n' : ''}Action link: ${actionLink}`.replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'PRODID:-//ChannelGuru//Action Invite//EN',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${summary.replace(/\r|\n/g, ' ')}`,
      `DESCRIPTION:${descriptionText}`,
      `URL:${actionLink}`,
      `ORGANIZER;CN=${senderName}:MAILTO:${GMAIL_USER}`,
      `ATTENDEE;CN=${firstName};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${recipientEmail}`,
      'LOCATION:Online',
      'SEQUENCE:0',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'BEGIN:VALARM',
      `TRIGGER:-PT${Math.max(0, reminderMinutes)}M`,
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    await transporter.sendMail({
      from: GMAIL_USER,
      to: recipientEmail,
      subject,
      html,
      icalEvent: {
        method: 'REQUEST',
        content: ics
      },
      attachments: [
        {
          filename: 'invite.ics',
          content: ics,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST'
        }
      ]
    });
  }
}

// setActionInvites: PUT /api/v1/setActionInvites?action_id=
async function setActionInvitesApi(req, res) {
  try {
    const actionId = Number(req.query && req.query.action_id);
    if (!Number.isInteger(actionId)) return res.status(400).json({ error: 'action_id must be an integer' });
    const body = req.body || {};
    const invites = typeof body.invites === 'string' ? body.invites : '';
    const ok = await setActionInvites(actionId, invites);
    if (!ok) return res.status(404).json({ error: 'action not found' });
    try {
      const ts = new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      await appendActionLog(actionId, `${ts}: Calendar invite recorded (${invites})`);
    } catch {}

    // Send calendar invite emails
    try {
      await sendCalendarInviteEmails(req, actionId, body);
    } catch (emailErr) {
      console.error('sendCalendarInviteEmails error:', emailErr);
      // Don't fail the request if email fails
    }

    return res.json({ ok: true, action_id: actionId });
  } catch (err) {
    console.error('setActionInvites error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.setActionInvitesApi = setActionInvitesApi;

// requestResourcesEmail: POST /api/v1/requestResources
async function requestResourcesEmail(req, res) {
  try {
    const GMAIL_USER = 'support@robust-mcore.com';
    const GMAIL_APP_PASSWORD = 'mlkljfxmwrdkdoir';
    const body = req.body || {};
    const toEmail = 'support@robust-mcore.com';
    const fromEmail = (GMAIL_USER ? String(GMAIL_USER) : '').trim();
    const requesterEmail = body && body.email ? String(body.email).trim() : '';
    const questionCode = body && body.question_code ? String(body.question_code) : '';
    const questionText = body && body.question_text ? String(body.question_text) : '';
    const stage = Number(body && body.stage);
    const message = body && body.message ? String(body.message) : '';
    if (!fromEmail) return res.status(500).json({ error: 'mail not configured' });

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
    const html = `
      <div>
        <p>There are no resources available for instant download — request resources and we’ll send them to you soon.</p>
        <p><strong>Question:</strong> ${questionCode} — ${questionText}</p>
        <p><strong>Stage:</strong> ${Number.isFinite(stage) ? stage : '—'}</p>
        ${requesterEmail ? `<p><strong>User email:</strong> ${requesterEmail}</p>` : ''}
        ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
      </div>
    `;
    await transporter.sendMail({ from: fromEmail, to: toEmail, replyTo: requesterEmail || fromEmail, subject: `Request Resources: ${questionCode} (Stage ${Number.isFinite(stage) ? stage : '—'})`, html });
    return res.json({ ok: true });
  } catch (err) {
    console.error('requestResourcesEmail error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.requestResourcesEmail = requestResourcesEmail;
// Benchmarking: GET /api/v1/benchmark/user_totals?size_range=MIN-MAX&country=US
async function benchmarkUserTotals(req, res) {
  try {
    const sizeRange = req.query && req.query.size_range ? String(req.query.size_range).trim() : '';
    const country = req.query && req.query.country ? String(req.query.country).trim() : '';

    let minSize = null;
    let maxSize = null;
    if (sizeRange) {
      const m = sizeRange.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) return res.status(400).json({ error: 'invalid size_range, expected MIN-MAX' });
      minSize = Number(m[1]);
      maxSize = Number(m[2]);
      if (!Number.isInteger(minSize) || !Number.isInteger(maxSize) || minSize > maxSize) {
        return res.status(400).json({ error: 'invalid size_range values' });
      }
    }

    const base = `WITH latest_per_assessment AS (
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
  ON p.email = l.email`;

    const where = ['l.rn = 1'];
    const params = [];
    if (minSize !== null && maxSize !== null) {
      where.push('CAST(p.size AS UNSIGNED) BETWEEN ? AND ?');
      params.push(minSize, maxSize);
    }
    if (country) {
      where.push('p.country = ?');
      params.push(country);
    }

    const sql = `${base}
WHERE ${where.join(' AND ')}
GROUP BY l.email
ORDER BY l.email`;

    const [rows] = await db.query(sql, params);
    return res.json({ items: rows });
  } catch (err) {
    console.error('benchmarkUserTotals error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.benchmarkUserTotals = benchmarkUserTotals;

// Benchmarking: GET /api/v1/benchmark/countries
async function benchmarkCountries(req, res) {
  try {
    const [rows] = await db.query("SELECT DISTINCT country FROM profile WHERE country IS NOT NULL AND country <> '' ORDER BY country");
    const countries = rows.map(r => r.country).filter(Boolean);
    return res.json({ countries });
  } catch (err) {
    console.error('benchmarkCountries error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.benchmarkCountries = benchmarkCountries;

// Benchmarking (aggregate): GET /api/v1/benchmark/user_totals_avg?size_range=MIN-MAX&country=US
async function benchmarkUserTotalsAverage(req, res) {
  try {
    const sizeRange = req.query && req.query.size_range ? String(req.query.size_range).trim() : '';
    const country = req.query && req.query.country ? String(req.query.country).trim() : '';

    let minSize = null;
    let maxSize = null;
    if (sizeRange) {
      const m = sizeRange.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) return res.status(400).json({ error: 'invalid size_range, expected MIN-MAX' });
      minSize = Number(m[1]);
      maxSize = Number(m[2]);
      if (!Number.isInteger(minSize) || !Number.isInteger(maxSize) || minSize > maxSize) {
        return res.status(400).json({ error: 'invalid size_range values' });
      }
    }

    const base = `WITH latest_per_assessment AS (
  SELECT
    s.email,
    s.assessment_id,
    s.total_percent,
    ROW_NUMBER() OVER (
      PARTITION BY s.email, s.assessment_id
      ORDER BY s.finished_at DESC, s.id DESC
    ) AS rn
  FROM submissions s
),
user_totals AS (
  SELECT
    l.email,
    AVG(l.total_percent) AS user_total_percent
  FROM latest_per_assessment l
  WHERE l.rn = 1
  GROUP BY l.email
),
filtered_users AS (
  SELECT ut.user_total_percent,
         CASE
           WHEN p.size IS NOT NULL AND p.size <> '' AND p.managers_beyond_ceo IS NOT NULL
           THEN p.managers_beyond_ceo / CAST(p.size AS UNSIGNED)
           ELSE NULL
         END AS mef
  FROM user_totals ut
  JOIN profile p ON p.email = ut.email`;

    const where = [];
    const params = [];
    if (minSize !== null && maxSize !== null) {
      where.push('CAST(p.size AS UNSIGNED) BETWEEN ? AND ?');
      params.push(minSize, maxSize);
    }
    if (country) {
      where.push('p.country = ?');
      params.push(country);
    }

    const sql = `${base}${where.length ? `\n  WHERE ${where.join(' AND ')}` : ''}
)
SELECT
  ROUND(AVG(user_total_percent), 2) AS avg_total_score_percent,
  ROUND(AVG(mef), 3) AS avg_mef,
  COUNT(*) AS users_count
FROM filtered_users`;

    const [rows] = await db.query(sql, params);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : { avg_total_score_percent: null, avg_mef: null, users_count: 0 };
    return res.json(row);
  } catch (err) {
    console.error('benchmarkUserTotalsAverage error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.benchmarkUserTotalsAverage = benchmarkUserTotalsAverage;

// Benchmarking (aggregate per assessment): GET /api/v1/benchmark/user_totals_avg_per_assessment?size_range=MIN-MAX&country=US
async function benchmarkUserTotalsAveragePerAssessment(req, res) {
  try {
    const sizeRange = req.query && req.query.size_range ? String(req.query.size_range).trim() : '';
    const country = req.query && req.query.country ? String(req.query.country).trim() : '';

    let minSize = null;
    let maxSize = null;
    if (sizeRange) {
      const m = sizeRange.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) return res.status(400).json({ error: 'invalid size_range, expected MIN-MAX' });
      minSize = Number(m[1]);
      maxSize = Number(m[2]);
      if (!Number.isInteger(minSize) || !Number.isInteger(maxSize) || minSize > maxSize) {
        return res.status(400).json({ error: 'invalid size_range values' });
      }
    }

    const base = `WITH latest_per_assessment AS (
  SELECT
    s.email,
    s.assessment_id,
    s.total_percent,
    ROW_NUMBER() OVER (
      PARTITION BY s.email, s.assessment_id
      ORDER BY s.finished_at DESC, s.id DESC
    ) AS rn
  FROM submissions s
),
filtered AS (
  SELECT
    l.email,
    l.assessment_id,
    l.total_percent
  FROM latest_per_assessment l
  LEFT JOIN profile p
    ON p.email = l.email
  WHERE l.rn = 1`;

    const where = [];
    const params = [];
    if (minSize !== null && maxSize !== null) {
      where.push('CAST(p.size AS UNSIGNED) BETWEEN ? AND ?');
      params.push(minSize, maxSize);
    }
    if (country) {
      where.push('p.country = ?');
      params.push(country);
    }

    const sql = `${base}${where.length ? `\n    AND ${where.join(' AND ')}` : ''}
)
SELECT
  assessment_id,
  ROUND(AVG(total_percent)) AS avg_total_score_percent,
  COUNT(*)                  AS users_count
FROM filtered
GROUP BY assessment_id
ORDER BY CAST(assessment_id AS UNSIGNED)`;

    const [rows] = await db.query(sql, params);
    return res.json({ items: rows });
  } catch (err) {
    console.error('benchmarkUserTotalsAveragePerAssessment error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.benchmarkUserTotalsAveragePerAssessment = benchmarkUserTotalsAveragePerAssessment;

// Benchmarking per assessment: GET /api/v1/benchmark/assessment_avgs?size_range=MIN-MAX&country=US
async function benchmarkAssessmentAverages(req, res) {
  try {
    const sizeRange = req.query && req.query.size_range ? String(req.query.size_range).trim() : '';
    const country = req.query && req.query.country ? String(req.query.country).trim() : '';

    let minSize = null;
    let maxSize = null;
    if (sizeRange) {
      const m = sizeRange.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) return res.status(400).json({ error: 'invalid size_range, expected MIN-MAX' });
      minSize = Number(m[1]);
      maxSize = Number(m[2]);
      if (!Number.isInteger(minSize) || !Number.isInteger(maxSize) || minSize > maxSize) {
        return res.status(400).json({ error: 'invalid size_range values' });
      }
    }

    const base = `WITH latest_per_assessment AS (
  SELECT
    s.email,
    s.assessment_id,
    s.total_percent,
    ROW_NUMBER() OVER (
      PARTITION BY s.email, s.assessment_id
      ORDER BY s.finished_at DESC, s.id DESC
    ) AS rn
  FROM submissions s
),
filtered AS (
  SELECT
    l.email,
    l.assessment_id,
    l.total_percent
  FROM latest_per_assessment l
  LEFT JOIN profile p
    ON p.email = l.email`;

    const where = ['l.rn = 1'];
    const params = [];
    if (minSize !== null && maxSize !== null) {
      where.push('CAST(p.size AS UNSIGNED) BETWEEN ? AND ?');
      params.push(minSize, maxSize);
    }
    if (country) {
      where.push('p.country = ?');
      params.push(country);
    }

    const sql = `${base}
  WHERE ${where.join(' AND ')}
)
SELECT
  assessment_id,
  ROUND(AVG(total_percent)) AS avg_total_score_percent,
  COUNT(*) AS users_count
FROM filtered
GROUP BY assessment_id
ORDER BY CAST(assessment_id AS UNSIGNED)`;

    const [rows] = await db.query(sql, params);
    return res.json({ items: rows });
  } catch (err) {
    console.error('benchmarkAssessmentAverages error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.benchmarkAssessmentAverages = benchmarkAssessmentAverages;

// Benchmarking MEF: GET /api/v1/benchmark/mef_avg?size_range=MIN-MAX&country=US
async function benchmarkMEFAverage(req, res) {
  try {
    const sizeRange = req.query && req.query.size_range ? String(req.query.size_range).trim() : '';
    const country = req.query && req.query.country ? String(req.query.country).trim() : '';

    let minSize = null;
    let maxSize = null;
    if (sizeRange) {
      const m = sizeRange.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) return res.status(400).json({ error: 'invalid size_range, expected MIN-MAX' });
      minSize = Number(m[1]);
      maxSize = Number(m[2]);
      if (!Number.isInteger(minSize) || !Number.isInteger(maxSize) || minSize > maxSize) {
        return res.status(400).json({ error: 'invalid size_range values' });
      }
    }

    const where = [];
    const params = [];
    if (minSize !== null && maxSize !== null) {
      where.push('CAST(size AS UNSIGNED) BETWEEN ? AND ?');
      params.push(minSize, maxSize);
    }
    if (country) {
      where.push('country = ?');
      params.push(country);
    }
    const sql = `SELECT ROUND(AVG(CASE WHEN size IS NOT NULL AND size <> '' AND managers_beyond_ceo IS NOT NULL THEN managers_beyond_ceo / CAST(size AS UNSIGNED) END), 3) AS avg_mef,
                        COUNT(*) AS users_count
                 FROM profile${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const [rows] = await db.query(sql, params);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : { avg_mef: null, users_count: 0 };
    return res.json(row);
  } catch (err) {
    console.error('benchmarkMEFAverage error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports.benchmarkMEFAverage = benchmarkMEFAverage;