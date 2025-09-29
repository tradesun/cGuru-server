// utils/payloadWriter.js
// Writes the raw webhook JSON (plus assessment_id) to local and remote submission directories.
const fs = require('fs');
const path = require('path');

// writeSubmissionFiles: persist one file per submission named by external_id
function writeSubmissionFiles(externalId, rawBuffer, assessmentId) {
  const targets = [
    { dir: 'C:\\code\\cGuru-server\\submission' },
    { dir: '/home/ubuntu/submission' }
  ];

  let contentString;
  try {
    const rawString = rawBuffer ? rawBuffer.toString('utf8') : '{}';
    let obj;
    try {
      obj = JSON.parse(rawString);
    } catch (e) {
      obj = { raw: rawString };
    }
    obj.assessment_id = assessmentId;
    contentString = JSON.stringify(obj);
  } catch (e) {
    contentString = JSON.stringify({ assessment_id: assessmentId });
  }

  for (const target of targets) {
    try {
      fs.mkdirSync(target.dir, { recursive: true });
      const filePath = path.join(target.dir, `${externalId}.json`);
      fs.writeFile(filePath, contentString, (err) => {
        if (err) {
          // Best-effort only; log but do not throw
          console.error('Failed to write submission file:', filePath, err);
        }
      });
    } catch (e) {
      // ignore directory errors
    }
  }
}

module.exports = { writeSubmissionFiles };


