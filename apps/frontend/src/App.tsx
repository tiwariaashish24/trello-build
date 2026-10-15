import { APITester } from "./APITester";
import "./index.css";
import {Routes, Route, BrowserRouter, useParams} from "react-router-dom"

import logo from "./logo.svg";
import reactLogo from "./react.svg";
import { useEffect, useState } from "react";

export function App() {
  return (
    <div className="app">
      <BrowserRouter>
      <Routes>
        <Route path="/board/:boardId" element={<Board />}></Route>
      </Routes>
      
      </BrowserRouter>
  
    </div>
  );
}

function Board() {
  const [users, setUsers] = useState([]);

  const {boardId }= useParams();

  useEffect(() => {
    if (!boardId) return;

    const ws = new WebSocket("ws://localhost:3002");

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "join",
        boardId: boardId
      }));
    };

    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "initial_state"){
        setUsers(data.users.map(userId => ({id: userId})));
      }

      if(data.type === "join"){
        setUsers(u => [...u, {id: data.userId}]);
      }

      if(data.type === "leave"){
        setUsers(u => u.filter(x => x.id != data.userId));
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      ws.close();
    };
  }, [boardId])



  return <div>
    You are on board {boardId}

    Currently active users - {JSON.stringify(users)}
  </div>
}






export default App;
