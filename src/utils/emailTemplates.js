// utils/emailTemplates.js
// Temporary email templates used by mailer endpoints.

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function assignmentEmail({ actionTitle, status, link, assigneeEmail, assignerName, assignerEmail, whyItMatters, acknowledgeDirectLink, acknowledgeViewLink }) {
  const safeTitle = escapeHtml(actionTitle || 'Action assigned to you');
  const safeStatus = escapeHtml(status || 'Assigned');
  const safeAssignee = escapeHtml(assigneeEmail || '');
  const safeAssigner = escapeHtml(assignerName || 'ChannelGuru');
  const safeAssignerEmail = escapeHtml(assignerEmail || '');
  const safeLink = link ? String(link) : '';
  const ackDirect = acknowledgeDirectLink ? String(acknowledgeDirectLink) : safeLink;
  const ackView = acknowledgeViewLink ? String(acknowledgeViewLink) : safeLink;
  const safeWhy = escapeHtml(whyItMatters || '');

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#F8FAFC;font-family:Segoe UI,Arial,sans-serif;color:#0F172A;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F8FAFC;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(135deg,#00A8A8 0%, #0077FF 100%);color:#ffffff;">
                <h1 style="margin:0;font-size:18px;">New Assignment</h1>
                <div style="opacity:.9;font-size:18px;margin-top:4px;">An action was assigned to you by ${safeAssigner}${safeAssignerEmail ? ` (<span class="ty55" style=\"color:#fff\">${safeAssignerEmail}</span>)` : ''} on Channel Guru</div>
              </td>
              <style>
                .ty55 a {
                  color: #fff !important;
                }
              </style>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h2 style="margin:0 0 8px 0;font-size:16px;color:#0F172A;">${safeTitle}</h2>
                <p style="margin:0 0 12px 0;font-size:14px;">Status: <strong>${safeStatus}</strong></p>
                ${safeWhy ? `<p style="margin:0 0 12px 0;font-size:14px;"><strong>Why it matters:</strong> ${safeWhy}</p>` : ''}
                <p style="margin:0 0 12px 0;font-size:15px;color:#0F172A;">Please click Acknowledge to confirm ownership of the task.</p>
                ${ackDirect ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px 0;">
                  <tr>
                    <td style="padding-right:10px;">
                      <a href="${ackDirect}" style="display:inline-block;background:#16A34A;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:14px;">Acknowledge Ownership</a>
                    </td>
                    ${ackView ? `<td>
                      <a href="${ackView}" style="display:inline-block;background:#0F172A;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:14px;">View Action</a>
                    </td>` : ''}
                  </tr>
                </table>` : ''}
                ${safeLink ? `<p style="margin:0 0 16px 0;font-size:12px;color:#475569;">Action link:<br/><span style="word-break:break-all;color:#0F172A;">${escapeHtml(safeLink)}</span></p>` : ''}
                <p style="margin:0;font-size:13px;color:#475569;">Thanks,<br/>${safeAssigner}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px;background:#F8FAFC;border-top:1px solid #E5E7EB;color:#64748B;font-size:11px;">
                This is a temporary notification template.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function actionReviewEmail({
  actionTitle,
  firstName,
  objective,
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
}) {
  const safe = (s) => escapeHtml(s || '');
  const title = safe(actionTitle || 'Action Review');
  const subject = `Action Review: ${title}`;
  const hi = safe(firstName || 'there');
  const objectiveText = safe(objective || 'Confirm status, decisions and owners');
  const when = `${safe(dateLocal || '')} at ${safe(timeLocal || '')} (${safe(timezone || '')})`;
  const dur = safe(duration || '30 min');
  const rem = safe(reminder || '15 min');
  const link = actionLink ? String(actionLink) : '';
  const ackDirect = acknowledgeDirectLink ? String(acknowledgeDirectLink) : link;
  const ackView = acknowledgeViewLink ? String(acknowledgeViewLink) : link;
  const sender = safe(senderName || 'ChannelGuru');
  const desc = safe(description || '');

  return {
    subject,
    html: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#F8FAFC;font-family:Segoe UI,Arial,sans-serif;color:#0F172A;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F8FAFC;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(135deg,#00A8A8 0%, #0077FF 100%);color:#ffffff;">
                <h1 style="margin:0;font-size:18px;">Action Review: ${title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 8px 0;font-size:14px;">Hi ${hi},</p>
                <p style="margin:0 0 14px 0;font-size:14px;">I’d like to schedule a short review to align on the following action:</p>

                <p style="margin:0 0 6px 0;font-size:14px;"><strong>Action:</strong> ${title}</p>
                <p style="margin:0 0 14px 0;font-size:14px;"><strong>Objective:</strong> ${objectiveText}</p>
                <p style="margin:0 0 4px 0;font-size:14px;"><strong>When:</strong> ${when}</p>
                <p style="margin:0 0 4px 0;font-size:14px;"><strong>Duration:</strong> ${dur}</p>
                <p style="margin:0 0 16px 0;font-size:14px;"><strong>Reminder:</strong> ${rem}</p>

                ${desc ? `<p style="margin:0 0 16px 0;font-size:14px;"><strong>Description:</strong> ${desc}</p>` : ''}

                ${ackView ? `<p style="margin:8px 0 6px 0;"><a href="${ackView}" style="display:inline-block;background:#0F172A;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:14px;">View Action</a></p>
                <p style="margin:22px 0 18px 0;font-size:17px;color:#334155;font-weight:700;">Download the attachment to add this event to your calendar.</p>` : ''}

                ${link ? `<p style="margin:0 0 16px 0;font-size:12px;color:#475569;">Action link:<br/><span style="word-break:break-all;color:#0F172A;">${escapeHtml(link)}</span></p>` : ''}

                <p style="margin:0;font-size:13px;color:#475569;">Thanks,<br/>${sender}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px;background:#F8FAFC;border-top:1px solid #E5E7EB;color:#64748B;font-size:11px;">Times shown in your locale. Your calendar client will adjust notification timing based on your settings.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
  };
}

module.exports = { assignmentEmail, actionReviewEmail };


