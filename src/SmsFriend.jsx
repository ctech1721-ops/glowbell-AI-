import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, Search, UserPlus, Send, Paperclip, Image as ImageIcon, Film, ArrowLeft,
  Trash2, MessageCircle, Play, Download, Users, Loader2, Check, Ban, Clock, ShieldOff, FileText, Inbox,
} from "lucide-react";
import { api, apiBytes } from "./apiClient";

/* =====================================================================
   SMS Friend — private chat between two Global AI users.
   Text, photos and videos. Completely separate from the AI chat.
   Database: neon/schema.sql (served through /api/sms/*)
   ===================================================================== */

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const MAX_FILE = 50 * 1024 * 1024;

const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const fileExt = (name) => ((name || "").split(".").pop() || "").slice(0, 5).toUpperCase();

const isMissingTable = (err) => err && /does not exist|relation .* missing/i.test(err.message || "");

// Files are stored in Neon in <= 3 MB parts; download them and rebuild one Blob.
const mediaBlobCache = new Map();
async function fetchMediaBlob(m) {
  if (mediaBlobCache.has(m.media_path)) return mediaBlobCache.get(m.media_path);
  const parts = [];
  for (let i = 0; i < Math.max(1, m.media_parts || 1); i += 1) {
    parts.push(await apiBytes(`/api/sms/media/${m.media_path}/${i}`));
  }
  const blob = new Blob(parts, { type: m.media_content_type || "application/octet-stream" });
  mediaBlobCache.set(m.media_path, blob);
  return blob;
}

const initials = (name, email) =>
  (name || email || "?").trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";

const timeOf = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayOf = (iso) => {
  const d = new Date(iso);
  const n = new Date();
  const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, n)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

/** Unread counters, usable even while the SMS window is closed. */
export function useSmsUnread(userId) {
  const [incoming, setIncoming] = useState([]);
  const [reads, setReads] = useState({});
  const [requestCount, setRequestCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    try { setReads(JSON.parse(localStorage.getItem(`global-sms-read-${userId}`) || "{}")); } catch { setReads({}); }
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await api("/api/sms/unread");
      setIncoming(data.incoming || []);
      setRequestCount(data.requestCount || 0);
    } catch { /* offline or not set up — try again on the next poll */ }
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    refresh();
    // Neon has no realtime push, so poll (also refresh when the tab becomes visible again).
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 10000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, refresh]);

  const counts = useMemo(() => {
    const out = {};
    for (const m of incoming) {
      if (Date.parse(m.created_at) > Date.parse(reads[m.sender_id] || 0)) out[m.sender_id] = (out[m.sender_id] || 0) + 1;
    }
    return out;
  }, [incoming, reads]);

  const messageTotal = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  // sidebar badge = unread messages + friend requests waiting for an answer
  const total = messageTotal + requestCount;

  const markRead = useCallback((friendId) => {
    setReads((prev) => {
      const next = { ...prev, [friendId]: new Date().toISOString() };
      try { localStorage.setItem(`global-sms-read-${userId}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [userId]);

  return { counts, total, requestCount, markRead, refresh };
}

export default function SmsFriend({ user, onClose, sms }) {
  const me = user.id;
  const [friends, setFriends] = useState([]);
  const [incomingReqs, setIncomingReqs] = useState([]);
  const [sentReqs, setSentReqs] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showReqs, setShowReqs] = useState(false);
  const [reqSetupNeeded, setReqSetupNeeded] = useState(false);
  const [busyReq, setBusyReq] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [urls, setUrls] = useState({});
  const urlsRef = useRef({});
  urlsRef.current = urls;
  const loadingMediaRef = useRef(new Set());
  const [text, setText] = useState("");
  const [pending, setPending] = useState([]); // [{file, preview, kind}]
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState("chat");
  const [view, setView] = useState("list"); // phone: list | chat
  const [filter, setFilter] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [lightbox, setLightbox] = useState(null); // {url, kind}
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const activeRef = useRef(null);
  activeRef.current = activeId;

  const active = friends.find((f) => f.friend_id === activeId) || null;

  const loadFriends = useCallback(async () => {
    try {
      const { friends: data } = await api("/api/sms/friends");
      setLoadingFriends(false);
      setFriends(data || []);
    } catch (error) {
      setLoadingFriends(false);
      if (isMissingTable(error)) {
        console.error("SMS FRIENDS ERROR:", error);
        setSetupNeeded(true);
      } else setNotice(error.message);
    }
  }, [me]);

  const loadRequests = useCallback(async () => {
    try {
      const data = await api("/api/sms/requests");
      setReqSetupNeeded(false);
      setIncomingReqs(data.incoming || []);
      setSentReqs(data.sent || []);
      setBlocked(data.blocked || []);
    } catch (error) {
      if (isMissingTable(error)) { console.error("SMS REQUESTS ERROR:", error); setReqSetupNeeded(true); return; }
      console.error("SMS REQUESTS LOAD ERROR:", error);
      setNotice(`Could not load requests: ${error.message}`);
    }
  }, [me]);

  useEffect(() => { loadFriends(); loadRequests(); }, [loadFriends, loadRequests]);

  // keep requests / new friends fresh while the window is open
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") { loadFriends(); loadRequests(); } }, 6000);
    return () => window.clearInterval(timer);
  }, [me, loadFriends, loadRequests]);

  // Download image/video parts once and show them from local blob: URLs.
  const signMedia = useCallback(async (list) => {
    const wanted = list.filter((m) => m.media_path && m.media_type !== "file");
    for (const m of wanted) {
      if (urlsRef.current[m.media_path] || loadingMediaRef.current.has(m.media_path)) continue;
      loadingMediaRef.current.add(m.media_path);
      fetchMediaBlob(m).then((blob) => {
        setUrls((cur) => ({ ...cur, [m.media_path]: URL.createObjectURL(blob) }));
      }).catch((error) => console.error("SMS media load error:", error.message))
        .finally(() => loadingMediaRef.current.delete(m.media_path));
    }
  }, []);

  const loadMessages = useCallback(async (friendId) => {
    if (!friendId) return;
    let data;
    try {
      ({ messages: data } = await api(`/api/sms/messages/${friendId}`));
    } catch (error) { setNotice(error.message); return; }
    if (activeRef.current !== friendId) return;
    setMessages((prev) => (prev.length === (data || []).length && prev.at(-1)?.id === data?.at(-1)?.id ? prev : data || []));
    signMedia(data || []);
  }, [me, signMedia]);

  // open a friend: load, mark read, keep fresh
  useEffect(() => {
    if (!activeId) { setMessages([]); return undefined; }
    setMessages([]);
    loadMessages(activeId);
    sms.markRead(activeId);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") { loadMessages(activeId); sms.markRead(activeId); } }, 3000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, me]);

  useEffect(() => { if (tab === "chat") bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, tab, activeId]);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") { if (lightbox) setLightbox(null); else onClose(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose, lightbox]);

  async function addFriend(e) {
    e.preventDefault();
    const email = addEmail.trim().toLowerCase();
    if (!email || adding) return;
    setAdding(true); setNotice("");
    let row;
    try {
      ({ result: row } = await api("/api/sms/requests", { method: "POST", body: { email } }));
    } catch (error) {
      setAdding(false);
      if (isMissingTable(error)) { setReqSetupNeeded(true); setShowReqs(true); setNotice("Friend requests are not set up yet. Open “Requests” below and follow the steps."); }
      else setNotice(error.message);
      return;
    }
    setAdding(false);
    setAddEmail("");
    await Promise.all([loadFriends(), loadRequests()]);
    sms.refresh();
    if (row?.out_status === "sent") {
      setNotice(`Request sent to ${row.out_name || row.out_email}. You can chat once they accept.`);
    } else if (row?.out_id) {
      setActiveId(row.out_id); setView("chat"); setTab("chat");
    }
  }

  async function answerRequest(req, action) {
    if (action === "block" && !window.confirm(`Block ${req.requester_name || req.requester_email}? They will not be able to send you requests or messages.`)) return;
    setBusyReq(req.id); setNotice("");
    try {
      await api(`/api/sms/requests/${req.id}/respond`, { method: "POST", body: { action } });
    } catch (error) { setBusyReq(""); setNotice(error.message); return; }
    setBusyReq("");
    await Promise.all([loadFriends(), loadRequests()]);
    sms.refresh();
    if (action === "accept") { setShowReqs(false); setActiveId(req.requester_id); setView("chat"); setTab("chat"); }
  }

  async function blockActive() {
    if (!active) return;
    if (!window.confirm(`Block ${active.friend_name || active.friend_email}? They will be removed from your friends and cannot message you.`)) return;
    try {
      await api("/api/sms/block", { method: "POST", body: { userId: active.friend_id } });
    } catch (error) { setNotice(error.message); return; }
    setActiveId(null); setView("list");
    await Promise.all([loadFriends(), loadRequests()]);
  }

  async function unblock(b) {
    try {
      await api("/api/sms/unblock", { method: "POST", body: { userId: b.blocked_id } });
    } catch (error) { setNotice(error.message); return; }
    loadRequests();
  }

  function pickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const next = [];
    for (const file of files) {
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";
      const max = kind === "image" ? MAX_IMAGE : kind === "video" ? MAX_VIDEO : MAX_FILE;
      if (file.size > max) {
        setNotice(`${file.name} is too large (max ${kind === "image" ? "10 MB for photos" : "50 MB"}).`);
        continue;
      }
      next.push({ file, kind, preview: kind === "file" ? "" : URL.createObjectURL(file), key: crypto.randomUUID() });
    }
    if (next.length) { setNotice(""); setPending((p) => [...p, ...next].slice(0, 6)); }
  }

  function dropPending(i) {
    setPending((p) => { if (p[i]?.preview) URL.revokeObjectURL(p[i].preview); return p.filter((_, idx) => idx !== i); });
  }

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if ((!body && !pending.length) || !active || sending) return;
    setSending(true); setNotice("");
    try {
      if (pending.length) {
        for (let i = 0; i < pending.length; i += 1) {
          const { file, kind } = pending[i];
          const { id, partSize } = await api("/api/sms/media", {
            method: "POST",
            body: { receiverId: active.friend_id, contentType: file.type || "application/octet-stream", size: file.size },
          });
          const chunk = Math.min(partSize || 3145728, 3145728);
          for (let offset = 0, idx = 0; offset < file.size; offset += chunk, idx += 1) {
            await apiBytes(`/api/sms/media/${id}/${idx}`, { method: "PUT", body: file.slice(offset, offset + chunk) });
          }
          await api("/api/sms/messages", {
            method: "POST",
            body: {
              receiverId: active.friend_id, body: i === 0 ? body || null : null,
              mediaId: id, mediaType: kind, mediaName: file.name.slice(0, 200), mediaSize: file.size,
            },
          });
        }
        pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
        setPending([]);
      } else {
        await api("/api/sms/messages", { method: "POST", body: { receiverId: active.friend_id, body } });
      }
      setText("");
      await loadMessages(active.friend_id);
    } catch (err) {
      setNotice(err.message || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(m) {
    if (!window.confirm("Delete this message for everyone?")) return;
    try {
      await api(`/api/sms/messages/${m.id}`, { method: "DELETE" });
    } catch (error) { setNotice(error.message); return; }
    if (m.media_path) mediaBlobCache.delete(m.media_path);
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
  }

  const visibleFriends = friends.filter((f) =>
    `${f.friend_name || ""} ${f.friend_email}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => (sms.counts[b.friend_id] || 0) - (sms.counts[a.friend_id] || 0));
  const photos = messages.filter((m) => m.media_type === "image");
  const videos = messages.filter((m) => m.media_type === "video");
  const docs = messages.filter((m) => m.media_type === "file");

  const renderMedia = (m, className = "") => {
    if (m.media_type === "file") {
      return (
        <button type="button" className={`gx-sms-file ${className}`} onClick={() => downloadFile(m)} title="Download">
          <span className="gx-sms-file-ic"><FileText size={22} /><em>{fileExt(m.media_name)}</em></span>
          <span className="gx-sms-file-meta"><strong>{m.media_name || "File"}</strong><small>{sizeOf(m.media_size)}</small></span>
          <Download size={18} />
        </button>
      );
    }
    const url = urls[m.media_path];
    if (!url) return <div className={`gx-sms-media-ph ${className}`}><Loader2 size={20} className="gx-spin" /></div>;
    return m.media_type === "image" ? (
      <button type="button" className={`gx-sms-media ${className}`} onClick={() => setLightbox({ url, kind: "image" })}>
        <img src={url} alt="Shared" loading="lazy" />
      </button>
    ) : (
      <button type="button" className={`gx-sms-media is-video ${className}`} onClick={() => setLightbox({ url, kind: "video" })}>
        <video src={`${url}#t=0.1`} preload="metadata" muted playsInline />
        <span className="gx-sms-play"><Play size={22} fill="currentColor" /></span>
      </button>
    );
  };

  async function downloadFile(m) {
    let data;
    try { data = await fetchMediaBlob(m); } catch (error) { setNotice(error.message || "Could not download the file."); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url; a.download = m.media_name || "file"; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  let lastDay = "";

  return (
    <div className="gx-sms" role="dialog" aria-modal="true" aria-label="SMS Friend">
      <div className={`gx-sms-shell is-${view}`}>
        {/* ---------- friends ---------- */}
        <aside className="gx-sms-list">
          <header>
            <div><MessageCircle size={20} /><strong>SMS Friend</strong></div>
            <button type="button" onClick={onClose} aria-label="Close SMS Friend"><X size={20} /></button>
          </header>

          <form className="gx-sms-add" onSubmit={addFriend}>
            <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)}
              placeholder="Enter email to send request" aria-label="Friend's email" />
            <button type="submit" disabled={adding || !addEmail.trim()} title="Send friend request" aria-label="Send friend request">
              {adding ? <Loader2 size={18} className="gx-spin" /> : <UserPlus size={18} />}
            </button>
          </form>

          <label className="gx-sms-search"><Search size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search friends" aria-label="Search friends" />
          </label>

          {notice && !active && <p className="gx-sms-notice" role="alert">{notice}</p>}

          {!setupNeeded && (
            <button type="button" className={`gx-sms-reqbtn${showReqs ? " is-on" : ""}`} onClick={() => { setShowReqs(true); setView("chat"); setNotice(""); loadRequests(); }}>
              <Inbox size={16} /> Requests
              {incomingReqs.length > 0 && <b className="gx-sms-badge">{incomingReqs.length}</b>}
            </button>
          )}

          <div className="gx-sms-friends">
            {setupNeeded ? (
              <div className="gx-sms-empty is-setup">
                <strong>One-time setup needed</strong>
                <p>The database is not set up yet. Run <code>neon/schema.sql</code> in the Neon SQL Editor, then reload this page.</p>
              </div>
            ) : loadingFriends ? (
              <div className="gx-sms-empty"><Loader2 className="gx-spin" /></div>
            ) : visibleFriends.length === 0 ? (
              <div className="gx-sms-empty"><Users size={26} /><p>{friends.length ? "No friends match." : "No friends yet. Enter an email above to send a friend request."}</p></div>
            ) : visibleFriends.map((f) => (
              <button type="button" key={f.friend_id}
                className={`gx-sms-friend${f.friend_id === activeId ? " is-active" : ""}`}
                onClick={() => { setShowReqs(false); setActiveId(f.friend_id); setView("chat"); setTab("chat"); setNotice(""); }}>
                <span className="gx-sms-av">{initials(f.friend_name, f.friend_email)}</span>
                <span className="gx-sms-who"><strong>{f.friend_name || f.friend_email.split("@")[0]}</strong><small>{f.friend_email}</small></span>
                {sms.counts[f.friend_id] > 0 && <b className="gx-sms-badge">{sms.counts[f.friend_id]}</b>}
              </button>
            ))}
          </div>

          {!setupNeeded && !reqSetupNeeded && blocked.length > 0 && (
            <div className="gx-sms-blocked">
              <button type="button" onClick={() => setShowBlocked((v) => !v)}><ShieldOff size={14} /> Blocked users ({blocked.length})</button>
              {showBlocked && blocked.map((b) => (
                <div key={b.blocked_id} className="gx-sms-blocked-row">
                  <span>{b.blocked_name || b.blocked_email}</span>
                  <button type="button" onClick={() => unblock(b)}>Unblock</button>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* ---------- conversation ---------- */}
        <section className="gx-sms-chat">
          {showReqs ? (
            <div className="gx-sms-reqpage">
              <header className="gx-sms-head">
                <button type="button" className="gx-sms-back" onClick={() => { setShowReqs(false); setView("list"); }} aria-label="Back"><ArrowLeft size={20} /></button>
                <span className="gx-sms-av"><Inbox size={19} /></span>
                <div className="gx-sms-who"><strong>Friend requests</strong><small>{incomingReqs.length ? `${incomingReqs.length} waiting for you` : "Nothing new"}</small></div>
                <button type="button" className="gx-sms-close" onClick={() => setShowReqs(false)} aria-label="Close requests"><X size={20} /></button>
              </header>
              <div className="gx-sms-reqbody">
                {notice && <p className="gx-sms-notice" role="alert">{notice}</p>}
                {reqSetupNeeded ? (
                  <div className="gx-sms-empty is-setup">
                    <strong>One-time setup needed for requests</strong>
                    <p>The database is not set up yet. Run <code>neon/schema.sql</code> in the Neon SQL Editor, then reload this page.</p>
                  </div>
                ) : (
                  <>
                    {incomingReqs.length === 0 && <div className="gx-sms-empty"><Inbox size={28} /><p>No friend requests right now.</p></div>}
                    {incomingReqs.map((r) => (
                      <div key={r.id} className="gx-sms-reqcard">
                        <span className="gx-sms-av">{initials(r.requester_name, r.requester_email)}</span>
                        <span className="gx-sms-who"><strong>{r.requester_name || r.requester_email.split("@")[0]}</strong><small>{r.requester_email}</small></span>
                        <div className="gx-sms-req-actions">
                          <button type="button" className="is-accept" disabled={busyReq === r.id} onClick={() => answerRequest(r, "accept")}><Check size={15} /> Accept</button>
                          <button type="button" className="is-reject" disabled={busyReq === r.id} onClick={() => answerRequest(r, "reject")}><X size={15} /> Reject</button>
                          <button type="button" className="is-block" disabled={busyReq === r.id} onClick={() => answerRequest(r, "block")} title="Block this user"><Ban size={15} /> Block</button>
                        </div>
                      </div>
                    ))}
                    {sentReqs.length > 0 && (
                      <div className="gx-sms-sent">
                        <h4><Clock size={13} /> Requests you sent (waiting)</h4>
                        {sentReqs.map((r) => <p key={r.id}>{r.receiver_name || r.receiver_email}</p>)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : !active ? (
            <div className="gx-sms-placeholder">
              <MessageCircle size={46} />
              <h3>Chat with your friends</h3>
              <p>Send a friend request by email. Once they accept, send messages, photos and videos. Your chats are private and never shared with the AI.</p>
              <button type="button" className="gx-sms-back-list" onClick={() => setView("list")}>Choose a friend</button>
            </div>
          ) : (
            <>
              <header className="gx-sms-head">
                <button type="button" className="gx-sms-back" onClick={() => setView("list")} aria-label="Back to friends"><ArrowLeft size={20} /></button>
                <span className="gx-sms-av">{initials(active.friend_name, active.friend_email)}</span>
                <div className="gx-sms-who"><strong>{active.friend_name || active.friend_email.split("@")[0]}</strong><small>{active.friend_email}</small></div>
                <button type="button" className="gx-sms-block" onClick={blockActive} title="Block this user" aria-label="Block this user"><Ban size={18} /></button>
                <button type="button" className="gx-sms-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
              </header>

              <nav className="gx-sms-tabs" aria-label="Conversation sections">
                <button type="button" className={tab === "chat" ? "is-on" : ""} onClick={() => setTab("chat")}><MessageCircle size={15} /> Chat</button>
                <button type="button" className={tab === "photos" ? "is-on" : ""} onClick={() => setTab("photos")}><ImageIcon size={15} /> Photos <em>{photos.length}</em></button>
                <button type="button" className={tab === "videos" ? "is-on" : ""} onClick={() => setTab("videos")}><Film size={15} /> Videos <em>{videos.length}</em></button>
                <button type="button" className={tab === "files" ? "is-on" : ""} onClick={() => setTab("files")}><FileText size={15} /> Files <em>{docs.length}</em></button>
              </nav>

              {tab === "chat" && (
                <div className="gx-sms-thread">
                  {messages.length === 0 && <p className="gx-sms-hint">Say hi 👋 — this chat is private between you two.</p>}
                  {messages.map((m) => {
                    const mine = m.sender_id === me;
                    const day = dayOf(m.created_at);
                    const showDay = day !== lastDay;
                    lastDay = day;
                    return (
                      <div key={m.id}>
                        {showDay && <div className="gx-day"><span>{day}</span></div>}
                        <div className={`gx-sms-row ${mine ? "is-mine" : ""}`}>
                          <div className="gx-sms-bubble">
                            {m.media_path && renderMedia(m)}
                            {m.body && <p>{m.body}</p>}
                            <footer>
                              <time>{timeOf(m.created_at)}</time>
                              {mine && <button type="button" onClick={() => removeMessage(m)} aria-label="Delete message"><Trash2 size={13} /></button>}
                            </footer>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              )}

              {tab === "photos" && (
                <div className="gx-sms-gallery">
                  {photos.length === 0 ? <p className="gx-sms-hint">No photos shared yet.</p> : photos.map((m) => <span key={m.id} className="gx-sms-cell">{renderMedia(m, "is-grid")}</span>)}
                </div>
              )}
              {tab === "videos" && (
                <div className="gx-sms-gallery">
                  {videos.length === 0 ? <p className="gx-sms-hint">No videos shared yet.</p> : videos.map((m) => <span key={m.id} className="gx-sms-cell">{renderMedia(m, "is-grid")}</span>)}
                </div>
              )}

              {tab === "files" && (
                <div className="gx-sms-filelist">
                  {docs.length === 0 ? <p className="gx-sms-hint">No files shared yet.</p> : docs.map((m) => <div key={m.id}>{renderMedia(m)}</div>)}
                </div>
              )}

              {notice && <p className="gx-sms-notice" role="alert">{notice}</p>}

              {pending.length > 0 && (
                <div className="gx-sms-pending">
                  {pending.map((p, i) => (
                    <div key={p.key} className={`gx-sms-pitem${p.kind === "file" ? " is-file" : ""}`} title={p.file.name}>
                      {p.kind === "image" ? <img src={p.preview} alt="" /> : p.kind === "video" ? <video src={p.preview} muted playsInline /> : <span><FileText size={22} /><small>{p.file.name}</small></span>}
                      <button type="button" onClick={() => dropPending(i)} aria-label="Remove"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}

              <form className="gx-sms-compose" onSubmit={send}>
                <input ref={fileRef} type="file" multiple hidden onChange={pickFiles} />
                <button type="button" className="gx-sms-tool" onClick={() => fileRef.current?.click()} aria-label="Attach photo, video or file" disabled={sending}><Paperclip size={20} /></button>
                <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message"
                  aria-label="Message" disabled={sending}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
                <button type="submit" className="gx-sms-send" disabled={sending || (!text.trim() && !pending.length)} aria-label="Send">
                  {sending ? <Loader2 size={19} className="gx-spin" /> : <Send size={19} />}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {lightbox && (
        <div className="gx-sms-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Media viewer">
          <div className="gx-sms-lb-bar" onClick={(e) => e.stopPropagation()}>
            <a href={lightbox.url} download target="_blank" rel="noopener noreferrer"><Download size={18} /> Save</a>
            <button type="button" onClick={() => setLightbox(null)} aria-label="Close viewer"><X size={22} /></button>
          </div>
          {lightbox.kind === "image"
            ? <img src={lightbox.url} alt="Shared" onClick={(e) => e.stopPropagation()} />
            : <video src={lightbox.url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />}
        </div>
      )}
    </div>
  );
}
