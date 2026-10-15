import express from "express";
import { prisma } from "@trello/db/client";

const app = express();
const PORT = 3001;

app.use(express.json());

// USER AUTH 

app.post("/signup", async (req, res) => {
  const { email, password, name } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        password,
        name: name || null,
      },
    });

    res.json({
      message: "User created successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to create user",
    });
  }
});

app.post("/signin", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.password !== password) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    res.json({
      message: "Sign in successful",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to sign in" });
  }
});

// ORGANIZATIONS

app.post("/organization", async (req, res) => {
  const { name, description, userId } = req.body ?? {};

  if (typeof name !== "string" || typeof userId !== "string") {
    res.status(400).json({ error: "name and userId are required" });
    return;
  }

  try {
    const organization = await prisma.organization.create({
      data: {
        name,
        description: description || null,
      },
    });

    // Create admin membership
    await prisma.membership.create({
      data: {
        userId,
        organizationId: organization.id,
        role: "ADMIN",
        accepted: true,
        acceptedAt: new Date(),
      },
    });

    res.json(organization);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create organization" });
  }
});

app.get("/organizations", async (req, res) => {
  const { userId } = req.query;

  try {
    const organizations = await prisma.organization.findMany({
      where: {
        ...(userId && {
          memberships: {
            some: {
              userId: userId as string,
              accepted: true,
            },
          },
        }),
        deletedAt: null,
      },
      include: {
        boards: {
          where: { deletedAt: null },
        },
        memberships: {
          include: {
            user: true,
          },
        },
      },
    });

    res.json(organizations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

app.delete("/organization/:organizationId", async (req, res) => {
  const { organizationId } = req.params;

  try {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: "Organization deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete organization" });
  }
});

//MEMBERSHIPS 

app.post("/invite", async (req, res) => {
  const { email, organizationId } = req.body ?? {};

  if (typeof email !== "string" || typeof organizationId !== "string") {
    res.status(400).json({ error: "email and organizationId are required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    let membership;

    if (user) {
      const existingMembership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId,
          },
        },
      });

      if (existingMembership) {
        res.status(400).json({ error: "User already a member" });
        return;
      }

      membership = await prisma.membership.create({
        data: {
          userId: user.id,
          organizationId,
          invitedEmail: email,
        },
        include: {
          user: true,
          organization: true,
        },
      });
    } else {
      membership = await prisma.membership.create({
        data: {
          userId: "pending",
          organizationId,
          invitedEmail: email,
        },
        include: {
          organization: true,
        },
      });
    }

    res.json(membership);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to invite user" });
  }
});

app.post("/accept", async (req, res) => {
  const { organizationId, userId } = req.body ?? {};

  if (typeof organizationId !== "string" || typeof userId !== "string") {
    res.status(400).json({ error: "organizationId and userId are required" });
    return;
  }

  try {
    const membership = await prisma.membership.update({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      data: {
        accepted: true,
        acceptedAt: new Date(),
      },
      include: {
        user: true,
        organization: true,
      },
    });

    res.json({ message: "Membership accepted", membership });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to accept membership" });
  }
});

app.delete("/membership", async (req, res) => {
  const { userId, organizationId } = req.body ?? {};

  if (typeof userId !== "string" || typeof organizationId !== "string") {
    res.status(400).json({ error: "userId and organizationId are required" });
    return;
  }

  try {
    await prisma.membership.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    res.json({ message: "Membership deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete membership" });
  }
});

//BOARDS 

app.get("/boards", async (req, res) => {
  const { organizationId } = req.query;

  try {
    const boards = await prisma.board.findMany({
      where: {
        ...(organizationId && { organizationId: organizationId as string }),
        deletedAt: null,
      },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            issues: {
              orderBy: { position: 'asc' },
              where: { deletedAt: null },
            },
          },
        },
        members: {
          include: {
            user: true,
          },
        },
        labels: true,
      },
    });

    res.json(boards);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch boards" });
  }
});

app.post("/board", async (req, res) => {
  const { title, description, organizationId } = req.body ?? {};

  if (typeof title !== "string" || typeof organizationId !== "string") {
    res.status(400).json({ error: "title and organizationId are required" });
    return;
  }

  try {
    const board = await prisma.board.create({
      data: {
        title,
        description: description || null,
        organizationId,
      },
    });

    res.json(board);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create board" });
  }
});

app.put("/board/:boardId", async (req, res) => {
  const { boardId } = req.params;
  const { title, description, archivedAt } = req.body ?? {};

  try {
    const board = await prisma.board.update({
      where: { id: boardId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(archivedAt !== undefined && { archivedAt }),
      },
    });

    res.json(board);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update board" });
  }
});

app.delete("/board/:boardId", async (req, res) => {
  const { boardId } = req.params;

  try {
    await prisma.board.update({
      where: { id: boardId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: "Board deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete board" });
  }
});

//BOARD MEMBERS

app.post("/board-member", async (req, res) => {
  const { userId, boardId, role } = req.body ?? {};

  if (typeof userId !== "string" || typeof boardId !== "string") {
    res.status(400).json({ error: "userId and boardId are required" });
    return;
  }

  try {
    const boardMember = await prisma.boardMember.create({
      data: {
        userId,
        boardId,
        role: role || "EDITOR",
      },
      include: {
        user: true,
      },
    });

    res.json(boardMember);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add board member" });
  }
});

app.put("/board-member/:memberId", async (req, res) => {
  const { memberId } = req.params;
  const { role } = req.body ?? {};

  if (!role) {
    res.status(400).json({ error: "role is required" });
    return;
  }

  try {
    const boardMember = await prisma.boardMember.update({
      where: { id: memberId },
      data: { role },
      include: {
        user: true,
      },
    });

    res.json(boardMember);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update board member" });
  }
});

app.delete("/board-member/:memberId", async (req, res) => {
  const { memberId } = req.params;

  try {
    await prisma.boardMember.delete({
      where: { id: memberId },
    });

    res.json({ message: "Board member removed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to remove board member" });
  }
});

// ==================== SECTIONS ====================

app.post("/section", async (req, res) => {
  const { title, boardId, position } = req.body ?? {};

  if (typeof title !== "string" || typeof boardId !== "string" || typeof position !== "number") {
    res.status(400).json({ error: "title, boardId, and position are required" });
    return;
  }

  try {
    const section = await prisma.section.create({
      data: {
        title,
        boardId,
        position,
      },
    });

    res.json(section);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create section" });
  }
});

app.put("/section/:sectionId", async (req, res) => {
  const { sectionId } = req.params;
  const { title, position } = req.body ?? {};

  try {
    const section = await prisma.section.update({
      where: { id: sectionId },
      data: {
        ...(title !== undefined && { title }),
        ...(position !== undefined && { position }),
      },
    });

    res.json(section);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update section" });
  }
});

app.get("/sections", async (req, res) => {
  const { boardId } = req.query;

  try {
    const sections = await prisma.section.findMany({
      where: boardId ? { boardId: boardId as string } : undefined,
      orderBy: { position: 'asc' },
      include: {
        issues: {
          orderBy: { position: 'asc' },
          where: { deletedAt: null },
        },
      },
    });

    res.json(sections);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch sections" });
  }
});

app.delete("/section/:sectionId", async (req, res) => {
  const { sectionId } = req.params;

  try {
    await prisma.section.delete({
      where: { id: sectionId },
    });

    res.json({ message: "Section deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete section" });
  }
});

// ISSUES 

app.post("/issue", async (req, res) => {
  const { title, description, boardId, sectionId, position, priority, dueDate, startDate } = req.body ?? {};

  if (typeof title !== "string" || typeof boardId !== "string" || typeof sectionId !== "string" || typeof position !== "number") {
    res.status(400).json({ error: "title, boardId, sectionId, and position are required" });
    return;
  }

  try {
    const issue = await prisma.issue.create({
      data: {
        title,
        description: description || null,
        boardId,
        sectionId,
        position,
        priority: priority || "MEDIUM",
        dueDate: dueDate ? new Date(dueDate) : null,
        startDate: startDate ? new Date(startDate) : null,
      },
    });

    res.json(issue);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create issue" });
  }
});

app.put("/issue/:issueId", async (req, res) => {
  const { issueId } = req.params;
  const { title, description, position, sectionId, priority, dueDate, startDate, completedAt } = req.body ?? {};

  try {
    const issue = await prisma.issue.update({
      where: { id: issueId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(position !== undefined && { position }),
        ...(sectionId !== undefined && { sectionId }),
        ...(priority !== undefined && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
      },
    });

    res.json(issue);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update issue" });
  }
});

app.put("/issue/move", async (req, res) => {
  const { issueId, sectionId, position } = req.body ?? {};

  if (typeof issueId !== "string" || typeof sectionId !== "string" || typeof position !== "number") {
    res.status(400).json({ error: "issueId, sectionId, and position are required" });
    return;
  }

  try {
    const issue = await prisma.issue.update({
      where: { id: issueId },
      data: {
        sectionId,
        position,
      },
    });

    res.json(issue);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to move issue" });
  }
});

app.get("/issues", async (req, res) => {
  const { sectionId, boardId } = req.query;

  try {
    const issues = await prisma.issue.findMany({
      where: {
        ...(sectionId && { sectionId: sectionId as string }),
        ...(boardId && { boardId: boardId as string }),
        deletedAt: null,
      },
      orderBy: { position: 'asc' },
      include: {
        labels: {
          include: {
            label: true,
          },
        },
        comments: {
          where: { deletedAt: null },
          include: { user: true },
        },
        issueMappings: {
          include: {
            user: true,
          },
        },
        attachments: true,
      },
    });

    res.json(issues);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

app.get("/issue/:issueId", async (req, res) => {
  const { issueId } = req.params;

  try {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        labels: {
          include: {
            label: true,
          },
        },
        comments: {
          where: { deletedAt: null },
          include: { user: true },
        },
        issueMappings: {
          include: {
            user: true,
          },
        },
        attachments: true,
        activities: {
          include: {
            user: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    res.json(issue);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch issue" });
  }
});

app.delete("/issue/:issueId", async (req, res) => {
  const { issueId } = req.params;

  try {
    await prisma.issue.update({
      where: { id: issueId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: "Issue deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete issue" });
  }
});

// ==================== ISSUE MAPPINGS (Assignments) ====================

app.post("/issue-mapping", async (req, res) => {
  const { userId, issueId } = req.body ?? {};

  if (typeof userId !== "string" || typeof issueId !== "string") {
    res.status(400).json({ error: "userId and issueId are required" });
    return;
  }

  try {
    const mapping = await prisma.issueMapping.create({
      data: {
        userId,
        issueId,
      },
      include: {
        user: true,
      },
    });

    res.json(mapping);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to assign user to issue" });
  }
});

app.delete("/issue-mapping/:mappingId", async (req, res) => {
  const { mappingId } = req.params;

  try {
    await prisma.issueMapping.delete({
      where: { id: mappingId },
    });

    res.json({ message: "Assignment removed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to remove assignment" });
  }
});

// ==================== LABELS ====================

app.post("/label", async (req, res) => {
  const { name, color, boardId } = req.body ?? {};

  if (typeof name !== "string" || typeof boardId !== "string") {
    res.status(400).json({ error: "name and boardId are required" });
    return;
  }

  try {
    const label = await prisma.label.create({
      data: {
        name,
        color: color || "#808080",
        boardId,
      },
    });

    res.json(label);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create label" });
  }
});

app.put("/label/:labelId", async (req, res) => {
  const { labelId } = req.params;
  const { name, color } = req.body ?? {};

  try {
    const label = await prisma.label.update({
      where: { id: labelId },
      data: {
        ...(name !== undefined && { name }),
        ...(color !== undefined && { color }),
      },
    });

    res.json(label);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update label" });
  }
});

app.delete("/label/:labelId", async (req, res) => {
  const { labelId } = req.params;

  try {
    await prisma.label.delete({
      where: { id: labelId },
    });

    res.json({ message: "Label deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete label" });
  }
});

// ==================== ISSUE LABELS ====================

app.post("/issue-label", async (req, res) => {
  const { issueId, labelId } = req.body ?? {};

  if (typeof issueId !== "string" || typeof labelId !== "string") {
    res.status(400).json({ error: "issueId and labelId are required" });
    return;
  }

  try {
    const issueLabel = await prisma.issueLabel.create({
      data: {
        issueId,
        labelId,
      },
      include: {
        label: true,
      },
    });

    res.json(issueLabel);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add label to issue" });
  }
});

app.delete("/issue-label", async (req, res) => {
  const { issueId, labelId } = req.body ?? {};

  if (typeof issueId !== "string" || typeof labelId !== "string") {
    res.status(400).json({ error: "issueId and labelId are required" });
    return;
  }

  try {
    await prisma.issueLabel.delete({
      where: {
        issueId_labelId: {
          issueId,
          labelId,
        },
      },
    });

    res.json({ message: "Label removed from issue successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to remove label from issue" });
  }
});

// ==================== COMMENTS ====================

app.post("/comment", async (req, res) => {
  const { content, userId, issueId } = req.body ?? {};

  if (typeof content !== "string" || typeof userId !== "string" || typeof issueId !== "string") {
    res.status(400).json({ error: "content, userId, and issueId are required" });
    return;
  }

  try {
    const comment = await prisma.comment.create({
      data: {
        content,
        userId,
        issueId,
      },
      include: {
        user: true,
      },
    });

    res.json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

app.put("/comment/:commentId", async (req, res) => {
  const { commentId } = req.params;
  const { content } = req.body ?? {};

  if (typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    const comment = await prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: {
        user: true,
      },
    });

    res.json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update comment" });
  }
});

app.delete("/comment/:commentId", async (req, res) => {
  const { commentId } = req.params;

  try {
    await prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

// ==================== ATTACHMENTS ====================

app.post("/attachment", async (req, res) => {
  const { fileName, fileUrl, mimeType, size, issueId } = req.body ?? {};

  if (typeof fileName !== "string" || typeof fileUrl !== "string" || typeof issueId !== "string") {
    res.status(400).json({ error: "fileName, fileUrl, and issueId are required" });
    return;
  }

  try {
    const attachment = await prisma.attachment.create({
      data: {
        fileName,
        fileUrl,
        mimeType: mimeType || null,
        size: size || null,
        issueId,
      },
    });

    res.json(attachment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create attachment" });
  }
});

app.delete("/attachment/:attachmentId", async (req, res) => {
  const { attachmentId } = req.params;

  try {
    await prisma.attachment.delete({
      where: { id: attachmentId },
    });

    res.json({ message: "Attachment deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

// ==================== ACTIVITY LOGS ====================

app.post("/activity-log", async (req, res) => {
  const { action, details, userId, issueId } = req.body ?? {};

  if (typeof action !== "string") {
    res.status(400).json({ error: "action is required" });
    return;
  }

  try {
    const activityLog = await prisma.activityLog.create({
      data: {
        action,
        details: details || null,
        userId: userId || null,
        issueId: issueId || null,
      },
      include: {
        user: true,
        issue: true,
      },
    });

    res.json(activityLog);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create activity log" });
  }
});

app.get("/activity-logs", async (req, res) => {
  const { issueId, userId } = req.query;

  try {
    const activityLogs = await prisma.activityLog.findMany({
      where: {
        ...(issueId && { issueId: issueId as string }),
        ...(userId && { userId: userId as string }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: true,
        issue: true,
      },
    });

    res.json(activityLogs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch activity logs" });
  }
});




app.listen(PORT, () => {
  console.log(`Server is listen on ${PORT}`);
});
