import express from "express";
import cors from "cors";
import { prisma } from "@trello/db/client";
import jwt from "jsonwebtoken";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), ".env") });

const app = express();
const PORT = 3001;
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";
const allowedOrigins = [
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];
const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.BUN_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.BUN_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

// AUTH MIDDLEWARE
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

async function canEditBoard(boardId: string, userId: string) {
  const board = await prisma.board.findFirst({
    where: {
      id: boardId,
      deletedAt: null,
      OR: [
        {
          organization: {
            memberships: {
              some: { userId, accepted: true },
            },
          },
        },
        {
          members: {
            some: { userId, role: { in: ["EDITOR", "ADMIN"] } },
          },
        },
      ],
    },
    select: { id: true },
  });
  return Boolean(board);
}

async function canAccessBoard(boardId: string, userId: string) {
  const board = await prisma.board.findFirst({
    where: {
      id: boardId,
      deletedAt: null,
      OR: [
        {
          organization: {
            memberships: { some: { userId, accepted: true } },
          },
        },
        { members: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(board);
}

async function isOrganizationAdmin(organizationId: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { organizationId, userId, accepted: true, role: "ADMIN" },
    select: { id: true },
  });
  return Boolean(membership);
}

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

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "User created successfully",
      token,
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

    if (!user || !user.password || user.password !== password) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "Sign in successful",
      token,
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

app.post("/auth/oauth", async (req, res) => {
  const { accessToken } = req.body ?? {};

  if (typeof accessToken !== "string" || !accessToken) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: "Supabase is not configured on the server" });
    return;
  }

  try {
    const supabaseRes = await fetch(
      `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
      },
    );

    if (!supabaseRes.ok) {
      res.status(401).json({ error: "Invalid Supabase session" });
      return;
    }

    const supabaseUser = (await supabaseRes.json()) as {
      email?: string;
      user_metadata?: {
        full_name?: string;
        name?: string;
        avatar_url?: string;
        picture?: string;
      };
    };

    if (!supabaseUser.email) {
      res.status(400).json({ error: "Supabase user is missing an email" });
      return;
    }

    const name =
      supabaseUser.user_metadata?.full_name ||
      supabaseUser.user_metadata?.name ||
      null;
    const avatarUrl =
      supabaseUser.user_metadata?.avatar_url ||
      supabaseUser.user_metadata?.picture ||
      null;

    const user = await prisma.user.upsert({
      where: { email: supabaseUser.email },
      create: {
        email: supabaseUser.email,
        name,
        avatarUrl,
        password: null,
      },
      update: {
        ...(name ? { name } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      },
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "OAuth sign in successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to complete OAuth sign in" });
  }
});

// ORGANIZATIONS

app.post("/organization", authenticateToken, async (req, res) => {
  const { name, description } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "A workspace name is required" });
    return;
  }

  try {
    const userId = (req as any).user.userId as string;
    const organization = await prisma.$transaction(async (transaction) => {
      const created = await transaction.organization.create({
        data: {
          name: name.trim(),
          description:
            typeof description === "string" ? description.trim() || null : null,
        },
      });
      await transaction.membership.create({
        data: {
          userId,
          organizationId: created.id,
          role: "ADMIN",
          accepted: true,
          acceptedAt: new Date(),
        },
      });
      return created;
    });

    res.json(organization);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create organization" });
  }
});

app.get("/organizations", authenticateToken, async (req, res) => {
  const userId = (req as any).user.userId as string;

  try {
    const organizations = await prisma.organization.findMany({
      where: {
        memberships: {
          some: {
            userId,
            accepted: true,
          },
        },
        deletedAt: null,
      },
      include: {
        boards: {
          where: { deletedAt: null },
        },
        memberships: {
          where: { accepted: true },
          select: {
            id: true,
            userId: true,
            organizationId: true,
            role: true,
            accepted: true,
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
              },
            },
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

app.get("/organizations/invitations", authenticateToken, async (req, res) => {
  const { userId, email } = (req as any).user as {
    userId: string;
    email: string;
  };

  try {
    const invitations = await prisma.membership.findMany({
      where: {
        userId,
        accepted: false,
        invitedEmail: { equals: email, mode: "insensitive" },
        organization: { deletedAt: null },
      },
      include: {
        organization: {
          select: { id: true, name: true, description: true },
        },
      },
      orderBy: { invitedAt: "desc" },
    });
    res.json(invitations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch workspace invitations" });
  }
});

app.delete(
  "/organization/:organizationId",
  authenticateToken,
  async (req, res) => {
    const { organizationId } = req.params;

    try {
      if (
        !(await isOrganizationAdmin(organizationId, (req as any).user.userId))
      ) {
        res
          .status(403)
          .json({ error: "Only workspace admins can delete a workspace" });
        return;
      }
      await prisma.organization.update({
        where: { id: organizationId },
        data: { deletedAt: new Date() },
      });

      res.json({ message: "Organization deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete organization" });
    }
  },
);

//MEMBERSHIPS

app.post("/invite", authenticateToken, async (req, res) => {
  const { email, organizationId } = req.body ?? {};

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof organizationId !== "string"
  ) {
    res
      .status(400)
      .json({ error: "A valid email and organizationId are required" });
    return;
  }

  try {
    const currentUserId = (req as any).user.userId as string;
    if (!(await isOrganizationAdmin(organizationId, currentUserId))) {
      res
        .status(403)
        .json({ error: "Only workspace admins can invite members" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [user, organization] = await Promise.all([
      prisma.user.findUnique({ where: { email: normalizedEmail } }),
      prisma.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!organization) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    if (!user) {
      res.status(404).json({
        error: "Create an account with this email before inviting them",
      });
      return;
    }

    const existing = await prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
    });
    if (existing) {
      res.status(409).json({
        error: existing.accepted
          ? "This user is already a workspace member"
          : "An invitation has already been sent to this user",
      });
      return;
    }

    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId,
        invitedEmail: normalizedEmail,
      },
      select: {
        id: true,
        invitedEmail: true,
        invitedAt: true,
        organization: { select: { id: true, name: true } },
      },
    });
    res.json(membership);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to invite user" });
  }
});

app.post("/accept", authenticateToken, async (req, res) => {
  const { organizationId } = req.body ?? {};

  if (typeof organizationId !== "string") {
    res.status(400).json({ error: "organizationId is required" });
    return;
  }

  try {
    const { userId, email } = (req as any).user as {
      userId: string;
      email: string;
    };
    const invitation = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { id: true, accepted: true, invitedEmail: true },
    });
    if (
      !invitation ||
      invitation.invitedEmail?.toLowerCase() !== email.toLowerCase()
    ) {
      res
        .status(404)
        .json({ error: "No invitation was found for this account" });
      return;
    }
    if (invitation.accepted) {
      res
        .status(409)
        .json({ error: "This invitation has already been accepted" });
      return;
    }

    const membership = await prisma.membership.update({
      where: { id: invitation.id },
      data: {
        accepted: true,
        acceptedAt: new Date(),
      },
      select: {
        id: true,
        organizationId: true,
        role: true,
        organization: { select: { id: true, name: true, description: true } },
      },
    });

    res.json({ message: "Membership accepted", membership });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to accept membership" });
  }
});

app.delete("/membership", authenticateToken, async (req, res) => {
  const { organizationId, userId: requestedUserId } = req.body ?? {};

  if (typeof organizationId !== "string") {
    res.status(400).json({ error: "organizationId is required" });
    return;
  }

  try {
    const currentUserId = (req as any).user.userId as string;
    const userId =
      typeof requestedUserId === "string" ? requestedUserId : currentUserId;
    const isSelf = userId === currentUserId;
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { id: true, role: true, accepted: true },
    });
    if (!membership) {
      res.status(404).json({ error: "Workspace membership not found" });
      return;
    }
    if (
      !isSelf &&
      !(await isOrganizationAdmin(organizationId, currentUserId))
    ) {
      res
        .status(403)
        .json({ error: "Only workspace admins can remove other members" });
      return;
    }
    if (isSelf && membership.role === "ADMIN") {
      const adminCount = await prisma.membership.count({
        where: { organizationId, accepted: true, role: "ADMIN" },
      });
      if (adminCount === 1) {
        res.status(409).json({
          error:
            "Promote another workspace member before leaving as the last admin",
        });
        return;
      }
    }

    await prisma.membership.delete({
      where: { id: membership.id },
    });

    res.json({ message: "Membership deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete membership" });
  }
});

//BOARDS

app.get("/boards", authenticateToken, async (req, res) => {
  const { organizationId } = req.query;
  const userId = (req as any).user.userId as string;

  try {
    const boards = await prisma.board.findMany({
      where: {
        ...(organizationId && { organizationId: organizationId as string }),
        deletedAt: null,
        OR: [
          {
            organization: {
              memberships: { some: { userId, accepted: true } },
            },
          },
          { members: { some: { userId } } },
        ],
      },
      include: {
        sections: {
          orderBy: { position: "asc" },
          include: {
            issues: {
              orderBy: { position: "asc" },
              where: { deletedAt: null },
            },
          },
        },
        labels: true,
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(boards);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch boards" });
  }
});

app.get("/board/:boardId", authenticateToken, async (req, res) => {
  const { boardId } = req.params;

  try {
    const board = await prisma.board.findFirst({
      where: {
        id: boardId,
        deletedAt: null,
      },
      include: {
        sections: {
          orderBy: { position: "asc" },
          include: {
            issues: {
              orderBy: { position: "asc" },
              where: { deletedAt: null },
            },
          },
        },
        members: {
          include: {
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
          },
        },
        organization: {
          select: {
            memberships: {
              where: { accepted: true },
              select: {
                userId: true,
                role: true,
                user: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        labels: true,
      },
    });

    if (!board) {
      res.status(404).json({ error: "Board not found" });
      return;
    }
    if (!(await canAccessBoard(boardId, (req as any).user.userId))) {
      res.status(403).json({ error: "You do not have access to this board" });
      return;
    }

    res.json(board);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch board" });
  }
});

app.post("/board", authenticateToken, async (req, res) => {
  const { title, description, organizationId } = req.body ?? {};

  if (typeof title !== "string" || typeof organizationId !== "string") {
    res.status(400).json({ error: "title and organizationId are required" });
    return;
  }

  try {
    if (
      !(await isOrganizationAdmin(organizationId, (req as any).user.userId))
    ) {
      res
        .status(403)
        .json({ error: "Only workspace admins can create boards" });
      return;
    }
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

app.put("/board/:boardId", authenticateToken, async (req, res) => {
  const { boardId } = req.params;
  const { title, description, archivedAt } = req.body ?? {};

  try {
    if (!(await canEditBoard(boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }

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

app.delete("/board/:boardId", authenticateToken, async (req, res) => {
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

app.post("/board-member", authenticateToken, async (req, res) => {
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

app.put("/board-member/:memberId", authenticateToken, async (req, res) => {
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

app.post("/section", authenticateToken, async (req, res) => {
  const { title, boardId, position } = req.body ?? {};

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof boardId !== "string" ||
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0
  ) {
    res
      .status(400)
      .json({ error: "title, boardId, and position are required" });
    return;
  }

  try {
    if (!(await canEditBoard(boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }

    const section = await prisma.section.create({
      data: {
        title: title.trim(),
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

app.put("/section/:sectionId", authenticateToken, async (req, res) => {
  const { sectionId } = req.params;
  const { title, position } = req.body ?? {};

  try {
    const sectionAccess = await prisma.section.findUnique({
      where: { id: sectionId },
      select: { boardId: true },
    });
    if (!sectionAccess) {
      res.status(404).json({ error: "List not found" });
      return;
    }
    if (
      !(await canEditBoard(sectionAccess.boardId, (req as any).user.userId))
    ) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }
    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      res.status(400).json({ error: "title cannot be empty" });
      return;
    }

    const section = await prisma.section.update({
      where: { id: sectionId },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(position !== undefined && { position }),
      },
    });

    res.json(section);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update section" });
  }
});

app.get("/sections", authenticateToken, async (req, res) => {
  const { boardId } = req.query;

  if (typeof boardId !== "string") {
    res.status(400).json({ error: "boardId is required" });
    return;
  }
  try {
    if (!(await canAccessBoard(boardId, (req as any).user.userId))) {
      res.status(404).json({ error: "Board not found" });
      return;
    }
    const sections = await prisma.section.findMany({
      where: { boardId },
      orderBy: { position: "asc" },
      include: {
        issues: {
          orderBy: { position: "asc" },
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

app.delete("/section/:sectionId", authenticateToken, async (req, res) => {
  const { sectionId } = req.params;

  try {
    const sectionAccess = await prisma.section.findUnique({
      where: { id: sectionId },
      select: { boardId: true },
    });
    if (!sectionAccess) {
      res.status(404).json({ error: "List not found" });
      return;
    }
    if (
      !(await canEditBoard(sectionAccess.boardId, (req as any).user.userId))
    ) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }

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

app.post("/issue", authenticateToken, async (req, res) => {
  const {
    title,
    description,
    boardId,
    sectionId,
    position,
    priority,
    dueDate,
    startDate,
  } = req.body ?? {};

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof boardId !== "string" ||
    typeof sectionId !== "string" ||
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0
  ) {
    res
      .status(400)
      .json({ error: "title, boardId, sectionId, and position are required" });
    return;
  }

  try {
    const section = await prisma.section.findFirst({
      where: { id: sectionId, boardId },
      select: { id: true },
    });
    if (!section) {
      res.status(400).json({ error: "The list does not belong to this board" });
      return;
    }
    if (!(await canEditBoard(boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }

    const issue = await prisma.issue.create({
      data: {
        title: title.trim(),
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

app.put("/issue/move", authenticateToken, async (req, res) => {
  const { issueId, sectionId, position } = req.body ?? {};

  if (
    typeof issueId !== "string" ||
    typeof sectionId !== "string" ||
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0
  ) {
    res
      .status(400)
      .json({ error: "issueId, sectionId, and position are required" });
    return;
  }

  try {
    const moving = await prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
      select: { boardId: true, sectionId: true },
    });
    if (!moving) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const destination = await prisma.section.findFirst({
      where: { id: sectionId, boardId: moving.boardId },
      select: { id: true },
    });
    if (!destination) {
      res
        .status(400)
        .json({ error: "The destination list does not belong to this board" });
      return;
    }
    if (!(await canEditBoard(moving.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }

    const issue = await prisma.$transaction(async (transaction) => {
      const sourceIssues = await transaction.issue.findMany({
        where: { sectionId: moving.sectionId, deletedAt: null },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      const destinationIssues =
        moving.sectionId === sectionId
          ? sourceIssues
          : await transaction.issue.findMany({
              where: { sectionId, deletedAt: null },
              orderBy: { position: "asc" },
              select: { id: true },
            });

      if (moving.sectionId === sectionId) {
        const orderedIds = sourceIssues
          .map((issue) => issue.id)
          .filter((id) => id !== issueId);
        orderedIds.splice(Math.min(position, orderedIds.length), 0, issueId);
        await Promise.all(
          orderedIds.map((id, index) =>
            transaction.issue.update({
              where: { id },
              data: { position: index },
            }),
          ),
        );
      } else {
        const sourceIds = sourceIssues
          .map((issue) => issue.id)
          .filter((id) => id !== issueId);
        const destinationIds = destinationIssues.map((issue) => issue.id);
        destinationIds.splice(
          Math.min(position, destinationIds.length),
          0,
          issueId,
        );

        await Promise.all([
          ...sourceIds.map((id, index) =>
            transaction.issue.update({
              where: { id },
              data: { position: index },
            }),
          ),
          ...destinationIds.map((id, index) =>
            transaction.issue.update({
              where: { id },
              data: { sectionId, position: index },
            }),
          ),
        ]);
      }

      return transaction.issue.findUnique({ where: { id: issueId } });
    });

    res.json(issue);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to move issue" });
  }
});

app.put("/issue/:issueId", authenticateToken, async (req, res) => {
  const { issueId } = req.params;
  const {
    title,
    description,
    position,
    sectionId,
    priority,
    dueDate,
    startDate,
    completedAt,
  } = req.body ?? {};

  try {
    const issueAccess = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { boardId: true },
    });
    if (!issueAccess) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    if (!(await canEditBoard(issueAccess.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }
    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      res.status(400).json({ error: "title cannot be empty" });
      return;
    }

    const issue = await prisma.issue.update({
      where: { id: issueId },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(position !== undefined && { position }),
        ...(sectionId !== undefined && { sectionId }),
        ...(priority !== undefined && { priority }),
        ...(dueDate !== undefined && {
          dueDate: dueDate ? new Date(dueDate) : null,
        }),
        ...(startDate !== undefined && {
          startDate: startDate ? new Date(startDate) : null,
        }),
        ...(completedAt !== undefined && {
          completedAt: completedAt ? new Date(completedAt) : null,
        }),
      },
    });

    res.json(issue);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update issue" });
  }
});

app.get("/issues", authenticateToken, async (req, res) => {
  const { sectionId, boardId } = req.query;

  if (typeof boardId !== "string") {
    res.status(400).json({ error: "boardId is required" });
    return;
  }
  try {
    if (!(await canAccessBoard(boardId, (req as any).user.userId))) {
      res.status(404).json({ error: "Board not found" });
      return;
    }
    const issues = await prisma.issue.findMany({
      where: {
        ...(sectionId && { sectionId: sectionId as string }),
        boardId,
        deletedAt: null,
      },
      orderBy: { position: "asc" },
      include: {
        labels: {
          include: {
            label: true,
          },
        },
        comments: {
          where: { deletedAt: null },
          include: {
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
          },
        },
        issueMappings: {
          include: {
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
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

app.get("/issue/:issueId", authenticateToken, async (req, res) => {
  const { issueId } = req.params;

  try {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
          },
        },
        issueMappings: {
          include: {
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
          },
        },
        labels: { include: { label: true } },
        attachments: { orderBy: { createdAt: "desc" } },
        activities: {
          include: {
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (!(await canAccessBoard(issue.boardId, (req as any).user.userId))) {
      res.status(403).json({ error: "You do not have access to this board" });
      return;
    }

    res.json(issue);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch issue" });
  }
});

app.delete("/issue/:issueId", authenticateToken, async (req, res) => {
  const { issueId } = req.params;

  try {
    const issueAccess = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { boardId: true },
    });
    if (!issueAccess) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    if (!(await canEditBoard(issueAccess.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }

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

app.post("/issue-mapping", authenticateToken, async (req, res) => {
  const { userId, issueId } = req.body ?? {};

  if (typeof userId !== "string" || typeof issueId !== "string") {
    res.status(400).json({ error: "userId and issueId are required" });
    return;
  }

  try {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { boardId: true },
    });
    if (
      !issue ||
      !(await canAccessBoard(issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    if (!(await canEditBoard(issue.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this card" });
      return;
    }
    const board = await prisma.board.findUnique({
      where: { id: issue.boardId },
      select: {
        organization: {
          select: {
            memberships: {
              where: { userId, accepted: true },
              select: { id: true },
            },
          },
        },
        members: {
          where: { userId },
          select: { id: true },
        },
      },
    });
    if (
      !board ||
      (!board.organization.memberships.length && !board.members.length)
    ) {
      res
        .status(400)
        .json({ error: "Assignee must be a member of this board's workspace" });
      return;
    }
    const mapping = await prisma.issueMapping.create({
      data: {
        userId,
        issueId,
      },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
    });

    res.json(mapping);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to assign user to issue" });
  }
});

app.delete("/issue-mapping/:mappingId", authenticateToken, async (req, res) => {
  const { mappingId } = req.params;

  try {
    const mapping = await prisma.issueMapping.findUnique({
      where: { id: mappingId },
      select: { issue: { select: { boardId: true } } },
    });
    if (
      !mapping ||
      !(await canAccessBoard(mapping.issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    if (
      !(await canEditBoard(mapping.issue.boardId, (req as any).user.userId))
    ) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this card" });
      return;
    }
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

app.get("/labels", authenticateToken, async (req, res) => {
  const { boardId } = req.query;
  if (typeof boardId !== "string") {
    res.status(400).json({ error: "boardId is required" });
    return;
  }
  try {
    if (!(await canAccessBoard(boardId, (req as any).user.userId))) {
      res.status(404).json({ error: "Board not found" });
      return;
    }
    const labels = await prisma.label.findMany({
      where: { boardId },
      orderBy: { name: "asc" },
    });
    res.json(labels);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch labels" });
  }
});

app.post("/label", authenticateToken, async (req, res) => {
  const { name, color, boardId } = req.body ?? {};

  if (typeof name !== "string" || typeof boardId !== "string") {
    res.status(400).json({ error: "name and boardId are required" });
    return;
  }

  try {
    if (!(await canEditBoard(boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }
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

app.put("/label/:labelId", authenticateToken, async (req, res) => {
  const { labelId } = req.params;
  const { name, color } = req.body ?? {};

  try {
    const existing = await prisma.label.findUnique({
      where: { id: labelId },
      select: { boardId: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    if (!(await canEditBoard(existing.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }
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

app.delete("/label/:labelId", authenticateToken, async (req, res) => {
  const { labelId } = req.params;

  try {
    const existing = await prisma.label.findUnique({
      where: { id: labelId },
      select: { boardId: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    if (!(await canEditBoard(existing.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this board" });
      return;
    }
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

app.post("/issue-label", authenticateToken, async (req, res) => {
  const { issueId, labelId } = req.body ?? {};

  if (typeof issueId !== "string" || typeof labelId !== "string") {
    res.status(400).json({ error: "issueId and labelId are required" });
    return;
  }

  try {
    const [issue, label] = await Promise.all([
      prisma.issue.findUnique({
        where: { id: issueId },
        select: { boardId: true },
      }),
      prisma.label.findUnique({
        where: { id: labelId },
        select: { boardId: true },
      }),
    ]);
    if (!issue || !label || issue.boardId !== label.boardId) {
      res.status(404).json({ error: "Card or matching board label not found" });
      return;
    }
    if (!(await canEditBoard(issue.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this card" });
      return;
    }
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

app.delete("/issue-label", authenticateToken, async (req, res) => {
  const { issueId, labelId } = req.body ?? {};

  if (typeof issueId !== "string" || typeof labelId !== "string") {
    res.status(400).json({ error: "issueId and labelId are required" });
    return;
  }

  try {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { boardId: true },
    });
    if (
      !issue ||
      !(await canAccessBoard(issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    if (!(await canEditBoard(issue.boardId, (req as any).user.userId))) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this card" });
      return;
    }
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

app.post("/comment", authenticateToken, async (req, res) => {
  const { content, issueId } = req.body ?? {};

  if (typeof content !== "string" || typeof issueId !== "string") {
    res.status(400).json({ error: "content and issueId are required" });
    return;
  }

  try {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { boardId: true },
    });
    if (
      !issue ||
      !(await canAccessBoard(issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        userId: (req as any).user.userId,
        issueId,
      },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
    });

    res.json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

app.put("/comment/:commentId", authenticateToken, async (req, res) => {
  const { commentId } = req.params;
  const { content } = req.body ?? {};

  if (typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true, issue: { select: { boardId: true } } },
    });
    if (
      !existing ||
      !(await canAccessBoard(existing.issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    if (existing.userId !== (req as any).user.userId) {
      res.status(403).json({ error: "Only the comment author can edit it" });
      return;
    }
    const comment = await prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
    });

    res.json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update comment" });
  }
});

app.delete("/comment/:commentId", authenticateToken, async (req, res) => {
  const { commentId } = req.params;

  try {
    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true, issue: { select: { boardId: true } } },
    });
    if (
      !existing ||
      !(await canAccessBoard(existing.issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    if (existing.userId !== (req as any).user.userId) {
      res.status(403).json({ error: "Only the comment author can delete it" });
      return;
    }
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

app.post("/attachment", authenticateToken, async (req, res) => {
  const { fileName, fileUrl, mimeType, size, issueId } = req.body ?? {};

  if (
    typeof fileName !== "string" ||
    typeof fileUrl !== "string" ||
    typeof issueId !== "string"
  ) {
    res
      .status(400)
      .json({ error: "fileName, fileUrl, and issueId are required" });
    return;
  }

  try {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fileUrl);
    } catch {
      res.status(400).json({ error: "fileUrl must be a valid HTTP(S) URL" });
      return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: "fileUrl must use HTTP or HTTPS" });
      return;
    }
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { boardId: true },
    });
    if (
      !issue ||
      !(await canEditBoard(issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Card not found or not editable" });
      return;
    }
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

app.delete("/attachment/:attachmentId", authenticateToken, async (req, res) => {
  const { attachmentId } = req.params;

  try {
    const existing = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { issue: { select: { boardId: true } } },
    });
    if (
      !existing ||
      !(await canEditBoard(existing.issue.boardId, (req as any).user.userId))
    ) {
      res.status(404).json({ error: "Attachment not found or not editable" });
      return;
    }
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
  const activityActions = [
    "CREATED",
    "UPDATED",
    "MOVED",
    "ASSIGNED",
    "COMMENTED",
    "ATTACHED",
    "DELETED",
  ] as const;
  const validAction = activityActions.find((candidate) => candidate === action);

  if (!validAction) {
    res.status(400).json({ error: "A valid activity action is required" });
    return;
  }

  try {
    const activityLog = await prisma.activityLog.create({
      data: {
        action: validAction,
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
      orderBy: { createdAt: "desc" },
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
