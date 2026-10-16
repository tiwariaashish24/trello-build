import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  api,
  type Organization,
  type OrganizationInvitation,
} from "../lib/api";
import { useAuth } from "../lib/auth";

export function Dashboard() {
  const { token, user, logout } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [boardTitles, setBoardTitles] = useState<Record<string, string>>({});
  const [inviteEmails, setInviteEmails] = useState<Record<string, string>>({});
  const [openInviteForm, setOpenInviteForm] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [workspaceData, invitationData] = await Promise.all([
        api<Organization[]>("/organizations", token),
        api<OrganizationInvitation[]>("/organizations/invitations", token),
      ]);
      setOrganizations(workspaceData);
      setInvitations(invitationData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load your workspaces",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const visibleOrganizations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return organizations;
    return organizations.filter((organization) =>
      `${organization.name} ${organization.description ?? ""} ${organization.boards
        .map((board) => board.title)
        .join(" ")}`
        .toLowerCase()
        .includes(query),
    );
  }, [organizations, search]);

  if (!user || !token) {
    return <Navigate to="/login" replace />;
  }

  const createOrganization = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name) {
      setError("Enter a workspace name.");
      return;
    }
    setBusy("workspace");
    setError("");
    try {
      await api("/organization", token, {
        method: "POST",
        body: JSON.stringify({
          name,
          description: workspaceDescription.trim(),
        }),
      });
      setWorkspaceName("");
      setWorkspaceDescription("");
      setShowWorkspaceForm(false);
      setNotice("Workspace created. You are its admin.");
      await fetchDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create workspace",
      );
    } finally {
      setBusy("");
    }
  };

  const createBoard = async (
    event: React.FormEvent<HTMLFormElement>,
    organizationId: string,
  ) => {
    event.preventDefault();
    const title = boardTitles[organizationId]?.trim();
    if (!title) return;
    setBusy(`board-${organizationId}`);
    setError("");
    try {
      await api("/board", token, {
        method: "POST",
        body: JSON.stringify({ title, organizationId }),
      });
      setBoardTitles((current) => ({ ...current, [organizationId]: "" }));
      setNotice("Board created.");
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create board");
    } finally {
      setBusy("");
    }
  };

  const sendInvitation = async (
    event: React.FormEvent<HTMLFormElement>,
    organizationId: string,
  ) => {
    event.preventDefault();
    const email = inviteEmails[organizationId]?.trim();
    if (!email) return;
    setBusy(`invite-${organizationId}`);
    setError("");
    try {
      await api("/invite", token, {
        method: "POST",
        body: JSON.stringify({ email, organizationId }),
      });
      setInviteEmails((current) => ({ ...current, [organizationId]: "" }));
      setOpenInviteForm(null);
      setNotice(
        `Invitation sent to ${email}. They can accept it after signing in.`,
      );
      await fetchDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send invitation",
      );
    } finally {
      setBusy("");
    }
  };

  const respondToInvitation = async (
    invitation: OrganizationInvitation,
    accept: boolean,
  ) => {
    setBusy(`invitation-${invitation.id}`);
    setError("");
    try {
      await api(accept ? "/accept" : "/membership", token, {
        method: accept ? "POST" : "DELETE",
        body: JSON.stringify({ organizationId: invitation.organizationId }),
      });
      setNotice(
        accept
          ? `You joined ${invitation.organization.name}.`
          : `Invitation to ${invitation.organization.name} declined.`,
      );
      await fetchDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update invitation",
      );
    } finally {
      setBusy("");
    }
  };

  const removeMember = async (organizationId: string, userId: string) => {
    if (!window.confirm("Remove this person from the workspace?")) return;
    setBusy(`member-${userId}`);
    setError("");
    try {
      await api("/membership", token, {
        method: "DELETE",
        body: JSON.stringify({ organizationId, userId }),
      });
      setNotice("Workspace member removed.");
      await fetchDashboard();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not remove workspace member",
      );
    } finally {
      setBusy("");
    }
  };

  const leaveOrganization = async (organization: Organization) => {
    if (!window.confirm(`Leave the ${organization.name} workspace?`)) return;
    setBusy(`leave-${organization.id}`);
    setError("");
    try {
      await api("/membership", token, {
        method: "DELETE",
        body: JSON.stringify({ organizationId: organization.id }),
      });
      setNotice(`You left ${organization.name}.`);
      await fetchDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not leave workspace",
      );
    } finally {
      setBusy("");
    }
  };

  const deleteOrganization = async (organization: Organization) => {
    if (
      !window.confirm(
        `Delete ${organization.name} and its boards? This action cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(`delete-${organization.id}`);
    setError("");
    try {
      await api(`/organization/${organization.id}`, token, {
        method: "DELETE",
      });
      setNotice(`${organization.name} was deleted.`);
      await fetchDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete workspace",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="app-shell dashboard-shell">
      <header className="topbar dashboard-topbar">
        <div className="topbar-left">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            <span>
              Trello<span className="brand-light">Build</span>
            </span>
          </Link>
          <span className="topbar-divider" aria-hidden="true" />
          <span className="dashboard-context">Workspaces</span>
        </div>
        <div className="dashboard-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search workspaces and boards"
            placeholder="Search workspaces and boards"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="topbar-right">
          <span className="user-name">{user.name || user.email}</span>
          <button className="quiet-button" type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <div className="dashboard-layout">
        <aside className="workspace-sidebar">
          <div className="sidebar-section-heading">
            <span>YOUR WORKSPACES</span>
            <button
              className="icon-button"
              type="button"
              aria-label="Create workspace"
              onClick={() => setShowWorkspaceForm(true)}
            >
              +
            </button>
          </div>
          {organizations.map((organization) => (
            <a
              className="workspace-nav-link"
              href={`#workspace-${organization.id}`}
              key={organization.id}
            >
              <span className="workspace-avatar">
                {organization.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="workspace-nav-name">{organization.name}</span>
              <span className="workspace-board-count">
                {organization.boards.length}
              </span>
            </a>
          ))}
          {!loading && organizations.length === 0 && (
            <p className="sidebar-empty">
              Create a workspace or accept an invite to get started.
            </p>
          )}
          <button
            className="sidebar-create"
            type="button"
            onClick={() => setShowWorkspaceForm(true)}
          >
            <span>＋</span> Create workspace
          </button>
        </aside>

        <main className="dashboard-content">
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">Your team’s home</p>
              <h1>Workspaces</h1>
              <p className="muted">
                Organize your team, join shared workspaces, and keep every board
                in reach.
              </p>
            </div>
            <button
              className="primary"
              type="button"
              onClick={() => setShowWorkspaceForm((open) => !open)}
            >
              {showWorkspaceForm ? "Cancel" : "＋ Create workspace"}
            </button>
          </div>

          {error && (
            <div className="dashboard-alert dashboard-alert-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                ×
              </button>
            </div>
          )}
          {notice && (
            <div
              className="dashboard-alert dashboard-alert-success"
              role="status"
            >
              <span>{notice}</span>
              <button
                type="button"
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}

          {showWorkspaceForm && (
            <form
              className="workspace-create-panel"
              onSubmit={(event) => void createOrganization(event)}
            >
              <div className="workspace-form-heading">
                <div>
                  <h2>Create a workspace</h2>
                  <p className="muted">
                    Workspaces give your team a place to share boards.
                  </p>
                </div>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => setShowWorkspaceForm(false)}
                >
                  Close
                </button>
              </div>
              <div className="workspace-form-fields">
                <input
                  aria-label="Workspace name"
                  placeholder="Workspace name"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  required
                />
                <input
                  aria-label="Workspace description"
                  placeholder="Description (optional)"
                  value={workspaceDescription}
                  onChange={(event) =>
                    setWorkspaceDescription(event.target.value)
                  }
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={busy === "workspace"}
                >
                  {busy === "workspace" ? "Creating…" : "Create workspace"}
                </button>
              </div>
            </form>
          )}

          {invitations.length > 0 && (
            <section className="invitations-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">You’re invited</p>
                  <h2>Join a workspace</h2>
                </div>
                <span className="invitation-count">{invitations.length}</span>
              </div>
              <div className="invitation-list">
                {invitations.map((invitation) => (
                  <article className="invitation-card" key={invitation.id}>
                    <span className="workspace-avatar">
                      {invitation.organization.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="invitation-copy">
                      <h3>{invitation.organization.name}</h3>
                      <p>
                        {invitation.organization.description ||
                          "You’ve been invited to collaborate."}
                      </p>
                    </div>
                    <div className="invitation-actions">
                      <button
                        className="quiet-button"
                        type="button"
                        disabled={busy === `invitation-${invitation.id}`}
                        onClick={() =>
                          void respondToInvitation(invitation, false)
                        }
                      >
                        Decline
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={busy === `invitation-${invitation.id}`}
                        onClick={() =>
                          void respondToInvitation(invitation, true)
                        }
                      >
                        {busy === `invitation-${invitation.id}`
                          ? "Joining…"
                          : "Join workspace"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="section-heading workspace-list-heading">
            <div>
              <p className="eyebrow">Shared with you</p>
              <h2>
                Your workspaces <span>{visibleOrganizations.length}</span>
              </h2>
            </div>
            {organizations.length > 0 && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => void fetchDashboard()}
                disabled={loading}
              >
                {loading ? "Refreshing…" : "↻ Refresh"}
              </button>
            )}
          </div>

          {loading ? (
            <div className="dashboard-empty-state">
              <p>Loading your workspaces…</p>
            </div>
          ) : visibleOrganizations.length === 0 ? (
            <div className="dashboard-empty-state">
              <span className="empty-state-icon" aria-hidden="true">
                ▤
              </span>
              <h2>
                {search ? "No matching workspaces" : "Your team starts here"}
              </h2>
              <p>
                {search
                  ? "Try another workspace or board name."
                  : invitations.length
                    ? "Accept an invitation above to join a workspace."
                    : "Create a workspace and invite your teammates to start collaborating."}
              </p>
              {!search && (
                <button
                  className="primary"
                  type="button"
                  onClick={() => setShowWorkspaceForm(true)}
                >
                  ＋ Create your first workspace
                </button>
              )}
            </div>
          ) : (
            <div className="workspace-list">
              {visibleOrganizations.map((organization) => {
                const currentMembership = organization.memberships.find(
                  (membership) => membership.userId === user.id,
                );
                const isAdmin = currentMembership?.role === "ADMIN";
                return (
                  <section
                    className="workspace-card"
                    id={`workspace-${organization.id}`}
                    key={organization.id}
                  >
                    <header className="workspace-card-header">
                      <div className="workspace-card-identity">
                        <span className="workspace-avatar workspace-avatar-large">
                          {organization.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <h3>{organization.name}</h3>
                          <p>
                            {organization.description ||
                              "A shared place for your team's boards"}
                          </p>
                        </div>
                      </div>
                      <div className="workspace-header-actions">
                        <span className="workspace-role">
                          {isAdmin ? "ADMIN" : "MEMBER"}
                        </span>
                        {isAdmin ? (
                          <button
                            className="quiet-button"
                            type="button"
                            disabled={busy === `delete-${organization.id}`}
                            onClick={() =>
                              void deleteOrganization(organization)
                            }
                          >
                            Delete workspace
                          </button>
                        ) : (
                          <button
                            className="quiet-button"
                            type="button"
                            disabled={busy === `leave-${organization.id}`}
                            onClick={() => void leaveOrganization(organization)}
                          >
                            Leave
                          </button>
                        )}
                      </div>
                    </header>

                    <div className="workspace-card-meta">
                      <span>
                        {organization.boards.length}{" "}
                        {organization.boards.length === 1 ? "board" : "boards"}
                      </span>
                      <span>
                        {organization.memberships.length}{" "}
                        {organization.memberships.length === 1
                          ? "member"
                          : "members"}
                      </span>
                    </div>

                    <div className="workspace-boards">
                      {organization.boards.map((board, index) => (
                        <Link
                          className={`workspace-board-tile board-color-${index % 5}`}
                          key={board.id}
                          to={`/board/${board.id}`}
                        >
                          <span className="board-tile-icon" aria-hidden="true">
                            ▦
                          </span>
                          <span>{board.title}</span>
                          <span className="board-tile-arrow" aria-hidden="true">
                            ↗
                          </span>
                        </Link>
                      ))}
                      {isAdmin && (
                        <form
                          className="workspace-board-create"
                          onSubmit={(event) =>
                            void createBoard(event, organization.id)
                          }
                        >
                          <input
                            aria-label={`New board title for ${organization.name}`}
                            placeholder="+ Create a board"
                            value={boardTitles[organization.id] || ""}
                            onChange={(event) =>
                              setBoardTitles((current) => ({
                                ...current,
                                [organization.id]: event.target.value,
                              }))
                            }
                          />
                          {boardTitles[organization.id]?.trim() && (
                            <button
                              className="primary"
                              type="submit"
                              disabled={busy === `board-${organization.id}`}
                            >
                              Add board
                            </button>
                          )}
                        </form>
                      )}
                    </div>

                    {organization.memberships.length > 0 && (
                      <details className="member-manager">
                        <summary>Manage members</summary>
                        <div className="member-list">
                          {organization.memberships.map((membership) => (
                            <div className="member-row" key={membership.id}>
                              <span className="member-avatar">
                                {(membership.user.name || membership.user.email)
                                  .slice(0, 1)
                                  .toUpperCase()}
                              </span>
                              <span className="member-name">
                                {membership.user.name || membership.user.email}
                                {membership.userId === user.id && (
                                  <span> · you</span>
                                )}
                              </span>
                              <span className="member-role">
                                {membership.role}
                              </span>
                              {isAdmin && membership.userId !== user.id && (
                                <button
                                  className="danger-text-button"
                                  type="button"
                                  disabled={
                                    busy === `member-${membership.userId}`
                                  }
                                  onClick={() =>
                                    void removeMember(
                                      organization.id,
                                      membership.userId,
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {isAdmin && (
                      <div className="invite-manager">
                        {openInviteForm === organization.id ? (
                          <form
                            className="invite-form"
                            onSubmit={(event) =>
                              void sendInvitation(event, organization.id)
                            }
                          >
                            <input
                              type="email"
                              aria-label={`Email to invite to ${organization.name}`}
                              placeholder="Teammate’s account email"
                              value={inviteEmails[organization.id] || ""}
                              onChange={(event) =>
                                setInviteEmails((current) => ({
                                  ...current,
                                  [organization.id]: event.target.value,
                                }))
                              }
                              required
                            />
                            <button
                              className="primary"
                              type="submit"
                              disabled={busy === `invite-${organization.id}`}
                            >
                              {busy === `invite-${organization.id}`
                                ? "Sending…"
                                : "Send invite"}
                            </button>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() => setOpenInviteForm(null)}
                            >
                              Cancel
                            </button>
                            <span className="hint">
                              They must have an account with this email to
                              receive the invite.
                            </span>
                          </form>
                        ) : (
                          <button
                            className="invite-trigger"
                            type="button"
                            onClick={() => setOpenInviteForm(organization.id)}
                          >
                            ＋ Invite a member
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
