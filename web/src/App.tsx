import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Deployments } from "./pages/Deployments";
import { Chat } from "./pages/Chat";

export function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <div className="container">
          <h1>Platform Engineer Agent</h1>
          <nav>
            <NavLink to="/" end className={({ isActive }) => isActive ? "active" : ""}>
              Dashboard
            </NavLink>
            <NavLink to="/deployments" className={({ isActive }) => isActive ? "active" : ""}>
              Deployments
            </NavLink>
            <NavLink to="/chat" className={({ isActive }) => isActive ? "active" : ""}>
              Chat
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/deployments" element={<Deployments />} />
          <Route path="/chat" element={<Chat />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
