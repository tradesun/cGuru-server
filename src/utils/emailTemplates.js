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

function assignmentEmail({ actionTitle, status, link, assigneeEmail, assignerName }) {
  const safeTitle = escapeHtml(actionTitle || 'Action assigned to you');
  const safeStatus = escapeHtml(status || 'Assigned');
  const safeAssignee = escapeHtml(assigneeEmail || '');
  const safeAssigner = escapeHtml(assignerName || 'ChannelGuru');
  const safeLink = link ? String(link) : '';

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
                <div style="opacity:.9;font-size:13px;margin-top:4px;">${safeAssigner} assigned an action${safeAssignee ? ` to ${safeAssignee}` : ''}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h2 style="margin:0 0 8px 0;font-size:16px;color:#0F172A;">${safeTitle}</h2>
                <p style="margin:0 0 12px 0;font-size:14px;">Status: <strong>${safeStatus}</strong></p>
                ${safeLink ? `<p style="margin:0 0 16px 0;font-size:14px;">Open the action page:</p>
                <p style="margin:0 0 20px 0;"><a href="${safeLink}" style="display:inline-block;background:#0077FF;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">View in ChannelGuru</a></p>
                <p style="margin:0 0 6px 0;font-size:12px;color:#475569;">Or copy this link:</p>
                <p style="margin:0 0 16px 0;font-size:12px;color:#0F172A;word-break:break-all;">${safeLink}</p>` : ''}
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

module.exports = { assignmentEmail };


