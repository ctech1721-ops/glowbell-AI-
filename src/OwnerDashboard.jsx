import React from "react";
export default function OwnerDashboard({ token, onLogout }) {
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;

    async function loadUsers() {
      try {
        const response = await fetch("/api/owner/users", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Could not load users.");
        }

        if (active) setUsers(result.users || []);
      } catch (err) {
        if (active) setError(err.message || "Could not load users.");
      } finally {
        if (active) setLoading(false);
      }
    }

    if (token) loadUsers();

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main style={{ padding: 32 }}>
      <h1>Glowbell Owner Dashboard</h1>
      <p>Total registered users: {users.length}</p>
      <button onClick={onLogout}>Logout</button>

      {loading && <p>Loading registered users...</p>}
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}

      {!loading && !error && (
        <div style={{ overflowX: "auto", marginTop: 24 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 12 }}>Email</th>
                <th style={{ textAlign: "left", padding: 12 }}>Account Created</th>
                <th style={{ textAlign: "left", padding: 12 }}>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={{ padding: 12 }}>{user.email}</td>
                  <td style={{ padding: 12 }}>
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleString()
                      : "Unavailable"}
                  </td>
                  <td style={{ padding: 12 }}>
                    {user.lastSignInAt
                      ? new Date(user.lastSignInAt).toLocaleString()
                      : "No login recorded"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
