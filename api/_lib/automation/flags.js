// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — kill switch.
// ═════════════════════════════════════════════════════════════════════════
//
// The engine ships DORMANT. P0 is the runtime foundation only: the tables,
// the interpreter, the worker, and a flag-gated webhook seam. It must NOT
// fire while Zernio's hosted comment-automations are still live, or a single
// keyword comment would get answered twice (once by Zernio, once by us).
//
// Flip AUTOMATION_ENGINE=1 in the Vercel env only after the controlled
// cutover (migrate comment_automations → automation_flows AND disable their
// Zernio twins in the same pass). Until then every entry point below returns
// early, so deploying this code changes nothing about production behavior.
//
// A per-workspace override lives on the workspace row later (P4+); for now the
// single global switch is enough and keeps the blast radius to one env var.

export function engineEnabled() {
  const v = String(process.env.AUTOMATION_ENGINE || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

export default { engineEnabled };
