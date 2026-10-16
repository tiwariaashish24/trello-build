import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, type Board, type Issue, type Section, WS_URL } from "../lib/api";
import { useAuth } from "../lib/auth";
import { IssueDetailsModal } from "./IssueDetailsModal";

const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  return pointerHits.length > 0 ? pointerHits : closestCorners(args);
};

type BoardView = "board" | "inbox" | "planner";

function columnId(sectionId: string) {
  return `column-${sectionId}`;
}

function dateInputValue(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function BoardPage({ view }: { view: BoardView }) {
  const { boardId } = useParams();
  const location = useLocation();
  const { token, user, logout } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [users, setUsers] = useState<string[]>([]);
  const [sectionTitle, setSectionTitle] = useState("");
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [error, setError] = useState("");
  const [editingBoard, setEditingBoard] = useState(false);
  const [boardTitle, setBoardTitle] = useState("");
  const [savingBoard, setSavingBoard] = useState(false);
  const [detailsIssue, setDetailsIssue] = useState<Issue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (!token || !boardId) return;
    void fetchBoard();
  }, [token, boardId]);

  useEffect(() => {
    if (!board || !location.hash) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(decodeURIComponent(location.hash.slice(1)))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [board, location.hash]);

  useEffect(() => {
    if (!boardId || !token) return;
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", boardId, token }));
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type: string;
        users?: string[];
        userId?: string;
        message?: string;
      };
      if (data.type === "initial_state") setUsers(data.users ?? []);
      if (data.type === "join" && data.userId) {
        const userId = data.userId;
        setUsers((current) =>
          current.includes(userId) ? current : [...current, userId],
        );
      }
      if (data.type === "leave" && data.userId) {
        const userId = data.userId;
        setUsers((current) => current.filter((id) => id !== userId));
      }
      if (data.type === "error") {
        setError(data.message || "Could not connect to board presence");
      }
    };

    return () => ws.close();
  }, [boardId, token]);

  if (!user || !token) {
    return <Navigate to="/login" replace />;
  }

  const fetchBoard = async () => {
    if (!boardId) return;
    try {
      const data = await api<Board>(`/board/${boardId}`, token);
      setBoard(data);
      setBoardTitle(data.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    }
  };

  const createSection = async () => {
    const title = sectionTitle.trim();
    if (!board || !title) return;
    setError("");
    try {
      await api("/section", token, {
        method: "POST",
        body: JSON.stringify({
          title,
          boardId: board.id,
          position: board.sections.length,
        }),
      });
      setSectionTitle("");
      await fetchBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
    }
  };

  const updateSection = async (sectionId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("A list name is required.");
      return;
    }
    setError("");
    try {
      await api(`/section/${sectionId}`, token, {
        method: "PUT",
        body: JSON.stringify({ title: nextTitle }),
      });
      await fetchBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename list");
      throw err;
    }
  };

  const deleteSection = async (sectionId: string) => {
    setError("");
    try {
      await api(`/section/${sectionId}`, token, { method: "DELETE" });
      await fetchBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete list");
    }
  };

  const renameBoard = async () => {
    const title = boardTitle.trim();
    if (!board || !title) {
      setError("A board name is required.");
      return;
    }
    setSavingBoard(true);
    setError("");
    try {
      const updated = await api<Board>(`/board/${board.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ title }),
      });
      setBoard((current) =>
        current ? { ...current, title: updated.title } : current,
      );
      setBoardTitle(updated.title);
      setEditingBoard(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename board");
    } finally {
      setSavingBoard(false);
    }
  };

  const toggleComplete = async (issue: Issue) => {
    if (!board) return;
    const completedAt = issue.completedAt ? null : new Date().toISOString();
    setError("");
    setBoard({
      ...board,
      sections: board.sections.map((section) => ({
        ...section,
        issues: section.issues.map((item) =>
          item.id === issue.id ? { ...item, completedAt } : item,
        ),
      })),
    });
    try {
      await api(`/issue/${issue.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ completedAt }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update card");
      await fetchBoard();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const issue = board?.sections
      .flatMap((section) => section.issues)
      .find((item) => item.id === event.active.id);
    setActiveIssue(issue || null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveIssue(null);
    if (!over || !board || active.id === over.id) return;

    const fromSection = board.sections.find((section) =>
      section.issues.some((issue) => issue.id === active.id),
    );
    if (!fromSection) return;

    const overId = String(over.id);
    const toSection = overId.startsWith("column-")
      ? board.sections.find((section) => columnId(section.id) === overId)
      : board.sections.find(
          (section) =>
            section.issues.some((issue) => issue.id === overId) ||
            section.id === overId,
        );
    const moving = fromSection.issues.find((issue) => issue.id === active.id);
    if (!toSection || !moving) return;

    let destinationIssues: Issue[];
    let destinationIndex: number;
    const sameSection = fromSection.id === toSection.id;

    if (sameSection) {
      const oldIndex = fromSection.issues.findIndex(
        (issue) => issue.id === moving.id,
      );
      destinationIndex = fromSection.issues.findIndex(
        (issue) => issue.id === overId,
      );
      if (destinationIndex < 0)
        destinationIndex = fromSection.issues.length - 1;
      destinationIssues = arrayMove(
        fromSection.issues,
        oldIndex,
        destinationIndex,
      );
    } else {
      const remaining = toSection.issues;
      destinationIndex = remaining.findIndex((issue) => issue.id === overId);
      if (destinationIndex < 0) destinationIndex = remaining.length;
      destinationIssues = [
        ...remaining.slice(0, destinationIndex),
        { ...moving, sectionId: toSection.id },
        ...remaining.slice(destinationIndex),
      ];
    }

    const nextSections = board.sections.map((section) => {
      if (sameSection && section.id === fromSection.id) {
        return { ...section, issues: destinationIssues };
      }
      if (!sameSection && section.id === fromSection.id) {
        return {
          ...section,
          issues: section.issues.filter((issue) => issue.id !== moving.id),
        };
      }
      if (!sameSection && section.id === toSection.id) {
        return { ...section, issues: destinationIssues };
      }
      return section;
    });

    setError("");
    setBoard({ ...board, sections: nextSections });
    try {
      await api("/issue/move", token, {
        method: "PUT",
        body: JSON.stringify({
          issueId: moving.id,
          sectionId: toSection.id,
          position: destinationIndex,
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move card");
      await fetchBoard();
    }
  };

  return (
    <div className="app-shell board-shell">
      <header className="topbar board-topbar">
        <div className="topbar-left">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            <span>
              trello<span className="brand-light">build</span>
            </span>
          </Link>
          <span className="topbar-divider" aria-hidden="true" />
          <Link className="workspace-link" to="/">
            Workspaces
          </Link>
          <span className="board-context">{board?.title || "Board"}</span>
        </div>
        <div className="topbar-right">
          <span className="online-indicator">
            <i />
            {users.length} online
          </span>
          <span className="user-name">{user.name || user.email}</span>
          <button type="button" className="quiet-button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {error && (
        <div className="error banner" role="alert">
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

      {!board ? (
        <main className="page loading-state">
          <p className="muted">Loading board…</p>
        </main>
      ) : (
        <>
          <section className="board-heading">
            <div className="board-heading-copy">
              <p className="eyebrow">
                {view === "inbox"
                  ? "Card inbox"
                  : view === "planner"
                    ? "Due dates"
                    : "Workspace board"}
              </p>
              {editingBoard ? (
                <form
                  className="board-title-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameBoard();
                  }}
                >
                  <input
                    aria-label="Board name"
                    value={boardTitle}
                    onChange={(event) => setBoardTitle(event.target.value)}
                    autoFocus
                  />
                  <button
                    className="primary"
                    type="submit"
                    disabled={savingBoard}
                  >
                    {savingBoard ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => {
                      setBoardTitle(board.title);
                      setEditingBoard(false);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="board-title-row">
                  <h1>{board.title}</h1>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setEditingBoard(true)}
                  >
                    Rename
                  </button>
                </div>
              )}
              <p className="muted board-description">
                {view === "inbox"
                  ? "Open cards across this board, ready for your next step."
                  : view === "planner"
                    ? "Plan work by due date. Add or change dates from any card."
                    : board.description ||
                      "Keep your work moving. Drag cards between lists to update their status."}
              </p>
            </div>
            <div className="board-summary">
              <span>
                {board.sections.length}{" "}
                {board.sections.length === 1 ? "list" : "lists"}
              </span>
              <span className="summary-dot">·</span>
              <span>
                {board.sections.reduce(
                  (total, section) => total + section.issues.length,
                  0,
                )}{" "}
                cards
              </span>
            </div>
          </section>

          {view === "board" ? (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragEnd={(event) => void handleDragEnd(event)}
              onDragCancel={() => setActiveIssue(null)}
            >
              <main className="board-columns" aria-label="Board lists">
                {board.sections.map((section) => (
                  <KanbanColumn
                    key={section.id}
                    section={section}
                    token={token}
                    onChanged={fetchBoard}
                    onError={setError}
                    onRename={updateSection}
                    onDelete={deleteSection}
                    onToggleComplete={toggleComplete}
                    onOpenDetails={setDetailsIssue}
                  />
                ))}
                <form
                  className="column add-column"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createSection();
                  }}
                >
                  <label className="sr-only" htmlFor="new-list-title">
                    New list name
                  </label>
                  <input
                    id="new-list-title"
                    type="text"
                    placeholder="+ Add another list"
                    value={sectionTitle}
                    onChange={(event) => setSectionTitle(event.target.value)}
                  />
                  {sectionTitle.trim() && (
                    <button className="primary" type="submit">
                      Add list
                    </button>
                  )}
                </form>
              </main>
              <DragOverlay>
                {activeIssue ? (
                  <article className="card overlay-card">
                    <span className="card-priority" aria-hidden="true" />
                    <h3>{activeIssue.title}</h3>
                    {activeIssue.description && (
                      <p>{activeIssue.description}</p>
                    )}
                  </article>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : view === "inbox" ? (
            <InboxView board={board} onToggleComplete={toggleComplete} />
          ) : (
            <PlannerView board={board} onToggleComplete={toggleComplete} />
          )}
        </>
      )}
      {board && (
        <nav className="board-dock" aria-label="Board navigation">
          <Link
            className={`dock-link ${view === "inbox" ? "is-active" : ""}`}
            to="/inbox"
            aria-current={view === "inbox" ? "page" : undefined}
          >
            <span aria-hidden="true">▣</span>
            Inbox
          </Link>
          <Link
            className={`dock-link ${view === "planner" ? "is-active" : ""}`}
            to="/planner"
            aria-current={view === "planner" ? "page" : undefined}
          >
            <span aria-hidden="true">◷</span>
            Planner
          </Link>
          <Link
            className={`dock-link ${view === "board" ? "is-active" : ""}`}
            to={`/board/${board.id}`}
            aria-current={view === "board" ? "page" : undefined}
          >
            <span aria-hidden="true">▥</span>
            Board
          </Link>
          <Link className="dock-link" to="/boards" aria-label="Switch boards">
            <span aria-hidden="true">⇄</span>
            Switch boards
          </Link>
        </nav>
      )}
      {board && detailsIssue && (
        <IssueDetailsModal
          board={board}
          issue={detailsIssue}
          token={token}
          userId={user.id}
          onClose={() => setDetailsIssue(null)}
          onError={setError}
          onChanged={fetchBoard}
        />
      )}
    </div>
  );
}

function InboxView({
  board,
  onToggleComplete,
}: {
  board: Board;
  onToggleComplete: (issue: Issue) => Promise<void>;
}) {
  const issues = board.sections
    .flatMap((section) =>
      section.issues
        .filter((issue) => !issue.completedAt)
        .map((issue) => ({ ...issue, sectionTitle: section.title })),
    )
    .sort((a, b) => {
      const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

  return (
    <main className="focus-view inbox-view" aria-label="Inbox cards">
      <div className="focus-view-heading">
        <div>
          <p className="eyebrow">Needs attention</p>
          <h2>Open cards</h2>
        </div>
        <span className="focus-count">{issues.length}</span>
      </div>
      {issues.length ? (
        <div className="focus-card-list">
          {issues.map((issue) => (
            <article className="focus-card" key={issue.id}>
              <button
                className="completion-toggle"
                type="button"
                aria-label={`Mark "${issue.title}" complete`}
                onClick={() => void onToggleComplete(issue)}
              />
              <div className="focus-card-copy">
                <h3>{issue.title}</h3>
                <p>
                  {issue.sectionTitle} <span>·</span>{" "}
                  {issue.priority.toLowerCase()}
                  {issue.dueDate && (
                    <>
                      <span> · </span>
                      Due {new Date(issue.dueDate).toLocaleDateString()}
                    </>
                  )}
                </p>
              </div>
              <Link
                className="focus-card-link"
                to={`/board/${board.id}#${issue.id}`}
                title="Open this card on the board"
              >
                Open board <span aria-hidden="true">↗</span>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="focus-empty">
          <span aria-hidden="true">✓</span>
          <h3>Inbox is clear</h3>
          <p>New and unfinished cards on this board will show up here.</p>
          <Link className="quiet-button" to={`/board/${board.id}`}>
            Back to board
          </Link>
        </div>
      )}
    </main>
  );
}

function PlannerView({
  board,
  onToggleComplete,
}: {
  board: Board;
  onToggleComplete: (issue: Issue) => Promise<void>;
}) {
  const scheduled = board.sections
    .flatMap((section) =>
      section.issues
        .filter((issue) => issue.dueDate && !issue.completedAt)
        .map((issue) => ({ ...issue, sectionTitle: section.title })),
    )
    .sort(
      (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime(),
    );
  const groups = new Map<string, typeof scheduled>();
  for (const issue of scheduled) {
    const date = dateInputValue(issue.dueDate);
    const dayIssues = groups.get(date) ?? [];
    dayIssues.push(issue);
    groups.set(date, dayIssues);
  }

  return (
    <main className="focus-view planner-view" aria-label="Planner">
      <div className="focus-view-heading">
        <div>
          <p className="eyebrow">Scheduled work</p>
          <h2>Planner</h2>
        </div>
        <span className="focus-count">{scheduled.length}</span>
      </div>
      {groups.size ? (
        <div className="planner-days">
          {[...groups.entries()].map(([date, issues]) => (
            <section className="planner-day" key={date}>
              <h3>
                <time dateTime={date}>
                  {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
                <span>{issues.length}</span>
              </h3>
              <div className="focus-card-list">
                {issues.map((issue) => (
                  <article className="focus-card" key={issue.id}>
                    <button
                      className="completion-toggle"
                      type="button"
                      aria-label={`Mark "${issue.title}" complete`}
                      onClick={() => void onToggleComplete(issue)}
                    />
                    <div className="focus-card-copy">
                      <h3>{issue.title}</h3>
                      <p>{issue.sectionTitle}</p>
                    </div>
                    <Link
                      className="focus-card-link"
                      to={`/board/${board.id}#${issue.id}`}
                    >
                      Open board <span aria-hidden="true">↗</span>
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="focus-empty">
          <span aria-hidden="true">◷</span>
          <h3>Nothing planned yet</h3>
          <p>Add a due date to a card to see it in your planner.</p>
          <Link className="quiet-button" to={`/board/${board.id}`}>
            Schedule a card
          </Link>
        </div>
      )}
    </main>
  );
}

function KanbanColumn({
  section,
  token,
  onChanged,
  onError,
  onRename,
  onDelete,
  onToggleComplete,
  onOpenDetails,
}: {
  section: Section;
  token: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onRename: (sectionId: string, title: string) => Promise<void>;
  onDelete: (sectionId: string) => Promise<void>;
  onToggleComplete: (issue: Issue) => Promise<void>;
  onOpenDetails: (issue: Issue) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(section.id) });
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sectionName, setSectionName] = useState(section.title);
  const [busy, setBusy] = useState(false);
  const issueIds = useMemo(
    () => section.issues.map((issue) => issue.id),
    [section.issues],
  );

  const createIssue = async () => {
    const issueTitle = title.trim();
    if (!issueTitle) return;
    setBusy(true);
    onError("");
    try {
      await api("/issue", token, {
        method: "POST",
        body: JSON.stringify({
          title: issueTitle,
          boardId: section.boardId,
          sectionId: section.id,
          position: section.issues.length,
        }),
      });
      setTitle("");
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add card");
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = async () => {
    setBusy(true);
    try {
      await onRename(section.id, sectionName);
      setEditingTitle(false);
    } catch {
      // The parent displays the API error.
    } finally {
      setBusy(false);
    }
  };

  const removeSection = async () => {
    if (
      !window.confirm(
        `Delete "${section.title}" and all of its cards? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await onDelete(section.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`column ${isOver ? "is-over" : ""}`}
      aria-label={`${section.title} list`}
    >
      <header className="column-header">
        {editingTitle ? (
          <form
            className="column-title-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTitle();
            }}
          >
            <input
              aria-label="List name"
              value={sectionName}
              onChange={(event) => setSectionName(event.target.value)}
              autoFocus
            />
            <button type="submit" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setSectionName(section.title);
                setEditingTitle(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h2>{section.title}</h2>
            <span className="column-count">{section.issues.length}</span>
            <div className="column-menu">
              <button
                type="button"
                className="icon-button"
                aria-label={`Rename ${section.title}`}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="column-menu-popover">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditingTitle(true);
                    }}
                  >
                    Rename list
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() => void removeSection()}
                  >
                    Delete list
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </header>

      <div ref={setNodeRef} className="column-body">
        <SortableContext
          items={issueIds}
          strategy={verticalListSortingStrategy}
        >
          {section.issues.map((issue) => (
            <KanbanCard
              key={issue.id}
              issue={issue}
              token={token}
              onChanged={onChanged}
              onError={onError}
              onToggleComplete={onToggleComplete}
              onOpenDetails={onOpenDetails}
            />
          ))}
        </SortableContext>
        {section.issues.length === 0 && (
          <p className="empty-column">Drop a card here</p>
        )}
      </div>

      <form
        className="add-card-form"
        onSubmit={(event) => {
          event.preventDefault();
          void createIssue();
        }}
      >
        <label className="sr-only" htmlFor={`new-card-${section.id}`}>
          New card title
        </label>
        <input
          id={`new-card-${section.id}`}
          type="text"
          placeholder="+ Add a card"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy}
        />
        {title.trim() && (
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add card"}
          </button>
        )}
      </form>
    </section>
  );
}

function KanbanCard({
  issue,
  token,
  onChanged,
  onError,
  onToggleComplete,
  onOpenDetails,
}: {
  issue: Issue;
  token: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onToggleComplete: (issue: Issue) => Promise<void>;
  onOpenDetails: (issue: Issue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description || "");
  const [priority, setPriority] = useState(issue.priority);
  const [dueDate, setDueDate] = useState(dateInputValue(issue.dueDate));
  const [busy, setBusy] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    disabled: editing || busy,
  });

  const updateIssue = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      onError("A card title is required.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      await api(`/issue/${issue.id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          title: nextTitle,
          description: description.trim(),
          priority,
          dueDate: dueDate
            ? new Date(`${dueDate}T12:00:00`).toISOString()
            : null,
        }),
      });
      setEditing(false);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update card");
    } finally {
      setBusy(false);
    }
  };

  const deleteIssue = async () => {
    if (!window.confirm(`Delete "${issue.title}"?`)) return;
    setBusy(true);
    onError("");
    try {
      await api(`/issue/${issue.id}`, token, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      id={issue.id}
      ref={setNodeRef}
      className={`card ${isDragging ? "is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {editing ? (
        <form
          className="card-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void updateIssue();
          }}
        >
          <input
            aria-label="Card title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
          <textarea
            aria-label="Card description"
            placeholder="Add a description…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="card-edit-fields">
            <label>
              Priority
              <select
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as Issue["priority"])
                }
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
          </div>
          <div className="card-actions">
            <button className="primary" type="submit" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setTitle(issue.title);
                setDescription(issue.description || "");
                setPriority(issue.priority);
                setDueDate(dateInputValue(issue.dueDate));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            className="drag-handle"
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag card"
          >
            ⠿
          </button>
          <span className="card-priority" aria-hidden="true" />
          <h3>{issue.title}</h3>
          {issue.description && <p>{issue.description}</p>}
          <div className="card-meta">
            {issue.dueDate && (
              <span>Due {new Date(issue.dueDate).toLocaleDateString()}</span>
            )}
            <span
              className={`priority-label priority-${issue.priority.toLowerCase()}`}
            >
              {issue.priority.toLowerCase()}
            </span>
            {issue.completedAt && (
              <span className="card-complete-label">Complete</span>
            )}
          </div>
          <div className="card-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onToggleComplete(issue)}
            >
              {issue.completedAt ? "Reopen" : "Complete"}
            </button>
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" onClick={() => onOpenDetails(issue)}>
              Details
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => void deleteIssue()}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </article>
  );
}
