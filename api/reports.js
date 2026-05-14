// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Reports & Export endpoint. Renders the brief snapshot
// to a one-page landscape PDF via headless Chromium, uploads to Supabase
// Storage, and returns a signed read URL. GET lists past reports.
// ═════════════════════════════════════════════════════════════════════════
//
//   GET  /api/reports                    → list past reports + signed URLs
//   POST /api/reports                    → generate a new on-demand report
//   POST /api/reports  {action:'email'}  → also email the PDF to the caller
//   DELETE /api/reports?id=<reportId>    → delete a report + its PDF

import { authenticate, json, trialLockoutEnvelope } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { renderReportHTML } from './_lib/report-template.js';
import { renderPdfFromHtml } from './_lib/pdf.js';
import { uploadFile, createSignedUrl, removeFile } from './_lib/storage.js';
import { sendEmail } from './_lib/email.js';

const BUCKET = 'reports';
const URL_TTL = 7 * 24 * 3600; // 7 days

// Build the brief envelope we feed into the report template. This mirrors
// the shape /api/brief returns to the SPA — same fields, same priorities —
// so the PDF stays in sync with what the user sees on screen.
async function gatherBriefForWorkspace(ws) {
  const signals = await supabase.select('signals', {
    select: '*', eq: { workspace_id: ws.id }, order: 'generated_at.desc', limit: 30,
  }).catch(() => []);

  const verdictRow = (signals || []).find(s => s.kind === 'verdict' && !s.is_read);
  const actionRows = (signals || [])
    .filter(s => s.kind === 'action' && !s.is_read)
    .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
  const signalRows = (signals || [])
    .filter(s => s.kind !== 'verdict' && s.kind !== 'action' && !s.is_read)
    .slice(0, 6);

  const verdict = verdictRow ? {
    title: verdictRow.title, body: verdictRow.body,
    score_factors: verdictRow.metadata?.score_factors || [],
  } : null;

  const actionPlan = actionRows.map((a, i) => ({
    id: `a${i + 1}`, when: a.metadata?.when || a.impact || 'Today',
    icon: a.metadata?.icon || 'sparkle',
    title: a.title, body: a.body, cta: a.action,
  }));

  const formula = verdictRow?.metadata?.formula || null;
  const intelScore = verdictRow?.metadata?.intel_score || null;

  // Competitors — pull latest follower count per row for the reach scorecard.
  const competitors = await supabase.select('competitors', {
    select: 'id,handle,display_name,platform,followers',
    eq: { workspace_id: ws.id, is_active: true },
  }).catch(() => []);

  return {
    verdict,
    actionPlan,
    signals: signalRows.map(s => ({
      kind: s.kind, label: s.kind, title: s.title, body: s.body,
    })),
    formula,
    intelScore,
    competitors: (competitors || []).map(c => ({
      handle: c.handle, display_name: c.display_name, platform: c.platform,
      latest: c.followers,
    })),
  };
}

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // ── List mode ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const rows = await supabase.select('reports', {
      select: 'id,kind,period,pdf_path,summary,status,error,generated_at,emailed_at',
      eq: { workspace_id: ws.id },
      order: 'generated_at.desc',
      limit: 50,
    }).catch(() => []);

    // Hand the client signed URLs for each ready report.
    const out = await Promise.all((rows || []).map(async r => {
      let url = null;
      if (r.status === 'ready' && r.pdf_path) {
        try { url = await createSignedUrl(BUCKET, r.pdf_path, URL_TTL); }
        catch { url = null; }
      }
      return { ...r, signed_url: url };
    }));
    return json(res, 200, { reports: out });
  }

  // ── Generate mode ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    // Reports (PDF + email) are a paid feature. Refuse trial workspaces
    // — locked or not — with a clear upgrade message. We allow GET so
    // the empty list renders cleanly with the upgrade copy.
    if (ws.trial_active || ws.trial_locked) {
      return json(res, 402, {
        error: 'PDF reports unlock after you upgrade from the trial.',
        trial: true,
        trial_locked: !!ws.trial_locked,
      });
    }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const wantsEmail = body?.action === 'email';
    const recipientEmail = wantsEmail ? (body?.email || auth.user?.email) : null;

    let reportRow = null;
    try {
      // 1. Insert pending row so the UI can show "rendering" state.
      const today = new Date();
      const period = (() => {
        const end = today;
        const start = new Date(end);
        start.setDate(start.getDate() - 7);
        const fmt = (d) => d.toISOString().slice(0, 10);
        return `${fmt(start)} → ${fmt(end)}`;
      })();
      const inserted = await supabase.insert('reports', {
        workspace_id: ws.id,
        kind: 'on_demand',
        period,
        status: 'rendering',
      });
      reportRow = inserted?.[0];
      if (!reportRow) throw new Error('Failed to create report row');

      // 2. Build brief, render HTML, generate PDF.
      const brief = await gatherBriefForWorkspace(ws);
      const html = renderReportHTML({
        workspace: { name: ws.name },
        brief,
        generatedAt: new Date().toISOString(),
      });
      const pdf = await renderPdfFromHtml(html, { format: 'A4', landscape: true });

      // 3. Upload to Supabase Storage.
      const path = `${ws.id}/${reportRow.id}.pdf`;
      await uploadFile(BUCKET, path, pdf, { contentType: 'application/pdf' });

      // 4. Update row: status=ready + pdf_path + cached summary.
      const summary = {
        verdict_title: brief.verdict?.title || null,
        actions: brief.actionPlan?.length || 0,
        signals: brief.signals?.length || 0,
        intel_score: brief.intelScore || null,
      };
      await supabase.update('reports',
        { status: 'ready', pdf_path: path, summary },
        { eq: { id: reportRow.id } }
      );

      // 5. Signed URL for the response.
      const signedUrl = await createSignedUrl(BUCKET, path, URL_TTL);

      // 6. Optional email delivery.
      let emailResult = null;
      if (wantsEmail && recipientEmail) {
        try {
          const filename = `pulse-report-${period.replace(/\s.→\s./g, '_to_')}.pdf`;
          await sendEmail({
            to: recipientEmail,
            subject: `Your Mashal brief · ${ws.name}`,
            html: `<p>Hi,</p><p>Your latest Mashal intelligence brief is attached.</p>
                   <p><strong>${summary.verdict_title || 'Brief generated'}</strong></p>
                   <p>${summary.actions} prioritised action${summary.actions === 1 ? '' : 's'}
                      · ${summary.signals} signal${summary.signals === 1 ? '' : 's'}
                      ${summary.intel_score ? `· Intel score ${summary.intel_score}/100` : ''}</p>
                   <p style="color:#888;font-size:12px;">— Mashal · mashal.app</p>`,
            text: `Your Mashal brief: ${summary.verdict_title || 'Brief generated'}\n\n— Mashal`,
            attachments: [{ filename, content: Buffer.from(pdf) }],
          });
          await supabase.update('reports', { emailed_at: new Date().toISOString() }, { eq: { id: reportRow.id } });
          emailResult = { sent: true, to: recipientEmail };
        } catch (e) {
          emailResult = { sent: false, error: e.message };
        }
      }

      return json(res, 200, {
        ok: true,
        report: {
          id: reportRow.id,
          period,
          pdf_path: path,
          signed_url: signedUrl,
          summary,
          status: 'ready',
        },
        email: emailResult,
      });
    } catch (e) {
      // Mark the row failed so the UI can show the error and offer retry.
      if (reportRow) {
        await supabase.update('reports',
          { status: 'failed', error: e.message },
          { eq: { id: reportRow.id } }
        ).catch(() => {});
      }
      return json(res, 500, { error: 'report_failed', message: e.message });
    }
  }

  // ── Delete mode ──────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id) return json(res, 400, { error: 'id required' });
    const row = await supabase.select('reports', {
      select: 'id,workspace_id,pdf_path', eq: { id, workspace_id: ws.id }, single: true,
    }).catch(() => null);
    if (!row) return json(res, 404, { error: 'Report not found' });
    if (row.pdf_path) await removeFile(BUCKET, row.pdf_path).catch(() => {});
    await supabase.delete('reports', { eq: { id } });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
