// controllers/webhook.controller.js
// Handles webhook ingestion end-to-end using ingest repository.
const { normalize } = require('../score.service');
const { saveAll } = require('../repositories/ingest.repository');
const { writeSubmissionFiles } = require('../utils/payloadWriter');

// processSubmission: shared logic to normalize, persist, and write files
async function processSubmission(payload, assessmentId, rawBodyBuffer) {
  const normalized = normalize(payload || {}, assessmentId);
  const submissionId = await saveAll(normalized);
  try {
    await writeSubmissionFiles(normalized.submission.externalId, rawBodyBuffer, assessmentId);
  } catch (e) {
    console.error('writeSubmissionFiles failed:', e);
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


