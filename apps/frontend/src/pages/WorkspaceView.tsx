import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, type AccessibleBoard, type Issue } from "../lib/api";
import { useAuth } from "../lib/auth";

type WorkspaceViewType = "inbox" | "planner" | "boards";
type WorkspaceIssue = Issue & {
  boardTitle: string;
  organizationName: string;
  sectionTitle: string;
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(
    firstDay.getFullYear(),
    firstDay.getMonth(),
    1 - mondayOffset,
  );
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function WorkspaceView({ view }: { view: WorkspaceViewType }) {
  const { token, user, logout } = useAuth();
  const [boards, setBoards] = useState<AccessibleBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  useEffect(() => {
    if (!token) return;
    let active = true;
    void api<AccessibleBoard[]>("/boards", token)
      .then((data) => {
        if (active) setBoards(data);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Could not load boards",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const cards = useMemo<WorkspaceIssue[]>(
    () =>
      boards.flatMap((board) =>
        board.sections.flatMap((section) =>
          section.issues.map((issue) => ({
            ...issue,
            boardTitle: board.title,
            organizationName: board.organization.name,
            sectionTitle: section.title,
          })),
        ),
      ),
    [boards],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredBoards = boards.filter((board) =>
    `${board.title} ${board.organization.name}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  const openCards = cards
    .filter((issue) => !issue.completedAt)
    .filter((issue) =>
      `${issue.title} ${issue.boardTitle} ${issue.organizationName} ${issue.sectionTitle}`
        .toLowerCase()
        .includes(normalizedQuery),
    )
    .sort((a, b) => {
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

  const scheduledByDate = useMemo(() => {
    const grouped = new Map<string, WorkspaceIssue[]>();
    for (const issue of cards) {
      if (!issue.dueDate || issue.completedAt) continue;
      const key = dateKey(new Date(issue.dueDate));
      const group = grouped.get(key) ?? [];
      group.push(issue);
      grouped.set(key, group);
    }
    return grouped;
  }, [cards]);

  if (!user || !token) return <Navigate to="/login" replace />;

  const title =
    view === "inbox"
      ? "Inbox"
      : view === "planner"
        ? "Planner"
        : "Switch boards";

  return (
    <div className="app-shell workspace-view-shell">
      <header className="topbar board-topbar">
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
          <Link className="workspace-link" to="/">
            Workspaces
          </Link>
          <span className="board-context">{title}</span>
        </div>
        <div className="topbar-right">
          <span className="user-name">{user.name || user.email}</span>
          <button type="button" className="quiet-button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <header className="workspace-view-heading">
        <div>
          <p className="eyebrow">
            {view === "boards"
              ? "Your workspace boards"
              : view === "inbox"
                ? "Across all your boards"
                : "Due dates across your boards"}
          </p>
          <h1>{title}</h1>
          <p>
            {view === "boards"
              ? "Choose a board to continue working."
              : view === "inbox"
                ? "Keep track of unfinished cards in one place."
                : "See scheduled cards by date and jump straight to the board."}
          </p>
        </div>
        <label className="workspace-view-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder={
              view === "boards" ? "Search boards" : "Search cards and boards"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>

      {error && (
        <div className="dashboard-alert dashboard-alert-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <main className="workspace-view-content">
          <p className="muted">Loading your boards…</p>
        </main>
      ) : view === "boards" ? (
        <main className="workspace-view-content">
          {filteredBoards.length ? (
            <div className="board-picker-grid">
              {filteredBoards.map((board) => (
                <Link
                  className="board-picker-card"
                  key={board.id}
                  to={`/board/${board.id}`}
                >
                  <span className="board-picker-icon" aria-hidden="true">
                    ▥
                  </span>
                  <span className="board-picker-copy">
                    <strong>{board.title}</strong>
                    <span>{board.organization.name}</span>
                  </span>
                  <span className="board-picker-count">
                    {board.sections.reduce(
                      (total, section) => total + section.issues.length,
                      0,
                    )}{" "}
                    cards
                  </span>
                  <span className="board-picker-arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title={normalizedQuery ? "No matching boards" : "No boards yet"}
              description={
                normalizedQuery
                  ? "Try a different board or workspace name."
                  : "Create a workspace and board to start organizing work."
              }
              linkTo="/"
              linkText="Go to workspaces"
            />
          )}
        </main>
      ) : view === "inbox" ? (
        <main className="workspace-view-content">
          {openCards.length ? (
            <div className="focus-card-list global-focus-list">
              {openCards.map((issue) => (
                <WorkspaceIssueRow issue={issue} key={issue.id} showDueDate />
              ))}
            </div>
          ) : (
            <EmptyState
              title={normalizedQuery ? "No matching cards" : "Inbox is clear"}
              description={
                normalizedQuery
                  ? "Try another card, board, or workspace name."
                  : "Unfinished cards from all your boards will appear here."
              }
              linkTo="/boards"
              linkText="Switch boards"
            />
          )}
        </main>
      ) : (
        <main className="workspace-view-content planner-content">
          <div className="planner-toolbar">
            <button
              className="quiet-button"
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              ←
            </button>
            <h2>{monthLabel(month)}</h2>
            <button
              className="quiet-button"
              type="button"
              onClick={() =>
                setMonth(
                  () =>
                    new Date(
                      new Date().getFullYear(),
                      new Date().getMonth(),
                      1,
                    ),
                )
              }
            >
              Today
            </button>
            <button
              className="quiet-button"
              type="button"
              aria-label="Next month"
              onClick={() =>
                setMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              →
            </button>
          </div>
          {scheduledByDate.size ? (
            <div className="planner-calendar">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div className="planner-weekday" key={day}>
                  {day}
                </div>
              ))}
              {getCalendarDays(month).map((day) => {
                const key = dateKey(day);
                const issues = (scheduledByDate.get(key) ?? []).filter(
                  (issue) =>
                    `${issue.title} ${issue.boardTitle} ${issue.organizationName}`
                      .toLowerCase()
                      .includes(normalizedQuery),
                );
                const inCurrentMonth = day.getMonth() === month.getMonth();
                return (
                  <section
                    className={`planner-cell ${inCurrentMonth ? "" : "is-outside"} ${key === dateKey(new Date()) ? "is-today" : ""}`}
                    key={key}
                    aria-label={day.toLocaleDateString()}
                  >
                    <time dateTime={key}>{day.getDate()}</time>
                    <div className="planner-cell-cards">
                      {issues.map((issue) => (
                        <WorkspaceIssueRow
                          issue={issue}
                          key={issue.id}
                          compact
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={
                normalizedQuery
                  ? "No matching scheduled cards"
                  : "Nothing planned yet"
              }
              description={
                normalizedQuery
                  ? "Try another card, board, or workspace name."
                  : "Add a due date to a card and it will appear on the calendar."
              }
              linkTo="/boards"
              linkText="Choose a board"
            />
          )}
        </main>
      )}

      <WorkspaceDock active={view} />
    </div>
  );
}

function WorkspaceIssueRow({
  issue,
  showDueDate = false,
  compact = false,
}: {
  issue: WorkspaceIssue;
  showDueDate?: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      className={`workspace-issue-row ${compact ? "is-compact" : ""}`}
      to={`/board/${issue.boardId}#${issue.id}`}
      title={`${issue.title} · ${issue.boardTitle}`}
    >
      <span className="workspace-issue-priority" />
      <span className="workspace-issue-copy">
        <strong>{issue.title}</strong>
        <span>
          {compact
            ? issue.boardTitle
            : `${issue.organizationName} / ${issue.boardTitle} · ${issue.sectionTitle}`}
        </span>
      </span>
      {!compact && (
        <span className="workspace-issue-due">
          {showDueDate && issue.dueDate
            ? new Date(issue.dueDate).toLocaleDateString()
            : issue.priority.toLowerCase()}
        </span>
      )}
    </Link>
  );
}

function EmptyState({
  title,
  description,
  linkTo,
  linkText,
}: {
  title: string;
  description: string;
  linkTo: string;
  linkText: string;
}) {
  return (
    <div className="focus-empty workspace-view-empty">
      <span aria-hidden="true">◌</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <Link className="quiet-button" to={linkTo}>
        {linkText}
      </Link>
    </div>
  );
}

function WorkspaceDock({ active }: { active: WorkspaceViewType }) {
  return (
    <nav className="board-dock" aria-label="Workspace navigation">
      <Link
        className={`dock-link ${active === "inbox" ? "is-active" : ""}`}
        to="/inbox"
        aria-current={active === "inbox" ? "page" : undefined}
      >
        <span aria-hidden="true">▣</span>
        Inbox
      </Link>
      <Link
        className={`dock-link ${active === "planner" ? "is-active" : ""}`}
        to="/planner"
        aria-current={active === "planner" ? "page" : undefined}
      >
        <span aria-hidden="true">◷</span>
        Planner
      </Link>
      <Link className="dock-link" to="/" aria-label="Workspaces">
        <span aria-hidden="true">▦</span>
        Workspaces
      </Link>
      <Link
        className={`dock-link ${active === "boards" ? "is-active" : ""}`}
        to="/boards"
        aria-current={active === "boards" ? "page" : undefined}
      >
        <span aria-hidden="true">⇄</span>
        Switch boards
      </Link>
    </nav>
  );
}
