import React from 'react';

// Snapshot the shared symbols this file references off window.
// They are published there by src/spa/utilities.jsx and the js/core/*
// modules; src/spa/main.jsx guarantees the load order.
const {
  cls,
  safeHref,
  Card,
  Btn,
  Eyebrow,
  Plat,
  Sparkline,
  BarSpark,
  Pill,
  MashalDot,
  Progress,
  StatCard,
  SectionHead,
  MashalLogo,
  PlatformIcons,
  Icon,
  D,
  formatNum,
  platformLabel,
  platformBrand,
  initialsOf,
  formatSync,
  hydrateD,
  api,
  API_BASE,
  sbAuth,
  SUPABASE_URL,
  SUPABASE_ANON,
  restoreSession,
  checkMagicLinkHash,
  SubscriptionBanner,
  UpgradeDialog,
} = window;


// ═════════════════════════════════════════════════════════════════════════
// Mashal Team Panel — Brand/Agency, admin+.
//
// Mounted inside SettingsScreen as a self-contained section. Reads
// /api/team/members on mount and on window focus so the member list
// stays current after invites land or roles change.
//
// Three blocks:
//   1. Members list — current users + role + remove button (owner row
//      protected). Inline role editor for admin+ to demote/promote.
//   2. Invite form — email + role + Send. Surfaces server-side seat-cap
//      and validation errors inline.
//   3. Pending invitations — list with resend (POST /invite again) and
//      revoke (DELETE) controls.
//   4. (Agency owner only) Assignment matrix — every non-owner member
//      across all of this owner's workspaces, with per-workspace role
//      shown as a small chip. Lets the owner click into a member to
//      manage their assignments without opening each workspace.
//
// Loaded as <script type="text/babel" src="js/team/panel.js"></script>.
// Depends on api() from js/core/api.js and global Btn/Card/cls/Icon/
// Eyebrow defined inline in index.html.
// ═════════════════════════════════════════════════════════════════════════

const ROLE_LABEL = {
  owner:  'Owner',
  admin:  'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const ROLE_DESCRIPTION = {
  admin:  'Invite or remove members, edit workspace settings, full brief access. Counts as an internal seat.',
  member: 'Full brief, content, and competitors. No settings changes. Counts as an internal seat.',
  viewer: 'Read-only access to the brief, signals, and reports. Great for sharing with clients, and never counts against your seat limit.',
};

const ROLE_CLS = {
  owner:  'bg-lime/20 text-limeDeep dark:text-lime',
  admin:  'bg-ultra/15 text-ultra dark:text-ultra',
  member: 'bg-paper/40 dark:bg-ink/40 text-mute dark:text-muteDark',
  viewer: 'bg-amber/15 text-amber',
};

const TeamPanel = () => {
  const [data, setData]           = React.useState(null);
  const [loading, setLoading]     = React.useState(true);
  const [hidden, setHidden]       = React.useState(false);
  const [error, setError]         = React.useState(null);
  const [busy, setBusy]           = React.useState(null);   // arbitrary action key
  // Invite form
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole]   = React.useState('member');
  const [inviteFeedback, setInviteFeedback] = React.useState(null);

  const fetchData = React.useCallback(async () => {
    try {
      const r = await api('/team/members');
      setData(r);
      setHidden(false);
      setError(null);
    } catch (e) {
      // 403 = non-admin or non-Brand/Agency — hide silently.
      if (/403|403/.test(String(e.status || e.message))) setHidden(true);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
    const onFocus = () => fetchData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchData]);

  if (hidden) return null;

  const submitInvite = async (e) => {
    e?.preventDefault?.();
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteFeedback({ type: 'err', msg: 'Enter a valid email.' });
      return;
    }
    setBusy('invite');
    setInviteFeedback(null);
    try {
      const r = await api('/team/invite', {
        method: 'POST',
        body: JSON.stringify({ email, role: inviteRole }),
      });
      setInviteEmail('');
      setInviteFeedback({
        type: r.email_status === 'sent' ? 'ok' : 'warn',
        msg:  r.email_status === 'sent'
          ? `Invite sent to ${email}.`
          : `Invite created but email failed (${r.email_error || 'unknown'}). Copy the link below to share manually.`,
        link: r.email_status === 'sent' ? null : r.link,
      });
      fetchData();
    } catch (e) {
      setInviteFeedback({ type: 'err', msg: e.message || 'Could not send invite.' });
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (userId, role) => {
    setBusy(`role:${userId}`);
    try {
      await api('/team/members', {
        method: 'PATCH',
        body: JSON.stringify({ user_id: userId, role }),
      });
      fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (userId, email) => {
    if (!confirm(`Remove ${email || 'this member'} from the workspace?`)) return;
    setBusy(`remove:${userId}`);
    try {
      await api('/team/members', {
        method: 'DELETE',
        body: JSON.stringify({ user_id: userId }),
      });
      fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const revokeInvite = async (invitationId) => {
    setBusy(`revoke:${invitationId}`);
    try {
      await api('/team/members', {
        method: 'DELETE',
        body: JSON.stringify({ invitation_id: invitationId }),
      });
      fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  // Loading skeleton — matches the rest of Settings.
  if (loading) {
    return (
      <div id="settings-team" style={{ scrollMarginTop: '80px' }}>
        <h3 className="font-display text-[17px] font-semibold tracking-tight mb-1">Team</h3>
        <Card className="!p-5 space-y-3">
          <div className="h-4 w-32 rounded bg-ink/10 dark:bg-paper/10 animate-pulse" />
          <div className="h-4 w-56 rounded bg-ink/10 dark:bg-paper/10 animate-pulse" />
          <div className="h-9 w-full rounded bg-ink/10 dark:bg-paper/10 animate-pulse" />
        </Card>
      </div>
    );
  }

  const members     = data?.members      || [];
  const invitations = data?.invitations  || [];
  const matrix      = data?.matrix       || null;

  return (
    <div id="settings-team" style={{ scrollMarginTop: '80px' }}>
      <h3 className="font-display text-[17px] font-semibold tracking-tight mb-1">Team</h3>
      <p className="text-[13px] text-mute dark:text-muteDark mb-4">
        Invite teammates and clients. Owners and admins manage access. Members can edit content and competitors. Viewers see read-only briefs, which is useful for sharing the workspace with clients. Viewer invites are uncapped, so client access never burns an internal seat.
      </p>

      {error && (
        <div className="mb-4 rounded-xl bg-magenta/10 border border-magenta/40 text-magenta text-[12.5px] p-3">
          {error}
        </div>
      )}

      <Card className="!p-5 space-y-5">
        {/* ── Member list ────────────────────────────────────────────── */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">
            Members ({members.length})
          </div>
          <div className="space-y-2">
            {members.map(m => {
              const isOwner = m.role === 'owner';
              const isSelf  = m.is_self;
              return (
                <div key={m.user_id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-chalk dark:bg-coalsoft border border-line dark:border-lineDark">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium truncate">{m.email || m.user_id}</span>
                      {isSelf && (
                        <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-mute dark:text-muteDark">you</span>
                      )}
                    </div>
                    {m.name && <div className="text-[11.5px] text-mute dark:text-muteDark truncate">{m.name}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isOwner ? (
                      <span className={cls('inline-flex items-center px-2 h-6 rounded-full text-[10px] font-mono uppercase tracking-[0.12em]', ROLE_CLS.owner)}>
                        Owner
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={e => changeRole(m.user_id, e.target.value)}
                        disabled={busy === `role:${m.user_id}`}
                        className="h-7 px-2 rounded-lg border border-line dark:border-lineDark bg-paper dark:bg-ink text-[12px] focus:outline-none focus:border-ultra"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}
                    {!isOwner && (
                      <button
                        type="button"
                        onClick={() => removeMember(m.user_id, m.email)}
                        disabled={busy === `remove:${m.user_id}`}
                        className="text-[11px] font-mono uppercase tracking-[0.12em] text-mute dark:text-muteDark hover:text-magenta transition px-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Pending invitations ────────────────────────────────────── */}
        {invitations.length > 0 && (
          <div className="pt-4 border-t border-line dark:border-lineDark">
            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">
              Pending invitations ({invitations.length})
            </div>
            <div className="space-y-2">
              {invitations.map(inv => (
                <div key={inv.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-paper dark:bg-ink border border-line dark:border-lineDark">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{inv.email}</div>
                    <div className="text-[11px] text-mute dark:text-muteDark">
                      Sent {new Date(inv.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · expires {new Date(inv.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cls('inline-flex items-center px-2 h-6 rounded-full text-[10px] font-mono uppercase tracking-[0.12em]', ROLE_CLS[inv.role] || ROLE_CLS.member)}>
                      {ROLE_LABEL[inv.role] || inv.role}
                    </span>
                    <button
                      type="button"
                      onClick={() => revokeInvite(inv.id)}
                      disabled={busy === `revoke:${inv.id}`}
                      className="text-[11px] font-mono uppercase tracking-[0.12em] text-mute dark:text-muteDark hover:text-magenta transition px-2"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Invite form ────────────────────────────────────────────── */}
        <form onSubmit={submitInvite} className="pt-4 border-t border-line dark:border-lineDark">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">Invite by email</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1 h-10 px-3 rounded-xl border border-line dark:border-lineDark bg-paper dark:bg-ink text-[13.5px] focus:outline-none focus:border-ultra transition"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
              className="h-10 px-3 rounded-xl border border-line dark:border-lineDark bg-paper dark:bg-ink text-[13.5px] focus:outline-none focus:border-ultra transition sm:w-32"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <Btn variant="ink" type="submit" disabled={busy === 'invite' || !inviteEmail}>
              {busy === 'invite' ? 'Sending…' : 'Send invite'}
            </Btn>
          </div>
          <p className="text-[11.5px] text-mute dark:text-muteDark mt-2 leading-relaxed">
            {ROLE_DESCRIPTION[inviteRole]}
          </p>
          {inviteFeedback && (
            <div className={cls(
              'mt-3 text-[12.5px] rounded-xl p-3 border',
              inviteFeedback.type === 'ok'   && 'bg-lime/15 border-lime/40 text-limeDeep dark:text-lime',
              inviteFeedback.type === 'warn' && 'bg-amber/15 border-amber/40 text-amber',
              inviteFeedback.type === 'err'  && 'bg-magenta/15 border-magenta/40 text-magenta',
            )}>
              {inviteFeedback.msg}
              {inviteFeedback.link && (
                <div className="mt-2 font-mono text-[11.5px] break-all">{inviteFeedback.link}</div>
              )}
            </div>
          )}
        </form>
      </Card>

      {/* ── Agency assignment matrix ────────────────────────────────── */}
      {matrix && matrix.users && matrix.users.length > 0 && (
        <div className="mt-5">
          <h4 className="text-[14px] font-semibold mb-0.5">Workspace assignments</h4>
          <p className="text-[12.5px] text-mute dark:text-muteDark mb-3">
            Each team member's role across every workspace you own. Manage per-workspace access from one place instead of clicking into 20 settings screens.
          </p>
          <Card className="!p-0 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line dark:border-lineDark">
                  <th className="text-left p-3 font-mono uppercase tracking-[0.12em] text-[10px] text-mute dark:text-muteDark sticky left-0 bg-paper dark:bg-coalsoft z-10">
                    Member
                  </th>
                  {matrix.workspaces.map(w => (
                    <th key={w.id} className="text-left p-3 font-medium text-[12px] whitespace-nowrap">{w.name || 'Untitled'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.users.map(u => {
                  const byWs = Object.fromEntries((u.assignments || []).map(a => [a.workspace_id, a.role]));
                  return (
                    <tr key={u.user_id} className="border-b border-line/60 dark:border-lineDark/60">
                      <td className="p-3 sticky left-0 bg-paper dark:bg-coalsoft z-10">
                        <div className="font-medium truncate max-w-[180px]">{u.email || u.user_id}</div>
                        {u.name && <div className="text-[11px] text-mute dark:text-muteDark truncate max-w-[180px]">{u.name}</div>}
                      </td>
                      {matrix.workspaces.map(w => {
                        const role = byWs[w.id];
                        return (
                          <td key={w.id} className="p-3 whitespace-nowrap">
                            {role ? (
                              <span className={cls('inline-flex items-center px-2 h-5 rounded-full text-[10px] font-mono uppercase tracking-[0.12em]', ROLE_CLS[role] || ROLE_CLS.member)}>
                                {ROLE_LABEL[role] || role}
                              </span>
                            ) : (
                              <span className="text-[11px] font-mono text-mute dark:text-muteDark">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="text-[11.5px] text-mute dark:text-muteDark mt-2 leading-relaxed">
            To change a member's role on a specific workspace, switch to that workspace and edit them here. Per-cell role editing arrives in a follow-up.
          </p>
        </div>
      )}
    </div>
  );
};

Object.assign(window, {
  Team: Object.assign(window.Team || {}, { Panel: TeamPanel }),
});
