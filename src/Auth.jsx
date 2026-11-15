
import { useState } from "react";
import { supabase } from "./supabaseClient";
import { Eye, EyeOff } from "lucide-react";
import GlobalLogo from "./GlobalLogo";

export default function Auth({ onLogin, onOwnerLogin }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [ownerToken, setOwnerToken] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    // Strong password validation for signup only
    if (
      mode === "signup" &&
      (
        password.length < 12 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[0-9]/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
      )
    ) {
      setError(
        "Password must have 12+ characters, uppercase, lowercase, number and symbol."
      );
      return;
    }

    if (mode === "signup" && !name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    setLoading(true);

   try {
  if (mode === "login") {
    console.log("OWNER LOGIN REQUEST STARTED");

    const ownerResponse = await fetch("/api/owner/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: cleanEmail,
        password,
      }),
    });

  const ownerResult = await ownerResponse.json();

  if (ownerResponse.ok && ownerResult.token) {
    onOwnerLogin(ownerResult.token);
    return;
  }

  if (cleanEmail === "ctech1721@gmail.com") {
    throw new Error(ownerResult.error || "Owner login failed.");
  }
}
      if (mode === "signup") {
        const { data, error: authError } =
          await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                full_name: name.trim(),
              },
            },
          });

        if (authError) throw authError;

        if (data.session) {
          onLogin(data.session.user);
        } else {
          setNotice(
            "Account created/requested. Check your email for verification, then log in."
          );
          setMode("login");
          setPassword("");
        }
      } else {
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

        if (authError) throw authError;

        onLogin(data.user);
      }
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="gx-auth">
      <form className="gx-auth-card" onSubmit={handleSubmit}>
        <GlobalLogo size={96} animate="loop" className="gx-auth-logo" />
        <h1>Global <b>AI</b></h1>
        <p className="gx-auth-sub">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </p>

        {mode === "signup" && (
          <>
            <label htmlFor="full-name">Full name</label>
            <input id="full-name" type="text" required value={name}
              onChange={(e) => setName(e.target.value)} autoComplete="name"
              placeholder="Enter your full name" />
          </>
        )}

        <label htmlFor="email">Email address</label>
        <input id="email" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email"
          placeholder="Enter your email" />

        <label htmlFor="password">Password</label>
        <div className="gx-pass-wrap">
          <input id="password" type={showPassword ? "text" : "password"} required value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 12 : 1}
            placeholder={mode === "signup" ? "12+ characters, number and symbol" : "Enter your password"} />
          <button type="button" className="gx-pass-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}>
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>

        {error && <p role="alert" className="gx-auth-error">{error}</p>}
        {notice && <p role="status" className="gx-auth-notice">{notice}</p>}

        <button className="gx-auth-submit" disabled={loading} type="submit">
          {loading ? "Please wait..." : mode === "signup" ? "Create account" : "Log in"}
        </button>

        <button className="gx-auth-switch" type="button"
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError(""); setNotice(""); setPassword("");
          }}>
          {mode === "signup" ? "Already have an account? Log in" : "New to Global AI? Create account"}
        </button>
      </form>
    </main>
  );
}
