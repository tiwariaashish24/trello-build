import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { AuthCallback } from "./pages/AuthCallback";
import { AuthPage } from "./pages/AuthPage";
import { BoardPage } from "./pages/BoardPage";
import { Dashboard } from "./pages/Dashboard";
import "./index.css";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/board/:boardId"
            element={<BoardPage view="board" />}
          />
          <Route
            path="/board/:boardId/inbox"
            element={<BoardPage view="inbox" />}
          />
          <Route
            path="/board/:boardId/planner"
            element={<BoardPage view="planner" />}
          />
          <Route path="/" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
