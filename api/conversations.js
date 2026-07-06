// ═════════════════════════════════════════════════════════════════════════
// [Mashal] Conversations — read-only inbox surface (Brand / Agency).
//
// Returns the workspace's incoming DMs / comments / reviews from inbox_events
// (fed by the Zernio webhook) plus lightweight messaging analytics computed
// locally from those rows. READ ONLY — no replies, no outbound, no templates.
//
// Phase 1 reads only inbox_events (a known, already-populated shape). A later
// phase will enrich with Zernio's live /inbox/* threads + /analytics/inbox/*
// endpoints once their response shapes are confirmed.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { engageGate } from './_lib/tiers.js';
import { zernio } from './_lib/zernio.js';

const PLATFORM_LABEL = {
  instagram: 'Instagram', facebook: 'Facebook', telegram: 'Telegram',
  whatsapp: 'WhatsApp', youtube: 'YouTube', google_business: 'Google Business',
  tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', threads: 'Threads',
  bluesky: 'Bluesky', reddit: 'Reddit', pinterest: 'Pinterest',
};

// Collapse the many webhook `kind` strings into 3 display groups.
function groupFor(kind) {
  const k = String(kind || '').toLowerCase();
  if (k.includes('comment')) return 'comment';
  if (k.includes('review'))  return 'review';
  if (k.includes('message') || k.includes('dm') || k.includes('conversation')) return 'dm';
  return 'other';
}

// Defensive dotted-path read over the stored payload.
function pick(obj, ...paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, kk) => (o == null ? null : o[kk]), obj);
    if (v != null) return v;
  }
  return null;
}

// Normalise Zernio attachments (shared reels, story mentions, images sent in a
// DM/comment) to a flat { url, type, title } the UI can render. Real shape:
// { url, type:'video'|'share'|..., payload:{ url, title }, originalType:'ig_reel'
// |'story_mention' }. Prefer originalType (more descriptive) for the label.
function normMedia(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    const url = a?.url || a?.payload?.url || a?.src || a?.image_url || null;
    if (!url) continue;
    out.push({
      url,
      type: String(a?.originalType || a?.type || 'file').toLowerCase(),
      title: a?.payload?.title || a?.title || null,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // TIER GATE — Conversations (inbox + reply + automations). Intended floor is
  // Pro Creator; during launch basic Creator is also allowed. Single source of
  // truth in api/_lib/tiers.js so all engage routes agree.
  const tierKey = String(ws.tier || 'creator').toLowerCase();
  const gate = engageGate(ws);
  if (gate) return json(res, gate.status, gate.body);

  // Recent inbox events for this workspace (webhook-fed). Read for the feed;
  // the payload is used only to extract threading keys (conversation id,
  // direction, comment parent) — it is not shipped to the browser.
  const rows = await supabase.select('inbox_events', {
    select: 'id,platform,kind,author_handle,body,post_id,platform_post_id,account_id,zernio_account_id,payload,received_at',
    eq: { workspace_id: ws.id },
    order: 'received_at.desc',
    limit: 200,
  }).catch(() => []);

  const items = (rows || []).map(r => {
    const p = r.payload || {};
    const group = groupFor(r.kind);
    const kindStr = String(r.kind || '').toLowerCase();
    // DM threading: conversation id + which way the message went.
    const conversation_id = group === 'dm'
      ? pick(p, 'message.conversationId', 'conversation.id', 'conversationId') : null;
    const direction = group === 'dm'
      ? (pick(p, 'message.direction') || (kindStr.includes('sent') ? 'outgoing' : 'incoming')) : null;
    // Comment threading: the comment id + its parent (for nesting replies).
    const comment_id = group === 'comment'
      ? pick(p, 'comment.id', 'commentId', 'comment._id') : null;
    const parent_comment_id = group === 'comment'
      ? pick(p, 'comment.parentCommentId', 'parentCommentId') : null;
    // Media a follower attached (shared reel, story mention, image, …).
    const media = group === 'dm'
      ? normMedia(pick(p, 'message.attachments'))
      : group === 'comment'
        ? normMedia(pick(p, 'comment.attachments', 'comment.media'))
        : [];
    return {
      id:                r.id,
      platform:          r.platform,
      platform_label:    PLATFORM_LABEL[r.platform] || r.platform || 'Unknown',
      group,
      kind:              r.kind,
      account_id:        r.account_id || null,
      zernio_account_id: r.zernio_account_id || null,
      author:            r.author_handle || null,
      body:              r.body || null,
      post_id:           r.post_id || null,
      platform_post_id:  r.platform_post_id || null,
      conversation_id:   conversation_id || null,
      direction,
      comment_id:        comment_id || null,
      parent_comment_id: parent_comment_id || null,
      media,
      received_at:       r.received_at,
    };
  });

  // Lightweight analytics computed locally (no Zernio add-on needed).
  const by_platform = {};
  const by_group = { dm: 0, comment: 0, review: 0, other: 0 };
  const now = Date.now();
  const last7 = [0, 0, 0, 0, 0, 0, 0]; // index 0 = today, 6 = six days ago
  for (const it of items) {
    by_platform[it.platform] = (by_platform[it.platform] || 0) + 1;
    by_group[it.group] = (by_group[it.group] || 0) + 1;
    const days = Math.floor((now - new Date(it.received_at).getTime()) / 86400000);
    if (days >= 0 && days < 7) last7[days] += 1;
  }

  // Connected accounts for the per-account switcher. Inbox + reply/DM are
  // platform-agnostic — whichever accounts are connected (IG, FB, TikTok,
  // YouTube, LinkedIn, …) each get their own filter, plus a combined view.
  const accts = await supabase.select('connected_accounts', {
    select: 'id,platform,platform_username,zernio_account_id',
    eq: { workspace_id: ws.id, is_active: true },
  }).catch(() => []);
  const accounts = (accts || [])
    .filter(a => a.zernio_account_id)
    .map(a => ({
      id:                a.id,
      platform:          a.platform,
      platform_label:    PLATFORM_LABEL[a.platform] || a.platform || 'Account',
      username:          a.platform_username,
      zernio_account_id: a.zernio_account_id,
    }));

  // ── Live pull: comments Zernio holds that never reached our webhook feed.
  // Zernio's comments API is two-level: list COMMENTED POSTS for the account,
  // then fetch the comments per post. Bounded (skip webhook-covered IG; cap the
  // per-account post fan-out) + time-bounded so a slow/failing account never
  // blocks the feed. Read-only display (external:true) with a reply context.
  const PULL_SKIP = new Set(['instagram']);   // IG is covered by real-time webhooks
  const POSTS_PER_ACCOUNT = 8;
  const raceTimeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('pull timeout')), ms));
  const zcall = (p) => Promise.race([p, raceTimeout(6000)]).catch(() => null);
  const seenComments = new Set(
    items.filter(i => i.group === 'comment' && i.comment_id).map(i => String(i.comment_id))
  );
  const pulled = [];
  const pullDebug = [];   // per-account diagnostics (admin-only in the response)
  await Promise.all(accounts.filter(a => !PULL_SKIP.has(a.platform)).map(async (acct) => {
    // 1) commented posts for this account
    const postsResp = await zcall(zernio.listInboxComments(acct.zernio_account_id, { limit: 50 }));
    const rawPosts = Array.isArray(postsResp) ? postsResp : (postsResp?.data || postsResp?.comments || postsResp?.items || []);
    const posts = (Array.isArray(rawPosts) ? rawPosts : [])
      .filter(p => Number(p?.commentCount || 0) > 0)
      .sort((a, b) => String(b?.createdTime || '').localeCompare(String(a?.createdTime || '')))
      .slice(0, POSTS_PER_ACCOUNT);
    // 2) comments per post
    let got = 0, sampleKeys = null;
    await Promise.all(posts.map(async (post) => {
      const pid = post?.id || post?.postId || post?.platformPostId;
      if (!pid) return;
      const cResp = await zcall(zernio.listInboxComments(acct.zernio_account_id, { postId: pid }));
      const rawC = Array.isArray(cResp) ? cResp : (cResp?.comments || cResp?.data || cResp?.items || []);
      const carr = Array.isArray(rawC) ? rawC : [];
      if (!sampleKeys && carr[0] && typeof carr[0] === 'object') sampleKeys = Object.keys(carr[0]).slice(0, 20);
      for (const c of carr) {
        const cid = c?.id || c?._id || c?.commentId;
        if (!cid || seenComments.has(String(cid))) continue;
        seenComments.add(String(cid));
        got++;
        const platPostId = c?.postId || c?.platformPostId || pid;
        pulled.push({
          id:                `zc:${cid}`,
          platform:          acct.platform,
          platform_label:    acct.platform_label,
          group:             'comment',
          kind:              'comment.received',
          account_id:        acct.id,
          zernio_account_id: acct.zernio_account_id,
          author:            c?.author?.username || (typeof c?.author === 'string' ? c.author : null) || c?.username || c?.from?.username || c?.authorName || null,
          body:              c?.text || c?.content || c?.message || null,
          post_id:           null,
          platform_post_id:  platPostId,
          conversation_id:   null,
          direction:         null,
          comment_id:        String(cid),
          parent_comment_id: c?.parentCommentId || c?.parent_comment_id || null,
          media:             normMedia(c?.media || c?.attachments),
          received_at:       c?.timestamp || c?.createdTime || c?.createdAt || null,
          external:          true,
          reply_ctx:         { zernio_account_id: acct.zernio_account_id, platform_post_id: platPostId, comment_id: String(cid), platform: acct.platform },
        });
      }
    }));
    pullDebug.push({ platform: acct.platform, commentedPosts: posts.length, comments: got, sampleKeys });
  }));
  try { console.log('[conversations.pull]', JSON.stringify(pullDebug)); } catch { /* noop */ }
  if (pulled.length) {
    items.push(...pulled);
    items.sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || '')));
  }

  return json(res, 200, {
    items,
    accounts,
    analytics: {
      total: items.length,
      by_platform,
      by_group,
      last_7d: last7.slice().reverse(), // oldest → today, for a left-to-right bar
    },
    tier: { key: tierKey },
    // Admin-only pull diagnostics (per-account: error/shape/count). Temporary —
    // remove once the FB/YouTube/TikTok pull is confirmed working.
    ...(auth.isAdmin ? { _pull: pullDebug } : {}),
  });
}
