(function(){
  function ensureToastContainer() {
    let c = document.getElementById('toastContainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toastContainer';
      c.style.position = 'fixed';
      c.style.top = '16px';
      c.style.right = '16px';
      c.style.zIndex = '9999';
      c.style.display = 'flex';
      c.style.flexDirection = 'column';
      c.style.gap = '8px';
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(message, type) {
    const c = ensureToastContainer();
    const t = document.createElement('div');
    t.style.padding = '10px 14px';
    t.style.borderRadius = '10px';
    t.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)';
    t.style.color = '#fff';
    t.style.fontSize = '14px';
    t.style.display = 'flex';
    t.style.alignItems = 'center';
    t.style.gap = '8px';
    t.style.background = type === 'error' ? '#DC2626' : (type === 'warning' ? '#D97706' : '#16A34A');
    t.textContent = message;
    c.appendChild(t);
    setTimeout(()=>{ t.style.transition='opacity 200ms ease'; t.style.opacity='0'; setTimeout(()=>t.remove(), 220); }, 2200);
  }

  function showRequestResourcesModal(opts) {
    const email = (opts && opts.email) || '';
    const questionCode = (opts && opts.question_code) || '';
    const questionText = (opts && opts.question_text) || '';
    const stage = (opts && (opts.stage || opts.stage === 0)) ? Number(opts.stage) : null;

    let modal = document.getElementById('requestResourcesModal');
    if (modal) { try { modal.remove(); } catch {} }
    modal = document.createElement('div');
    modal.id = 'requestResourcesModal';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(0,0,0,0.4)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
      <div class="rounded-xl bg-white shadow-lg" style="width: 520px; max-width: 92%; border: 1px solid #E5E7EB;">
        <div class="px-4 py-3 border-b" style="border-color:#E5E7EB"><div class="text-sm font-semibold">Request Resources</div></div>
        <div class="p-4 space-y-3 text-sm">
          <div class="text-slate-700">There are no resources available for instant download — request resources and we’ll send them to you soon.</div>
          <div><span class="font-medium">Question:</span> <span id="rr_qcode"></span> — <span id="rr_qtext"></span></div>
          <div><span class="font-medium">Stage:</span> <span id="rr_stage"></span></div>
          <div>
            <label class="block text-slate-600 mb-1">Message (optional)</label>
            <textarea id="rr_message" class="w-full rounded-xl border p-2" rows="3" style="border-color:#E5E7EB"></textarea>
          </div>
        </div>
        <div class="px-4 py-3 border-t flex justify-end gap-2" style="border-color:#E5E7EB">
          <button id="rr_cancel" class="button-secondary">Cancel</button>
          <button id="rr_send" class="button-primary">Send Request</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    // Fill
    const qtextEl = modal.querySelector('#rr_qtext');
    const qcodeEl = modal.querySelector('#rr_qcode');
    const stEl = modal.querySelector('#rr_stage');
    if (qtextEl) qtextEl.textContent = questionText || '';
    if (qcodeEl) qcodeEl.textContent = questionCode || '';
    if (stEl) stEl.textContent = Number.isFinite(stage) ? String(stage) : '—';

    const close = () => { try { modal.remove(); } catch {} };
    const cancelBtn = modal.querySelector('#rr_cancel');
    const sendBtn = modal.querySelector('#rr_send');
    const msgEl = modal.querySelector('#rr_message');
    if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.preventDefault(); close(); });
    if (sendBtn) {
      sendBtn.onclick = async () => {
        try {
          sendBtn.disabled = true; sendBtn.style.opacity = '0.7'; sendBtn.textContent = 'Sending…'; sendBtn.style.cursor = 'not-allowed';
          const payload = { email, question_code: questionCode, question_text: questionText, stage, message: msgEl ? msgEl.value : '' };
          const resp = await fetch('/api/v1/requestResources', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) });
          if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(t || `Failed (${resp.status})`);
          }
          close();
          showToast("Request sent. We'll email you soon.", 'success');
        } catch (e) {
          close();
          showToast('Failed to send request', 'error');
        }
      };
    }
  }

  window.UI = { showToast, showRequestResourcesModal };
})();


