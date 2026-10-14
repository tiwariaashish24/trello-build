import express from "express";
import { prisma } from "@trello/db/client";

const app = express();
const PORT = 3000;

app.use(express.json());

app.post("/signup", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  try {
    const user = await prisma.user.create({
      data: {
        username,
        password,
      },
    });

    res.json({
      message: "User created successfully",
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to create user",
    });
  }
});

app.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
    },
  });

  res.json({ users });
});

app.listen(PORT, () => {
  console.log(`Server is listen on ${PORT}`);
});
