
import { useState } from "react";
import { supabase } from "./supabaseClient";

export default function Auth({ onLogin, onOwnerLogin }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f8faff",
        color: "#202033",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 420,
          boxSizing: "border-box",
          padding: 28,
          borderRadius: 20,
          background: "#fff",
          boxShadow: "0 8px 40px #29204a18",
        }}
      >
        <h1 style={{ marginTop: 0 }}>Global AI</h1>

        <p>
          {mode === "signup"
            ? "Create your account"
            : "Welcome back"}
        </p>

        {mode === "signup" && (
          <>
            <label htmlFor="full-name">Full name</label>
            <input
              id="full-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              style={fieldStyle}
              placeholder="Enter your full name"
            />
          </>
        )}

        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          style={fieldStyle}
          placeholder="Enter your email"
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={
            mode === "signup"
              ? "new-password"
              : "current-password"
          }
          style={fieldStyle}
          minLength={mode === "signup" ? 12 : 1}
          placeholder={
            mode === "signup"
              ? "12+ characters, number and symbol"
              : "Enter your password"
          }
        />

        {error && (
          <p role="alert" style={{ color: "#b42318" }}>
            {error}
          </p>
        )}

        {notice && (
          <p role="status" style={{ color: "#067647" }}>
            {notice}
          </p>
        )}

        <button
          disabled={loading}
          type="submit"
          style={{
            width: "100%",
            marginTop: 18,
            padding: 13,
            border: 0,
            borderRadius: 10,
            color: "white",
            background: "#7c3aed",
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading
            ? "Please wait..."
            : mode === "signup"
            ? "Create account"
            : "Log in"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError("");
            setNotice("");
            setPassword("");
          }}
          style={{
            marginTop: 14,
            width: "100%",
            padding: 10,
            border: 0,
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {mode === "signup"
            ? "Already have an account? Log in"
            : "New to Global AI? Create account"}
        </button>
      </form>
    </main>
  );
}

const fieldStyle = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  margin: "6px 0 16px",
  padding: 12,
  border: "1px solid #d8d8e2",
  borderRadius: 9,
  background: "#fff",
  color: "#202033",
};
