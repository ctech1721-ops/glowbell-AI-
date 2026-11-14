import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, Search, UserPlus, Send, Paperclip, Image as ImageIcon, Film, ArrowLeft,
  Trash2, MessageCircle, Play, Download, Users, Loader2,
} from "lucide-react";
import { supabase } from "./supabaseClient";

/* =====================================================================
   SMS Friend — private chat between two Global AI users.
   Text, photos and videos. Completely separate from the AI chat.
   Database: supabase/sms_setup.sql
   ===================================================================== */

const BUCKET = "sms-media";
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;

const isMissingTable = (err) =>
  err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202" ||
    /does not exist|schema cache|Could not find/i.test(err.message || ""));

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

  useEffect(() => {
    if (!userId) return;
    try { setReads(JSON.parse(localStorage.getItem(`global-sms-read-${userId}`) || "{}")); } catch { setReads({}); }
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("sms_messages").select("sender_id, created_at")
      .eq("receiver_id", userId).order("created_at", { ascending: false }).limit(300);
    if (!error && data) setIncoming(data);
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    refresh();
    const timer = window.setInterval(refresh, 15000);
    let channel;
    try {
      channel = supabase.channel(`sms-unread-${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sms_messages", filter: `receiver_id=eq.${userId}` }, refresh)
        .subscribe();
    } catch { /* realtime unavailable — polling still works */ }
    return () => {
      window.clearInterval(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const counts = useMemo(() => {
    const out = {};
    for (const m of incoming) {
      if (Date.parse(m.created_at) > Date.parse(reads[m.sender_id] || 0)) out[m.sender_id] = (out[m.sender_id] || 0) + 1;
    }
    return out;
  }, [incoming, reads]);

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  const markRead = useCallback((friendId) => {
    setReads((prev) => {
      const next = { ...prev, [friendId]: new Date().toISOString() };
      try { localStorage.setItem(`global-sms-read-${userId}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [userId]);

  return { counts, total, markRead, refresh };
}

export default function SmsFriend({ user, onClose, sms }) {
  const me = user.id;
  const [friends, setFriends] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [urls, setUrls] = useState({});
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

  // make sure my own profile row exists (needed so friends can find me)
  useEffect(() => {
    supabase.from("profiles").upsert({
      id: me,
      email: (user.email || "").toLowerCase(),
      name: user.user_metadata?.full_name || user.user_metadata?.name || "",
    }, { onConflict: "id" }).then(({ error }) => { if (isMissingTable(error)) setSetupNeeded(true); });
  }, [me, user]);

  const loadFriends = useCallback(async () => {
    const { data, error } = await supabase
      .from("sms_friends").select("friend_id, friend_email, friend_name, created_at")
      .eq("user_id", me).order("created_at", { ascending: false });
    setLoadingFriends(false);
    if (error) {
      if (isMissingTable(error)) setSetupNeeded(true);
      else setNotice(error.message);
      return;
    }
    setFriends(data || []);
  }, [me]);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  const signMedia = useCallback(async (list) => {
    const paths = list.filter((m) => m.media_path).map((m) => m.media_path);
    if (!paths.length) return;
    setUrls((prev) => {
      const need = paths.filter((p) => !prev[p]);
      if (!need.length) return prev;
      supabase.storage.from(BUCKET).createSignedUrls(need, 3600).then(({ data }) => {
        if (!data) return;
        setUrls((cur) => {
          const next = { ...cur };
          data.forEach((row) => { if (row.signedUrl && row.path) next[row.path] = row.signedUrl; });
          return next;
        });
      });
      return prev;
    });
  }, []);

  const loadMessages = useCallback(async (friendId) => {
    if (!friendId) return;
    const { data, error } = await supabase
      .from("sms_messages").select("*")
      .or(`and(sender_id.eq.${me},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${me})`)
      .order("created_at", { ascending: true }).limit(500);
    if (error) { setNotice(error.message); return; }
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
    const timer = window.setInterval(() => { loadMessages(activeId); sms.markRead(activeId); }, 4000);
    let channel;
    try {
      channel = supabase.channel(`sms-chat-${me}-${activeId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sms_messages", filter: `receiver_id=eq.${me}` }, () => loadMessages(activeId))
        .subscribe();
    } catch { /* polling covers it */ }
    return () => { window.clearInterval(timer); if (channel) supabase.removeChannel(channel); };
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
    const { data, error } = await supabase.rpc("sms_add_friend", { p_email: email });
    setAdding(false);
    if (error) {
      if (isMissingTable(error)) setSetupNeeded(true);
      else setNotice(error.message.replace(/^.*?:\s*/, ""));
      return;
    }
    setAddEmail("");
    await loadFriends();
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.out_id) { setActiveId(row.out_id); setView("chat"); setTab("chat"); }
  }

  function pickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const next = [];
    for (const file of files) {
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
      if (!kind) { setNotice("Only photos and videos can be sent."); continue; }
      if (file.size > (kind === "image" ? MAX_IMAGE : MAX_VIDEO)) {
        setNotice(`${file.name} is too large (max ${kind === "image" ? "10 MB for photos" : "50 MB for videos"}).`);
        continue;
      }
      next.push({ file, kind, preview: URL.createObjectURL(file) });
    }
    if (next.length) { setNotice(""); setPending((p) => [...p, ...next].slice(0, 6)); }
  }

  function dropPending(i) {
    setPending((p) => { URL.revokeObjectURL(p[i]?.preview); return p.filter((_, idx) => idx !== i); });
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
          const ext = (file.name.split(".").pop() || (kind === "image" ? "jpg" : "mp4")).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
          const path = `${me}/${active.friend_id}/${crypto.randomUUID()}.${ext}`;
          const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
          if (up.error) throw up.error;
          const { error } = await supabase.from("sms_messages").insert({
            sender_id: me, receiver_id: active.friend_id, body: i === 0 ? body || null : null,
            media_path: path, media_type: kind,
          });
          if (error) throw error;
        }
        pending.forEach((p) => URL.revokeObjectURL(p.preview));
        setPending([]);
      } else {
        const { error } = await supabase.from("sms_messages").insert({ sender_id: me, receiver_id: active.friend_id, body });
        if (error) throw error;
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
    const { error } = await supabase.from("sms_messages").delete().eq("id", m.id);
    if (error) { setNotice(error.message); return; }
    if (m.media_path) supabase.storage.from(BUCKET).remove([m.media_path]);
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
  }

  const visibleFriends = friends.filter((f) =>
    `${f.friend_name || ""} ${f.friend_email}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const photos = messages.filter((m) => m.media_type === "image");
  const videos = messages.filter((m) => m.media_type === "video");

  const renderMedia = (m, className = "") => {
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
              placeholder="Friend's email" aria-label="Friend's email" />
            <button type="submit" disabled={adding || !addEmail.trim()} title="Add friend" aria-label="Add friend">
              {adding ? <Loader2 size={18} className="gx-spin" /> : <UserPlus size={18} />}
            </button>
          </form>

          <label className="gx-sms-search"><Search size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search friends" aria-label="Search friends" />
          </label>

          {notice && !active && <p className="gx-sms-notice" role="alert">{notice}</p>}

          <div className="gx-sms-friends">
            {setupNeeded ? (
              <div className="gx-sms-empty is-setup">
                <strong>One-time setup needed</strong>
                <p>Open Supabase → SQL Editor, paste everything from <code>supabase/sms_setup.sql</code> and press Run. Then reload this page.</p>
              </div>
            ) : loadingFriends ? (
              <div className="gx-sms-empty"><Loader2 className="gx-spin" /></div>
            ) : visibleFriends.length === 0 ? (
              <div className="gx-sms-empty"><Users size={26} /><p>{friends.length ? "No friends match." : "No friends yet. Enter your friend's email above to add them."}</p></div>
            ) : visibleFriends.map((f) => (
              <button type="button" key={f.friend_id}
                className={`gx-sms-friend${f.friend_id === activeId ? " is-active" : ""}`}
                onClick={() => { setActiveId(f.friend_id); setView("chat"); setTab("chat"); setNotice(""); }}>
                <span className="gx-sms-av">{initials(f.friend_name, f.friend_email)}</span>
                <span className="gx-sms-who"><strong>{f.friend_name || f.friend_email.split("@")[0]}</strong><small>{f.friend_email}</small></span>
                {sms.counts[f.friend_id] > 0 && <b className="gx-sms-badge">{sms.counts[f.friend_id]}</b>}
              </button>
            ))}
          </div>
        </aside>

        {/* ---------- conversation ---------- */}
        <section className="gx-sms-chat">
          {!active ? (
            <div className="gx-sms-placeholder">
              <MessageCircle size={46} />
              <h3>Chat with your friends</h3>
              <p>Add a friend by email, then send messages, photos and videos. Your chats are private and never shared with the AI.</p>
              <button type="button" className="gx-sms-back-list" onClick={() => setView("list")}>Choose a friend</button>
            </div>
          ) : (
            <>
              <header className="gx-sms-head">
                <button type="button" className="gx-sms-back" onClick={() => setView("list")} aria-label="Back to friends"><ArrowLeft size={20} /></button>
                <span className="gx-sms-av">{initials(active.friend_name, active.friend_email)}</span>
                <div className="gx-sms-who"><strong>{active.friend_name || active.friend_email.split("@")[0]}</strong><small>{active.friend_email}</small></div>
                <button type="button" className="gx-sms-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
              </header>

              <nav className="gx-sms-tabs" aria-label="Conversation sections">
                <button type="button" className={tab === "chat" ? "is-on" : ""} onClick={() => setTab("chat")}><MessageCircle size={15} /> Chat</button>
                <button type="button" className={tab === "photos" ? "is-on" : ""} onClick={() => setTab("photos")}><ImageIcon size={15} /> Photos <em>{photos.length}</em></button>
                <button type="button" className={tab === "videos" ? "is-on" : ""} onClick={() => setTab("videos")}><Film size={15} /> Videos <em>{videos.length}</em></button>
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

              {notice && <p className="gx-sms-notice" role="alert">{notice}</p>}

              {pending.length > 0 && (
                <div className="gx-sms-pending">
                  {pending.map((p, i) => (
                    <div key={p.preview} className="gx-sms-pitem">
                      {p.kind === "image" ? <img src={p.preview} alt="" /> : <video src={p.preview} muted playsInline />}
                      <button type="button" onClick={() => dropPending(i)} aria-label="Remove"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}

              <form className="gx-sms-compose" onSubmit={send}>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={pickFiles} />
                <button type="button" className="gx-sms-tool" onClick={() => fileRef.current?.click()} aria-label="Attach photo or video" disabled={sending}><Paperclip size={20} /></button>
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
