// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] HTML template for the executive report PDF. Pure server
// render — no React, no client JS. Print-optimised stylesheet (A4, 14mm
// margins). Designed to fit the brief snapshot on a single landscape-A4
// page so the resulting PDF is a true one-page exec summary.
// ═════════════════════════════════════════════════════════════════════════

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtNum = (n) => {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

// Score-factor chips → simple inline classification (positive / negative / neutral)
function chipTone(text) {
  const s = String(text || '');
  if (/^(↓|⚠|↘|❌|✗|🔴)|down\b|below\b|weak\b|lag/i.test(s)) return 'neg';
  if (/^(↑|✓|✅|🟢|⬆)|up\b|above\b|strong\b|healthy\b|grow/i.test(s)) return 'pos';
  return 'neu';
}

// Bucket actions by `when` for the action plan section.
function bucketActions(actions) {
  const buckets = { now: [], today: [], week: [], month: [] };
  (actions || []).forEach(a => {
    const w = String(a.when || '').toLowerCase();
    const key = w.includes('now') ? 'now'
              : w.includes('today') ? 'today'
              : w.includes('month') ? 'month'
              : 'week';
    buckets[key].push(a);
  });
  return buckets;
}

export function renderReportHTML({ workspace, brief, generatedAt }) {
  const verdict = brief.verdict || {};
  const formula = brief.formula || null;
  const actions = brief.actionPlan || brief.todayActions || [];
  const buckets = bucketActions(actions);
  const signals = (brief.signals || []).slice(0, 6);
  const competitors = (brief.competitors || []).slice(0, 8);
  const intelScore = brief.intelScore || 0;
  const factors = (verdict.score_factors || []).slice(0, 4);
  const date = new Date(generatedAt || Date.now()).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PULSE Report · ${esc(workspace.name)} · ${esc(date)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  :root {
    --ink: #0A0A0B; --paper: #F8F6F2; --mute: #6B6B6B;
    --ultra: #4F46E5; --magenta: #FF2D6A; --lime: #BDFF00;
    --amber: #F59E0B; --emerald: #10B981;
    --line: rgba(0,0,0,.08);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: var(--ink); background: var(--paper); font-size: 11px;
    line-height: 1.4; -webkit-font-smoothing: antialiased;
  }
  .row { display: flex; gap: 12px; }
  .col { flex: 1; min-width: 0; }
  .card {
    background: white; border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 14px;
  }
  .card-dark { background: var(--ink); color: var(--paper); }
  .eyebrow {
    font-size: 8px; font-weight: 600; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--mute);
  }
  .eyebrow.ultra { color: var(--ultra); }
  .eyebrow.mag   { color: var(--magenta); }
  .eyebrow.lime  { color: #5b8800; }
  .eyebrow.amb   { color: #b87100; }

  header {
    display: flex; align-items: baseline; justify-content: space-between;
    padding-bottom: 10px; margin-bottom: 12px;
    border-bottom: 1.5px solid var(--ink);
  }
  .logo { font-weight: 800; letter-spacing: 0.16em; font-size: 14px; }
  .logo .dot { color: var(--magenta); }
  .meta { font-size: 9px; color: var(--mute); text-align: right; line-height: 1.5; }

  .verdict {
    background: var(--ink); color: var(--paper);
    border-radius: 12px; padding: 16px 18px; margin-bottom: 10px;
    display: flex; gap: 18px; align-items: stretch;
  }
  .verdict-main { flex: 1; }
  .verdict h1 {
    font-size: 18px; font-weight: 700; line-height: 1.2;
    letter-spacing: -0.01em; margin: 6px 0 6px;
  }
  .verdict p { font-size: 10px; color: rgba(248,246,242,.75); line-height: 1.5; }
  .score-pill {
    border-left: 1px solid rgba(248,246,242,.2); padding-left: 16px;
    display: flex; flex-direction: column; justify-content: center;
    min-width: 90px;
  }
  .score-pill .num {
    font-size: 32px; font-weight: 800; letter-spacing: -0.03em; line-height: 1;
  }
  .score-pill .lbl { font-size: 9px; color: rgba(248,246,242,.5); margin-top: 4px; }

  .chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
  .chip {
    font-size: 8.5px; padding: 2px 7px; border-radius: 99px;
    border: 1px solid rgba(248,246,242,.2);
    background: rgba(248,246,242,.06); color: rgba(248,246,242,.8);
  }
  .chip.pos { color: var(--lime); border-color: rgba(189,255,0,.3); background: rgba(189,255,0,.08); }
  .chip.neg { color: #ff85a8; border-color: rgba(255,45,106,.3); background: rgba(255,45,106,.08); }

  h2 {
    font-size: 11px; font-weight: 700; margin-bottom: 6px;
    text-transform: uppercase; letter-spacing: 0.08em;
  }

  .action {
    border-left: 3px solid var(--mute); padding: 6px 10px;
    background: rgba(0,0,0,.02); border-radius: 0 6px 6px 0;
    margin-bottom: 4px;
  }
  .action.now   { border-left-color: var(--magenta); }
  .action.today { border-left-color: var(--ultra); }
  .action.week  { border-left-color: var(--amber); }
  .action.month { border-left-color: var(--emerald); }
  .action .when {
    font-size: 7.5px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--mute); margin-bottom: 2px;
  }
  .action .t { font-size: 10px; font-weight: 700; margin-bottom: 1px; }
  .action .b { font-size: 9px; color: #444; line-height: 1.4; }

  .signal {
    display: flex; gap: 8px; padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .signal:last-child { border-bottom: 0; }
  .signal .marker {
    width: 4px; flex-shrink: 0; border-radius: 2px; background: var(--ultra);
  }
  .signal .body-w { flex: 1; }
  .signal .meta {
    font-size: 7.5px; color: var(--mute); text-transform: uppercase;
    letter-spacing: 0.08em; margin-bottom: 1px;
  }
  .signal .title { font-size: 10px; font-weight: 600; line-height: 1.3; }
  .signal .body  { font-size: 9px; color: #444; line-height: 1.4; margin-top: 1px; }

  .ranks { display: flex; flex-direction: column; gap: 4px; }
  .rank {
    display: flex; align-items: center; gap: 8px;
    font-size: 9px;
  }
  .rank .name { width: 60px; font-weight: 600; }
  .rank .bar-w { flex: 1; height: 7px; background: rgba(0,0,0,.05); border-radius: 3px; }
  .rank .bar-f { height: 100%; border-radius: 3px; background: var(--ultra); }
  .rank.own .bar-f { background: var(--magenta); }
  .rank .val { width: 40px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  .formula-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px;
  }
  .formula-cell {
    padding: 6px 8px; border-radius: 5px;
    border: 1px solid var(--line); background: rgba(0,0,0,.02);
  }
  .formula-cell .lbl {
    font-size: 7.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; margin-bottom: 2px;
  }
  .formula-cell .body { font-size: 8.5px; color: #333; line-height: 1.35; }

  footer {
    margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line);
    display: flex; justify-content: space-between; font-size: 8px; color: var(--mute);
  }
</style>
</head>
<body>
  <header>
    <div class="logo">PULSE<span class="dot">.</span></div>
    <div class="meta">
      <div><strong>${esc(workspace.name)}</strong></div>
      <div>${esc(date)} · Executive brief</div>
    </div>
  </header>

  <div class="verdict">
    <div class="verdict-main">
      <div class="eyebrow lime">AI Verdict</div>
      <h1>${esc(verdict.title || 'Brief unavailable')}</h1>
      <p>${esc(verdict.body || 'Re-generate from the dashboard to populate this report.')}</p>
      ${factors.length ? `<div class="chips">${factors.map(f => `<span class="chip ${chipTone(f)}">${esc(f)}</span>`).join('')}</div>` : ''}
    </div>
    ${intelScore ? `
    <div class="score-pill">
      <div class="num">${intelScore}<span style="font-size:14px;color:rgba(248,246,242,.45);font-weight:600;">/100</span></div>
      <div class="lbl">Intel score</div>
    </div>` : ''}
  </div>

  <div class="row" style="margin-bottom: 10px;">
    <div class="col">
      <div class="card" style="height: 100%;">
        <h2><span class="eyebrow ultra">Action plan</span></h2>
        ${['now', 'today', 'week', 'month'].map(k => {
          const items = buckets[k];
          if (!items.length) return '';
          const labels = { now: 'Right now', today: 'Today', week: 'This week', month: 'This month' };
          return items.slice(0, 2).map(a => `
            <div class="action ${k}">
              <div class="when">${esc(labels[k])}</div>
              <div class="t">${esc(a.title || 'Action')}</div>
              <div class="b">${esc(a.body || '')}</div>
            </div>
          `).join('');
        }).join('')}
        ${actions.length === 0 ? '<div style="color:var(--mute);font-size:9px;">No actions yet. Generate a brief to populate.</div>' : ''}
      </div>
    </div>

    <div class="col">
      <div class="card" style="height: 100%;">
        <h2><span class="eyebrow mag">Top signals</span></h2>
        ${signals.length === 0 ? '<div style="color:var(--mute);font-size:9px;">No signals yet.</div>' : signals.map(s => `
          <div class="signal">
            <div class="marker"></div>
            <div class="body-w">
              <div class="meta">${esc(s.label || s.kind || 'Signal')}</div>
              <div class="title">${esc(s.title || '')}</div>
              <div class="body">${esc(s.body || '')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="col" style="max-width: 240px;">
      <div class="card" style="height: 100%;">
        <h2><span class="eyebrow amb">Reach scorecard</span></h2>
        ${(() => {
          const rows = competitors
            .filter(c => c.latest && c.latest > 0)
            .map(c => ({ name: '@' + String(c.handle || '').replace(/^@/, ''), value: c.latest, own: false }));
          if (rows.length === 0) return '<div style="color:var(--mute);font-size:9px;">No competitors tracked yet.</div>';
          rows.sort((a, b) => b.value - a.value);
          const leader = rows[0].value;
          return `<div class="ranks">${rows.slice(0, 6).map(r => {
            const pct = Math.max(4, (r.value / leader) * 100);
            return `<div class="rank ${r.own ? 'own' : ''}">
              <div class="name">${esc(r.name)}</div>
              <div class="bar-w"><div class="bar-f" style="width:${pct.toFixed(1)}%;"></div></div>
              <div class="val">${esc(fmtNum(r.value))}</div>
            </div>`;
          }).join('')}</div>`;
        })()}
      </div>
    </div>
  </div>

  ${formula ? `
  <div class="card">
    <h2><span class="eyebrow lime">The content formula</span></h2>
    <div class="formula-grid">
      <div class="formula-cell"><div class="lbl" style="color:var(--magenta);">① Hook</div><div class="body">${esc(formula.hook || '—')}</div></div>
      <div class="formula-cell"><div class="lbl" style="color:var(--ultra);">② Differentiator</div><div class="body">${esc(formula.differentiator || '—')}</div></div>
      <div class="formula-cell"><div class="lbl" style="color:var(--amber);">③ Caption</div><div class="body">${esc(formula.caption || '—')}</div></div>
      <div class="formula-cell"><div class="lbl" style="color:#5b8800;">④ Niche</div><div class="body">${esc(formula.niche || '—')}</div></div>
    </div>
  </div>` : ''}

  <footer>
    <span>Generated by PULSE · karvan-pulse.vercel.app</span>
    <span>© ${new Date().getFullYear()} KARVAN BI Studio</span>
  </footer>
</body>
</html>`;
}
