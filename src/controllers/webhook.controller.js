// controllers/webhook.controller.js
// Handles webhook ingestion end-to-end using ingest repository.
const { normalize } = require('../score.service');
const { saveAll } = require('../repositories/ingest.repository');
const { writeSubmissionFiles } = require('../utils/payloadWriter');
const { systemRecommendations } = require('./api.controller');

// processSubmission: shared logic to normalize, persist, and write files
async function processSubmission(payload, assessmentId, rawBodyBuffer) {
  const normalized = normalize(payload || {}, assessmentId);
  const submissionId = await saveAll(normalized);
  try {
    await writeSubmissionFiles(normalized.submission.externalId, rawBodyBuffer, assessmentId);
  } catch (e) {
    console.error('writeSubmissionFiles failed:', e);
  }
  // Trigger system recommendations generation for this user
  try {
    const email = normalized && normalized.submission && normalized.submission.email ? String(normalized.submission.email).toLowerCase().trim() : '';
    if (email) {
      // Call the same logic as the /systemRecommendations endpoint
      await systemRecommendations({ query: { email } }, { json: () => {}, status: () => ({ json: () => {} }) });
      console.log('[webhook] systemRecommendations triggered for', email);
    }
  } catch (e) {
    console.warn('[webhook] systemRecommendations trigger failed', e && e.message ? e.message : e);
  }
  return submissionId;
}

// ingest: handle POST /webhooks/add-score and persist incoming data
async function ingest(req, res) {
  try {
    const assessmentId = req.query && req.query.id ? req.query.id : '';
    const rawBodyBuffer = req.rawBody && req.rawBody.length ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
    const submissionId = await processSubmission(req.body || {}, assessmentId, rawBodyBuffer);
    return res.status(200).json({ ok: true, submission_id: submissionId });
  } catch (err) {
    console.error('Ingest error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = { ingest, processSubmission };


