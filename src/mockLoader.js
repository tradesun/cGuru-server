// mockLoader.js
// Loads mock submission JSON files and processes them via the shared submission pipeline.
const fs = require('fs');
const path = require('path');
const { processSubmission } = require('./controllers/webhook.controller');

async function loadMockSubmissionsIfEnabled(enabled) {
  if (!enabled) return;

  const dir = 'C:\\code\\cGuru-server\\mockup_submission';
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch (e) {
    console.error('Mock directory not found or unreadable:', dir, e.message);
    return;
  }

  for (const file of files) {
    try {
      const full = path.join(dir, file);
      const raw = fs.readFileSync(full);
      const json = JSON.parse(raw.toString('utf8'));
      const externalId = path.basename(file, '.json');
      // Prefer provided assessment_id inside mock; fallback to empty
      const assessmentId = json.assessment_id || '';
      await processSubmission(json, assessmentId, raw);
      console.log('Processed mock submission:', externalId);
    } catch (e) {
      console.error('Failed to process mock file:', file, e.message);
    }
  }
}

module.exports = { loadMockSubmissionsIfEnabled };


