
import { useState, useEffect } from "react";
import { auth } from "./apiClient";
import { Eye, EyeOff } from "lucide-react";
import GlobalLogo from "./GlobalLogo";

export default function Auth({ onLogin, onOwnerLogin, recovery = false, onRecoveryDone }) {
  const [mode, setMode] = useState(recovery ? "reset" : "signup");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [ownerToken, setOwnerToken] = useState("");

  useEffect(() => {
    if (recovery) { setMode("reset"); setError(""); setNotice(""); }
  }, [recovery]);

  const strongPassword = (p) =>
    p.length >= 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

  async function handleForgot() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { setError("Please enter your email address."); return; }
    setLoading(true);
    try {
      await auth.forgotPassword(cleanEmail);
      setNotice("Password reset link sent. Open the link in your email to set a new password.");
    } catch (err) {
      setError(err.message || "Could not send reset email.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!strongPassword(password)) {
      setError("Password must have 12+ characters, uppercase, lowercase, number and symbol.");
      return;
    }
    if (password !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }
    setLoading(true);
    try {
      const resetToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") || "";
      await auth.resetPassword(resetToken, password);
      auth.signOut();
      try { window.history.replaceState(null, "", window.location.pathname); } catch {}
      setPassword("");
      setConfirmPassword("");
      setMode("login");
      setNotice("Password updated successfully. Please log in with your new password.");
      onRecoveryDone?.();
    } catch (err) {
      setError(err.message || "Could not update password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (mode === "forgot") { await handleForgot(); return; }
    if (mode === "reset") { await handleReset(); return; }

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
        const user = await auth.signUp({ email: cleanEmail, password, name: name.trim() });
        onLogin(user);
      } else {
        const user = await auth.signIn({ email: cleanEmail, password });
        onLogin(user);
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
          {mode === "signup" ? "Create your account"
            : mode === "forgot" ? "Reset your password"
            : mode === "reset" ? "Set a new password"
            : "Welcome back"}
        </p>

        {mode === "signup" && (
          <>
            <label htmlFor="full-name">Full name</label>
            <input id="full-name" type="text" required value={name}
              onChange={(e) => setName(e.target.value)} autoComplete="name"
              placeholder="Enter your full name" />
          </>
        )}

        {mode !== "reset" && (
          <>
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              placeholder="Enter your email" />
          </>
        )}

        {mode !== "forgot" && (<>
        <label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</label>
        <div className="gx-pass-wrap">
          <input id="password" type={showPassword ? "text" : "password"} required value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" || mode === "reset" ? "new-password" : "current-password"}
            minLength={mode === "signup" || mode === "reset" ? 12 : 1}
            placeholder={mode === "signup" || mode === "reset" ? "12+ characters, number and symbol" : "Enter your password"} />
          <button type="button" className="gx-pass-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}>
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>

        {mode === "reset" && (
          <>
            <label htmlFor="confirm-password">Confirm password</label>
            <div className="gx-pass-wrap">
              <input id="confirm-password" type={showPassword ? "text" : "password"} required
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password" placeholder="Re-enter new password" />
            </div>
          </>
        )}

        {mode === "login" && (
          <button className="gx-auth-switch" type="button" style={{ marginTop: 0, textAlign: "right" }}
            onClick={() => { setMode("forgot"); setError(""); setNotice(""); setPassword(""); }}>
            Forgot password?
          </button>
        )}
        </>)}

        {error && <p role="alert" className="gx-auth-error">{error}</p>}
        {notice && <p role="status" className="gx-auth-notice">{notice}</p>}

        <button className="gx-auth-submit" disabled={loading} type="submit">
          {loading ? "Please wait..." : mode === "signup" ? "Create account"
            : mode === "forgot" ? "Send reset link"
            : mode === "reset" ? "Submit" : "Log in"}
        </button>

        {mode !== "reset" && (
          <button className="gx-auth-switch" type="button"
            onClick={() => {
              setMode(mode === "signup" || mode === "forgot" ? "login" : "signup");
              setError(""); setNotice(""); setPassword("");
            }}>
            {mode === "signup" ? "Already have an account? Log in"
              : mode === "forgot" ? "Back to log in"
              : "New to Global AI? Create account"}
          </button>
        )}
      </form>
    </main>
  );
}
