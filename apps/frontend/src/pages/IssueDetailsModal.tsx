import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type AuthUser,
  type Board,
  type Issue,
  type IssueDetails,
  type Label,
} from "../lib/api";

type Props = {
  board: Board;
  issue: Issue;
  token: string;
  userId: string;
  onClose: () => void;
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
};

function displayName(user: AuthUser) {
  return user.name || user.email;
}

export function IssueDetailsModal({
  board,
  issue,
  token,
  userId,
  onClose,
  onError,
  onChanged,
}: Props) {
  const [details, setDetails] = useState<IssueDetails | null>(null);
  const [labels, setLabels] = useState<Label[]>(board.labels ?? []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#8c7acb");
  const [assigneeId, setAssigneeId] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");

  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const [issueDetails, boardLabels] = await Promise.all([
        api<IssueDetails>(`/issue/${issue.id}`, token),
        api<Label[]>(`/labels?boardId=${encodeURIComponent(board.id)}`, token),
      ]);
      setDetails(issueDetails);
      setLabels(boardLabels);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Could not load card details",
      );
    } finally {
      setLoading(false);
    }
  }, [board.id, issue.id, onError, token]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const members = useMemo(() => {
    const candidates = [
      ...(board.organization?.memberships ?? []),
      ...(board.members ?? []),
    ];
    return [
      ...new Map(
        candidates.map((member) => [member.user.id, member.user]),
      ).values(),
    ];
  }, [board.members, board.organization?.memberships]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    onError("");
    try {
      await action();
      await loadDetails();
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update card");
    } finally {
      setBusy("");
    }
  };

  const addComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = commentText.trim();
    if (!content) return;
    await runAction("comment", async () => {
      await api("/comment", token, {
        method: "POST",
        body: JSON.stringify({ issueId: issue.id, content }),
      });
      setCommentText("");
    });
  };

  const saveComment = async (commentId: string) => {
    const content = editingCommentText.trim();
    if (!content) {
      onError("A comment cannot be empty.");
      return;
    }
    await runAction(`comment-${commentId}`, async () => {
      await api(`/comment/${commentId}`, token, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      setEditingCommentId(null);
      setEditingCommentText("");
    });
  };

  const createLabel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newLabel.trim();
    if (!name) return;
    await runAction("label", async () => {
      const label = await api<Label>("/label", token, {
        method: "POST",
        body: JSON.stringify({
          boardId: board.id,
          name,
          color: newLabelColor,
        }),
      });
      await api("/issue-label", token, {
        method: "POST",
        body: JSON.stringify({ issueId: issue.id, labelId: label.id }),
      });
      setNewLabel("");
    });
  };

  const assignMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assigneeId) return;
    await runAction("assignee", async () => {
      await api("/issue-mapping", token, {
        method: "POST",
        body: JSON.stringify({ issueId: issue.id, userId: assigneeId }),
      });
      setAssigneeId("");
    });
  };

  const addAttachment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fileName = attachmentName.trim();
    const fileUrl = attachmentUrl.trim();
    if (!fileName || !fileUrl) return;
    await runAction("attachment", async () => {
      await api("/attachment", token, {
        method: "POST",
        body: JSON.stringify({ issueId: issue.id, fileName, fileUrl }),
      });
      setAttachmentName("");
      setAttachmentUrl("");
    });
  };

  return (
    <div
      className="card-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="card-details-title"
        aria-modal="true"
        className="card-details-modal"
        role="dialog"
      >
        <header className="card-modal-header">
          <div>
            <p className="eyebrow">{board.title}</p>
            <h2 id="card-details-title">{issue.title}</h2>
          </div>
          <button
            aria-label="Close card details"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        {loading && !details ? (
          <p className="muted">Loading card details…</p>
        ) : details ? (
          <div className="card-details-content">
            <section className="card-detail-section">
              <h3>Labels</h3>
              <div className="detail-label-list">
                {details.labels.map(({ label }) => (
                  <span
                    className="detail-label"
                    key={label.id}
                    style={{ borderColor: label.color, color: label.color }}
                  >
                    {label.name}
                    <button
                      aria-label={`Remove ${label.name} label`}
                      disabled={busy === `remove-label-${label.id}`}
                      onClick={() =>
                        void runAction(`remove-label-${label.id}`, async () => {
                          await api("/issue-label", token, {
                            method: "DELETE",
                            body: JSON.stringify({
                              issueId: issue.id,
                              labelId: label.id,
                            }),
                          });
                        })
                      }
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {!details.labels.length && (
                  <span className="muted">No labels on this card.</span>
                )}
              </div>
              <div className="detail-label-options">
                {labels
                  .filter(
                    (label) =>
                      !details.labels.some(
                        (entry) => entry.labelId === label.id,
                      ),
                  )
                  .map((label) => (
                    <button
                      className="label-option"
                      key={label.id}
                      onClick={() =>
                        void runAction(`add-label-${label.id}`, async () => {
                          await api("/issue-label", token, {
                            method: "POST",
                            body: JSON.stringify({
                              issueId: issue.id,
                              labelId: label.id,
                            }),
                          });
                        })
                      }
                      style={{ borderColor: label.color, color: label.color }}
                      type="button"
                    >
                      + {label.name}
                    </button>
                  ))}
              </div>
              <form className="detail-inline-form" onSubmit={createLabel}>
                <input
                  aria-label="New label name"
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder="Create a label"
                  value={newLabel}
                />
                <input
                  aria-label="New label color"
                  className="label-color-input"
                  onChange={(event) => setNewLabelColor(event.target.value)}
                  type="color"
                  value={newLabelColor}
                />
                <button
                  disabled={!newLabel.trim() || busy === "label"}
                  type="submit"
                >
                  Add
                </button>
              </form>
            </section>

            <section className="card-detail-section">
              <h3>Members</h3>
              <div className="detail-member-list">
                {details.issueMappings.map((assignment) => (
                  <div className="detail-member" key={assignment.id}>
                    <span className="member-avatar">
                      {displayName(assignment.user).slice(0, 1).toUpperCase()}
                    </span>
                    <span>{displayName(assignment.user)}</span>
                    <button
                      aria-label={`Unassign ${displayName(assignment.user)}`}
                      disabled={busy === `unassign-${assignment.id}`}
                      onClick={() =>
                        void runAction(
                          `unassign-${assignment.id}`,
                          async () => {
                            await api(
                              `/issue-mapping/${assignment.id}`,
                              token,
                              {
                                method: "DELETE",
                              },
                            );
                          },
                        )
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {!details.issueMappings.length && (
                  <span className="muted">No members assigned.</span>
                )}
              </div>
              <form className="detail-inline-form" onSubmit={assignMember}>
                <select
                  aria-label="Assign a member"
                  onChange={(event) => setAssigneeId(event.target.value)}
                  value={assigneeId}
                >
                  <option value="">Choose a workspace member</option>
                  {members
                    .filter(
                      (member) =>
                        !details.issueMappings.some(
                          (assignment) => assignment.userId === member.id,
                        ),
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {displayName(member)}
                      </option>
                    ))}
                </select>
                <button
                  disabled={!assigneeId || busy === "assignee"}
                  type="submit"
                >
                  Assign
                </button>
              </form>
            </section>

            <section className="card-detail-section">
              <h3>Attachments</h3>
              <div className="detail-attachment-list">
                {details.attachments.map((attachment) => (
                  <div className="detail-attachment" key={attachment.id}>
                    <a
                      href={attachment.fileUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      ↗ {attachment.fileName}
                    </a>
                    <button
                      aria-label={`Remove ${attachment.fileName}`}
                      disabled={busy === `attachment-${attachment.id}`}
                      onClick={() =>
                        void runAction(
                          `attachment-${attachment.id}`,
                          async () => {
                            await api(`/attachment/${attachment.id}`, token, {
                              method: "DELETE",
                            });
                          },
                        )
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {!details.attachments.length && (
                  <span className="muted">No attachments added.</span>
                )}
              </div>
              <form className="detail-attachment-form" onSubmit={addAttachment}>
                <input
                  aria-label="Attachment name"
                  onChange={(event) => setAttachmentName(event.target.value)}
                  placeholder="Link name"
                  value={attachmentName}
                />
                <input
                  aria-label="Attachment URL"
                  onChange={(event) => setAttachmentUrl(event.target.value)}
                  placeholder="https://…"
                  type="url"
                  value={attachmentUrl}
                />
                <button
                  disabled={
                    !attachmentName.trim() ||
                    !attachmentUrl.trim() ||
                    busy === "attachment"
                  }
                  type="submit"
                >
                  Add link
                </button>
              </form>
            </section>

            <section className="card-detail-section">
              <h3>Comments</h3>
              <div className="detail-comment-list">
                {details.comments.map((comment) => (
                  <article className="detail-comment" key={comment.id}>
                    <header>
                      <strong>{displayName(comment.user)}</strong>
                      <time dateTime={comment.createdAt}>
                        {new Date(comment.createdAt).toLocaleString()}
                      </time>
                    </header>
                    {editingCommentId === comment.id ? (
                      <div className="detail-comment-edit">
                        <textarea
                          aria-label="Edit comment"
                          onChange={(event) =>
                            setEditingCommentText(event.target.value)
                          }
                          value={editingCommentText}
                        />
                        <button
                          disabled={busy === `comment-${comment.id}`}
                          onClick={() => void saveComment(comment.id)}
                          type="button"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingCommentId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p>{comment.content}</p>
                    )}
                    {comment.userId === userId &&
                      editingCommentId !== comment.id && (
                        <div className="detail-comment-actions">
                          <button
                            onClick={() => {
                              setEditingCommentId(comment.id);
                              setEditingCommentText(comment.content);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            disabled={busy === `delete-comment-${comment.id}`}
                            onClick={() =>
                              void runAction(
                                `delete-comment-${comment.id}`,
                                async () => {
                                  await api(`/comment/${comment.id}`, token, {
                                    method: "DELETE",
                                  });
                                },
                              )
                            }
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                  </article>
                ))}
                {!details.comments.length && (
                  <span className="muted">No comments yet.</span>
                )}
              </div>
              <form className="detail-comment-form" onSubmit={addComment}>
                <textarea
                  aria-label="Write a comment"
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder="Write a comment…"
                  value={commentText}
                />
                <button
                  disabled={!commentText.trim() || busy === "comment"}
                  type="submit"
                >
                  Comment
                </button>
              </form>
            </section>
          </div>
        ) : (
          <p className="muted">Card details are unavailable.</p>
        )}
      </section>
    </div>
  );
}
