import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AuthUser } from "../lib/api";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

export function AuthCallback() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function complete() {
      if (!supabase) {
        setError("Supabase is not configured");
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token) {
        setError(sessionError?.message || "No OAuth session found");
        return;
      }

      try {
        const result = await api<{ token: string; user: AuthUser }>("/auth/oauth", undefined, {
          method: "POST",
          body: JSON.stringify({ accessToken: data.session.access_token }),
        });
        if (!cancelled) {
          setSession(result.token, result.user);
          navigate("/", { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "OAuth exchange failed");
        }
      }
    }

    void complete();
    return () => {
      cancelled = true;
    };
  }, [navigate, setSession]);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Signing you in</h1>
        <p className="muted">{error || "Finishing Google / GitHub login..."}</p>
      </div>
    </div>
  );
}
