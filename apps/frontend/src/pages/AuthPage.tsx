import { useState } from "react";
import { Navigate } from "react-router-dom";
import { api, type AuthUser } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export function AuthPage() {
  const { user, setSession } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleAuth = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await api<{ token: string; user: AuthUser }>(
        isLogin ? "/signin" : "/signup",
        undefined,
        {
          method: "POST",
          body: JSON.stringify(
            isLogin ? { email, password } : { email, password, name },
          ),
        },
      );
      setSession(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    setError("");
    if (!supabase) {
      setError(
        "Add BUN_PUBLIC_SUPABASE_URL and BUN_PUBLIC_SUPABASE_ANON_KEY to apps/frontend/.env",
      );
      return;
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (oauthError) {
      setError(oauthError.message);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Trello Build</p>
        <h1>{isLogin ? "Welcome back" : "Create your account"}</h1>
        <p className="muted">
          Use email, Google, or GitHub to get on the board.
        </p>

        <button
          className="oauth-btn"
          type="button"
          onClick={() => void handleOAuth("google")}
        >
          Continue with Google
        </button>
        <button
          className="oauth-btn"
          type="button"
          onClick={() => void handleOAuth("github")}
        >
          Continue with GitHub
        </button>
        {!isSupabaseConfigured && (
          <p className="hint">
            OAuth needs BUN_PUBLIC_SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in
            apps/frontend/.env.
          </p>
        )}
        {isSupabaseConfigured && (
          <p className="hint">
            Google and GitHub sign-in also need SUPABASE_URL and
            SUPABASE_PUBLISHABLE_KEY in apps/backend/.env.
          </p>
        )}

        <div className="divider">or</div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {!isLogin && (
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        {error && <p className="error">{error}</p>}
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => void handleAuth()}
        >
          {busy ? "Please wait..." : isLogin ? "Log in" : "Sign up"}
        </button>
        <button
          className="link"
          type="button"
          onClick={() => setIsLogin(!isLogin)}
        >
          {isLogin
            ? "Don't have an account? Sign up"
            : "Already have an account? Log in"}
        </button>
      </div>
    </div>
  );
}
