import { useCallback, useEffect, useMemo, useState } from "react";

const formatDate = (value) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function OwnerDashboard({ token, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/owner/usage", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load users.");
      setData(result);
      setError("");
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err.message || "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Owner session missing. Log in with the owner email from the main login page.");
      return undefined;
    }
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [token, load]);

  const users = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.users || [])
      .filter((user) => !q || `${user.email} ${user.name || ""}`.toLowerCase().includes(q))
      .sort((a, b) => (b.lastSeenAt || b.lastSignInAt || "").localeCompare(a.lastSeenAt || a.lastSignInAt || ""));
  }, [data, query]);

  const loggedInUsers = users.filter((user) => user.lastSignInAt).length;

  return (
    <main className="gx-owner">
      <header className="gx-owner-head">
        <div>
          <h1>Global Owner Dashboard</h1>
          <p>
            User login details and last used date
            {updatedAt && <> · Updated {updatedAt.toLocaleTimeString()}</>}
          </p>
        </div>
        <div className="gx-owner-head-actions">
          <button type="button" onClick={load}>Refresh</button>
          <button type="button" onClick={onLogout}>Logout</button>
        </div>
      </header>

      {error && <p role="alert" className="gx-owner-alert">{error}</p>}
      {loading && <p className="gx-owner-muted">Loading users…</p>}

      {!loading && !error && (
        <>
          <section className="gx-owner-cards">
            <div><small>Total registered users</small><strong>{data?.totalUsers ?? users.length}</strong></div>
            <div><small>Users who have logged in</small><strong>{loggedInUsers}</strong></div>
            <div><small>Users never logged in</small><strong>{users.length - loggedInUsers}</strong></div>
          </section>

          <section className="gx-owner-toolbar">
            <input
              className="gx-owner-search"
              type="search"
              placeholder="Search user by name or email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </section>

          <h2 className="gx-owner-sub">User login details</h2>
          <div className="gx-owner-table-wrap">
            <table className="gx-owner-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Last login date</th>
                  <th>Last date used</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={3} className="gx-owner-muted">No users found.</td></tr>
                )}
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name || user.email.split("@")[0] || "User"}</strong>
                      <small>{user.email}</small>
                    </td>
                    <td>{formatDateTime(user.lastSignInAt)}</td>
                    <td>{formatDate(user.lastSeenAt || user.lastSignInAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
