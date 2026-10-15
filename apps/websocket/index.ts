import { WebSocket, WebSocketServer } from "ws";
import { prisma } from "@trello/db/client";

const server = new WebSocketServer({port: 3002});

const ROOMS: any = {};



server.on("connection", (socket) =>{
    socket.on("message", (data) =>{
        const parsedData = JSON.parse(data);

        if(parsedData.type === "join"){
            const boardId = parsedData.boardId;

            if(!ROOMS[boardId]) {
                ROOMS[boardId] = [];
            }
            const newUserId = Math.random();
            ROOMS[boardId].push({userId: newUserId,  socket: socket})

            console.log(`User ${newUserId} joined board ${boardId}. Total users: ${ROOMS[boardId].length}`);

            for (let i =0; i < ROOMS[boardId].length; i++){
                const user = ROOMS[boardId][i];
                if (user.socket !== socket) {
                    user.socket.send(JSON.stringify({
                        type: "join",
                        userId: newUserId
                    }))
                }

            }

            const initialState = {
                type: "initial_state",
                users: ROOMS[boardId].map(u => u.userId)
            };
            console.log("Sending initial state:", initialState);
            socket.send(JSON.stringify(initialState))
        }
    })

    socket.on("close", () => {
      Object.entries(ROOMS).map(([roomId, users]) => {
        const userExist = users.find(u => u.socket === socket)
        if(userExist) {
            ROOMS[roomId] = users.filter(x => x.socket !== socket);
            ROOMS[roomId].forEach(({socket: userSocket}) => userSocket.send(JSON.stringify({
                type: "leave",
                userId: userExist.userId
            })))
        }
 
      })
    })
})