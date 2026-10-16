import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import jwt from "jsonwebtoken";
import { prisma } from "@trello/db/client";
import { WebSocket, WebSocketServer } from "ws";

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../backend/.env"),
});

const PORT = Number(process.env.WS_PORT) || 3002;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET must be set in apps/backend/.env before starting the websocket server",
  );
}

type RoomMember = {
  socket: WebSocket;
  userId: string;
};

const rooms = new Map<string, Map<WebSocket, RoomMember>>();
const socketRooms = new Map<WebSocket, string>();
const server = new WebSocketServer({ port: PORT });

function send(socket: WebSocket, message: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function removeFromRoom(socket: WebSocket) {
  const boardId = socketRooms.get(socket);
  if (!boardId) return;

  const room = rooms.get(boardId);
  const member = room?.get(socket);
  socketRooms.delete(socket);
  if (!room || !member) return;

  room.delete(socket);
  const userStillPresent = [...room.values()].some(
    (roomMember) => roomMember.userId === member.userId,
  );
  if (!userStillPresent) {
    for (const roomMember of room.values()) {
      send(roomMember.socket, { type: "leave", userId: member.userId });
    }
  }
  if (room.size === 0) rooms.delete(boardId);
}

server.on("connection", (socket) => {
  socket.on("message", async (data) => {
    let message: { type?: string; boardId?: string; token?: string };
    try {
      message = JSON.parse(data.toString());
    } catch {
      send(socket, { type: "error", message: "Invalid websocket message" });
      socket.close(1003, "Invalid message");
      return;
    }

    if (message.type !== "join") return;
    if (socketRooms.has(socket)) removeFromRoom(socket);
    if (
      typeof message.boardId !== "string" ||
      typeof message.token !== "string"
    ) {
      send(socket, {
        type: "error",
        message: "A board and session token are required",
      });
      socket.close(1008, "Authentication required");
      return;
    }

    let userId: string;
    try {
      const payload = jwt.verify(message.token, JWT_SECRET);
      if (typeof payload === "string" || typeof payload.userId !== "string") {
        throw new Error("Invalid session");
      }
      userId = payload.userId;
    } catch {
      send(socket, {
        type: "error",
        message: "Your session is invalid or expired",
      });
      socket.close(1008, "Invalid session");
      return;
    }

    try {
      const board = await prisma.board.findFirst({
        where: {
          id: message.boardId,
          deletedAt: null,
          OR: [
            {
              organization: {
                memberships: { some: { userId, accepted: true } },
              },
            },
            {
              members: { some: { userId } },
            },
          ],
        },
        select: { id: true },
      });
      if (!board) {
        send(socket, {
          type: "error",
          message: "You do not have access to this board",
        });
        socket.close(1008, "Board access denied");
        return;
      }

      const boardId = message.boardId;
      let room = rooms.get(boardId);
      if (!room) {
        room = new Map();
        rooms.set(boardId, room);
      }

      const alreadyPresent = [...room.values()].some(
        (roomMember) => roomMember.userId === userId,
      );
      room.set(socket, { socket, userId });
      socketRooms.set(socket, boardId);
      send(socket, {
        type: "initial_state",
        users: [
          ...new Set([...room.values()].map((roomMember) => roomMember.userId)),
        ],
      });
      if (!alreadyPresent) {
        for (const roomMember of room.values()) {
          if (roomMember.socket !== socket) {
            send(roomMember.socket, { type: "join", userId });
          }
        }
      }
    } catch (error) {
      console.error("Websocket board join failed:", error);
      send(socket, { type: "error", message: "Could not join this board" });
      socket.close(1011, "Could not join board");
    }
  });

  socket.on("close", () => removeFromRoom(socket));
  socket.on("error", (error) => {
    console.error("Websocket connection error:", error);
    removeFromRoom(socket);
  });
});

server.on("listening", () => {
  console.log(`Websocket server listening on port ${PORT}`);
});
