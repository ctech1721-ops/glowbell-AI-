import { useEffect, useRef, useState } from "react";
import {
  Send, UserRound, Copy, Check, Plus, Menu, MessageSquare,
  Trash2, X, PanelLeftClose, Pin, RotateCcw, Paperclip,
  Eye, ArrowLeft, FileText, LogOut,StickyNote,
} from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";

import ReportProblem from "./ReportProblem";
import Auth from "./Auth";
import { supabase } from "./supabaseClient";
import OwnerDashboard from "./OwnerDashboard";
import NotesWidget from "./NotesWidget";


const suggestions = [
  "Explain artificial intelligence simply",
  "Teach me Python programming",
  "Give me project ideas",
  "Write a JavaScript calculator",
];

// --------------------------------------------------
// FILE UPLOAD SETTINGS
// Allowed: Images (JPG, PNG, WEBP, GIF), PDF,
//          Word (DOCX), TXT, CSV, MD
// --------------------------------------------------

const MAX_FILE_BYTES = 7 * 1024 * 1024;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const IMAGE_MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const ALLOWED_IMAGE_MIMES = Object.values(IMAGE_MIME_BY_EXTENSION);

const TEXT_EXTENSIONS = ["txt", "csv", "md"];

const FILE_INPUT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif,.pdf,.docx,.txt,.csv,.md";

function createId() {
  return crypto.randomUUID();
}

function makeTitle(messages) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const title = (first.content || "").replace(/\s+/g, " ").trim();
  return title.length > 38 ? `${title.slice(0, 38)}…` : title;
}

// Never save base64 image/file data or temporary URLs in Supabase.
function sanitizeMessages(messages) {
  return messages.map((message) => {
    const {
      excelDownloadUrl,
      ...safeMessage
    } = message;

    if (!safeMessage.attachment) return safeMessage;

    const {
      data,
      previewUrl,
      ...info
    } = safeMessage.attachment;

    return {
      ...safeMessage,
      attachment: {
        ...info,
        hasImage: Boolean(
          data || previewUrl || safeMessage.attachment.hasImage
        ),
      },
    };
  });
}

function removeAnswerSources(content) {
  if (typeof content !== "string") return "";
  return content
    .replace(/\n{0,2}#{0,3}\s*\*{0,2}Sources\*{0,2}\s*:?\s*\n[\s\S]*$/i, "")
    .trim();
}

function CodeBlock({ className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const match = /language-([\w+#.-]+)/i.exec(className || "");
  const language = match?.[1] || "text";
  const code = String(children).replace(/\n$/, "");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (!match) return <code className={className} {...props}>{children}</code>;

  return (
    <div className="gb-code-block">
      <div className="gb-code-toolbar">
        <span className="gb-code-language">{language}</span>
        <button type="button" className="gb-code-copy" onClick={copyCode}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied!" : "Copy code"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        PreTag="pre"
        CodeTag="code"
        showLineNumbers={code.split("\n").length > 5}
        wrapLongLines
        customStyle={{
          margin: 0,
          padding: "18px",
          background: "transparent",
          fontSize: "13px",
          lineHeight: "1.7",
          overflowX: "auto",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

async function createExcelDownload(excelData) {
  const response = await fetch("/api/create-excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(excelData),
  });

  if (!response.ok) {
    let message = "Excel file creation failed.";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("The generated Excel file is empty.");

  const fileName = String(excelData.fileName || "Glowbell-Excel")
    .replace(/\.xlsx$/i, "")
    .replace(/[^a-z0-9_-]/gi, "-")
    .slice(0, 80) || "Glowbell-Excel";

  return {
    excelDownloadUrl: URL.createObjectURL(blob),
    excelFileName: fileName,
  };
}

export default function App() {
  const isOwnerRoute = window.location.pathname === "/owner";

  const [authUser, setAuthUser] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerToken, setOwnerToken] = useState("");
  const [authReady, setAuthReady] = useState(false);

  // File selected for the next message.
  const [selectedAttachment, setSelectedAttachment] = useState(null);

  // Private in-memory context for this chat. Not saved to Supabase.
  // Reuse this attachment for follow-up questions until a new chat is opened.
  const [contextAttachment, setContextAttachment] = useState(null);

  const [viewerImageUrl, setViewerImageUrl] = useState("");
  const fileInputRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [pinnedChats, setPinnedChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const excelUrlsRef = useRef(new Set());

  function rememberExcelUrl(url) {
    if (url) excelUrlsRef.current.add(url);
    return url;
  }

  useEffect(() => {
    return () => {
      excelUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      excelUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError) console.error(sessionError.message);
      setAuthUser(data?.session?.user ?? null);
      setAuthReady(true);
    }

    loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (active) {
          setAuthUser(session?.user ?? null);
          setAuthReady(true);
        }
      }
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser?.id) {
      setPinnedChats([]);
      return;
    }

    try {
      setPinnedChats(
        JSON.parse(localStorage.getItem(`glowbell-pinned-chats-${authUser.id}`) || "[]")
      );
    } catch {
      setPinnedChats([]);
    }
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) return;
    try {
      localStorage.setItem(
        `glowbell-pinned-chats-${authUser.id}`,
        JSON.stringify(pinnedChats)
      );
    } catch (err) {
      console.error("Could not save pinned chats:", err);
    }
  }, [pinnedChats, authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) {
      setHistory([]);
      setCurrentChatId(null);
      setMessages([]);
      setContextAttachment(null);
      return;
    }

    let active = true;

    async function loadChats() {
      setError("");
      const { data, error: loadError } = await supabase
        .from("chats")
        .select("id, user_id, title, messages, created_at, updated_at")
        .eq("user_id", authUser.id)
        .order("updated_at", { ascending: false });

      if (!active) return;

      if (loadError) {
        console.error("Could not load chats:", loadError.message);
        setError(`Could not load chat history: ${loadError.message}`);
        setHistory([]);
        return;
      }

      setHistory((data || []).map((chat) => ({
        id: chat.id,
        title: chat.title || "New chat",
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        createdAt: chat.created_at ? new Date(chat.created_at).getTime() : Date.now(),
        updatedAt: chat.updated_at ? new Date(chat.updated_at).getTime() : Date.now(),
      })));
    }

    loadChats();
    return () => { active = false; };
  }, [authUser?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  async function saveConversation(id, nextMessages) {
    if (!id || !authUser?.id || !nextMessages.length) return;

    const updatedAt = Date.now();
    const existing = history.find((chat) => chat.id === id);
    const title = makeTitle(nextMessages);
    const messagesToSave = sanitizeMessages(nextMessages);

    setHistory((previous) => {
      const oldChat = previous.find((chat) => chat.id === id);
      return [{
        id,
        title,
        messages: messagesToSave,
        updatedAt,
        createdAt: oldChat?.createdAt || existing?.createdAt || updatedAt,
      }, ...previous.filter((chat) => chat.id !== id)];
    });

    const { error: saveError } = await supabase.from("chats").upsert({
      id,
      user_id: authUser.id,
      title,
      messages: messagesToSave,
      updated_at: new Date(updatedAt).toISOString(),
    }, { onConflict: "id" });

    if (saveError) {
      console.error("Could not save chat:", saveError.message);
      setError(`Chat save failed: ${saveError.message}`);
    }
  }

  function getRequestHistory(sourceMessages) {
    return sourceMessages
      .filter((item) =>
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string"
      )
      .slice(-10)
      .map((item) => ({ role: item.role, content: item.content }));
  }

  function getRequestAttachment(attachment) {
    if (!attachment?.data) return null;
    return {
      name: attachment.name,
      mimeType: attachment.mimeType,
      data: attachment.data,
    };
  }

  async function sendMessage(text = input) {
    const message = text.trim();
    const newlySelectedAttachment = selectedAttachment;

    // If no new file is selected, reuse the current chat's image/file.
    const attachment = newlySelectedAttachment || contextAttachment;

    if ((!message && !attachment) || loading) return;

    const finalMessage = message ||
      `Please analyze the attached file: ${attachment.name}`;

    setError("");
    setInput("");

    const chatId = currentChatId || createId();

    const userMessages = [
      ...messages,
      {
        role: "user",
        content: finalMessage,
        // Only show an attachment thumbnail for a newly uploaded file.
        ...(newlySelectedAttachment
          ? { attachment: newlySelectedAttachment }
          : {}),
      },
    ];

    setCurrentChatId(chatId);
    setMessages(userMessages);
    setLoading(true);

    try {
      await saveConversation(chatId, userMessages);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: finalMessage,
          attachment: getRequestAttachment(attachment),
          history: getRequestHistory(messages),
        }),
      });

      const responseText = await response.text();
      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("Invalid server response:", responseText);
        throw new Error("Server returned an invalid response. Check the backend terminal.");
      }

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }
      if (!data.answer) throw new Error("The AI returned an empty answer.");

      let excelDownloadUrl = null;
      let excelFileName = "Glowbell-Excel";

      if (data.excelData) {
        const result = await createExcelDownload(data.excelData);
        excelDownloadUrl = rememberExcelUrl(result.excelDownloadUrl);
        excelFileName = result.excelFileName;
      }

      const updatedMessages = [
        ...userMessages,
        {
          role: "assistant",
          content: data.answer,
          sources: Array.isArray(data.sources) ? data.sources : [],
          excelData: data.excelData || null,
          excelDownloadUrl,
          excelFileName,
        },
      ];

      setMessages(updatedMessages);

      // Keep the file in React state for subsequent follow-up questions.
      if (attachment) setContextAttachment(attachment);

      setSelectedAttachment(null);
      await saveConversation(chatId, updatedMessages);
    } catch (err) {
      setError(err.message || "Could not connect to Glowbell AI. Check that the server is running.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // --------------------------------------------------
  // FILE SELECTION
  // Allowed: JPG, PNG, WEBP, GIF, PDF, DOCX, TXT, CSV, MD
  // --------------------------------------------------

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setError("File size 7 MB-kku keezha irukkanum.");
      return;
    }

    const fileName = file.name || "uploaded-file";
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const fileType = (file.type || "").toLowerCase();

    const isImage =
      ALLOWED_IMAGE_MIMES.includes(fileType) ||
      Object.prototype.hasOwnProperty.call(IMAGE_MIME_BY_EXTENSION, extension);

    const isPdf = fileType === "application/pdf" || extension === "pdf";

    const isDocx = fileType === DOCX_MIME || extension === "docx";

    const isOldDoc = fileType === "application/msword" || extension === "doc";

    const isText =
      fileType === "text/plain" ||
      fileType === "text/csv" ||
      fileType === "text/markdown" ||
      TEXT_EXTENSIONS.includes(extension);

    if (isOldDoc) {
      setError("Old .doc file support illai. Word file-ai .docx nu save pannitu upload pannunga.");
      return;
    }

    if (!isImage && !isPdf && !isDocx && !isText) {
      setError(
        "Image (JPG, PNG, WEBP, GIF), PDF, Word (DOCX), TXT, CSV, MD files only allowed."
      );
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const commaIndex = dataUrl.indexOf(",");

      if (commaIndex < 0) {
        setError("File-ai read panna mudiyala.");
        return;
      }

      // Decide the final MIME type.
      let mimeType = fileType;

      if (isImage) {
        mimeType = ALLOWED_IMAGE_MIMES.includes(fileType)
          ? fileType
          : IMAGE_MIME_BY_EXTENSION[extension] || "image/jpeg";
      } else if (isPdf) {
        mimeType = "application/pdf";
      } else if (isDocx) {
        mimeType = DOCX_MIME;
      } else if (isText) {
        mimeType =
          extension === "csv"
            ? "text/csv"
            : extension === "md"
            ? "text/markdown"
            : "text/plain";
      }

      setSelectedAttachment({
        name: fileName,
        mimeType,
        data: dataUrl.slice(commaIndex + 1),
        previewUrl: isImage ? dataUrl : "",
        isImage,
      });

      setError("");
    };

    reader.onerror = () => {
      setError("File-ai read panna mudiyala.");
    };

    reader.readAsDataURL(file);
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendMessage();
  }

  async function regenerateAnswer(answerIndex) {
    if (loading) return;

    const questionIndex = messages
      .slice(0, answerIndex)
      .findLastIndex((item) => item.role === "user");

    if (questionIndex === -1) {
      setError("Could not find the original question.");
      return;
    }

    const questionMessage = messages[questionIndex];
    const question = questionMessage.content;
    // Use the attachment on that question, or the current chat context.
    const attachment = questionMessage.attachment || contextAttachment;

    setLoading(true);
    setError("");
    setCopiedIndex(-1);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          attachment: getRequestAttachment(attachment),
          history: getRequestHistory(messages.slice(0, questionIndex)),
        }),
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error("Server returned an invalid response.");
      }

      if (!response.ok) throw new Error(data.error || `Server error: ${response.status}`);
      if (!data.answer) throw new Error("The AI returned an empty answer.");

      let excelDownloadUrl = null;
      let excelFileName = "Glowbell-Excel";

      if (data.excelData) {
        const result = await createExcelDownload(data.excelData);
        excelDownloadUrl = rememberExcelUrl(result.excelDownloadUrl);
        excelFileName = result.excelFileName;
      }

      const nextMessages = messages.map((item, index) =>
        index === answerIndex && item.role === "assistant"
          ? {
              ...item,
              content: data.answer,
              sources: Array.isArray(data.sources) ? data.sources : [],
              excelData: data.excelData || null,
              excelDownloadUrl,
              excelFileName,
            }
          : item
      );

      setMessages(nextMessages);
      if (attachment) setContextAttachment(attachment);
      if (currentChatId) await saveConversation(currentChatId, nextMessages);
    } catch (err) {
      setError(err.message || "Could not regenerate the answer.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteMessagePair(index) {
    if (loading) return;
    const message = messages[index];
    if (!message || message.role !== "user") return;

    if (!window.confirm(`Indha question-um adhoda answer-um delete pannava?\n\n"${message.content.slice(0, 80)}"`)) return;

    const nextMessages = messages.filter((item, i) => {
      if (i === index) return false;
      if (
        i > index &&
        item.role === "assistant" &&
        !messages.slice(index + 1, i).some((previous) => previous.role === "user")
      ) return false;
      return true;
    });

    setMessages(nextMessages);
    setCopiedIndex(-1);
    setError("");

    if (!currentChatId) return;
    if (!nextMessages.length) {
      await deleteChatFromDatabase(currentChatId);
      setCurrentChatId(null);
      setContextAttachment(null);
    } else {
      await saveConversation(currentChatId, nextMessages);
    }
  }

  async function deleteChatFromDatabase(chatId) {
    if (!authUser?.id) return;

    const { error: deleteError } = await supabase
      .from("chats")
      .delete()
      .eq("id", chatId)
      .eq("user_id", authUser.id);

    if (deleteError) {
      setError(`Could not delete chat: ${deleteError.message}`);
      return;
    }

    setHistory((previous) => previous.filter((chat) => chat.id !== chatId));
    setPinnedChats((previous) => previous.filter((id) => id !== chatId));
  }

  function newChat() {
    if (loading) return;
    setCurrentChatId(null);
    setMessages([]);
    setInput("");
    setError("");
    setCopiedIndex(-1);
    setSelectedAttachment(null);
    setContextAttachment(null);
    setSidebarOpen(false);
    setViewerImageUrl("");
    inputRef.current?.focus();
  }

  function openConversation(chat) {
    if (loading) return;
    setCurrentChatId(chat.id);
    setMessages(chat.messages || []);
    setInput("");
    setError("");
    setCopiedIndex(-1);
    setSelectedAttachment(null);
    // Saved history intentionally doesn't contain the actual file bytes.
    setContextAttachment(null);
    setSidebarOpen(false);
    setViewerImageUrl("");
  }

  function togglePinChat(event, chatId) {
    event.stopPropagation();
    setPinnedChats((previous) =>
      previous.includes(chatId)
        ? previous.filter((id) => id !== chatId)
        : [...previous, chatId]
    );
  }

  async function deleteConversation(event, chatId) {
    event.stopPropagation();
    if (loading) return;
    if (!window.confirm("Delete this conversation permanently?")) return;

    await deleteChatFromDatabase(chatId);

    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
      setInput("");
      setError("");
      setSelectedAttachment(null);
      setContextAttachment(null);
    }
  }

  async function handleLogout() {
    if (loading) return;
    if (!window.confirm("Are you sure you want to logout?")) return;

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(`Logout failed: ${signOutError.message}`);
      return;
    }

    setAuthUser(null);
    setHistory([]);
    setMessages([]);
    setCurrentChatId(null);
    setSelectedAttachment(null);
    setContextAttachment(null);
    setInput("");
    setError("");
  }

  async function clearHistory() {
    if (loading || !history.length || !authUser?.id) return;
    if (!window.confirm("Delete all saved chat history? This cannot be undone.")) return;

    const { error: deleteError } = await supabase
      .from("chats")
      .delete()
      .eq("user_id", authUser.id);

    if (deleteError) {
      setError(`Could not clear history: ${deleteError.message}`);
      return;
    }

    setHistory([]);
    setPinnedChats([]);
    setCurrentChatId(null);
    setMessages([]);
    setInput("");
    setError("");
    setSelectedAttachment(null);
    setContextAttachment(null);
  }

  async function copyAnswer(content, index) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(-1), 1600);
    } catch {
      setError("Could not copy the answer.");
    }
  }

  if (isOwnerRoute) return <OwnerDashboard />;
  if (!authReady) return <div>Loading Glowbell AI...</div>;

  if (!authUser && !isOwner) {
    return (
      <Auth
        onLogin={setAuthUser}
        onOwnerLogin={(token) => {
          setOwnerToken(token);
          setIsOwner(true);
        }}
      />
    );
  }

  if (isOwner) {
    return (
      <OwnerDashboard
        token={ownerToken}
        onLogout={() => {
          setIsOwner(false);
          setOwnerToken("");
        }}
      />
    );
  }

  return (
    <div className="glowbell-app gb-with-sidebar">
      <NotesWidget userId={authUser.id} />
      {viewerImageUrl && (
        <div className="gb-image-viewer">
          <button type="button" className="gb-image-back" onClick={() => setViewerImageUrl("")}>
            <ArrowLeft size={19} /> Back to chat
          </button>
          <img src={viewerImageUrl} alt="Full-size image preview" />
        </div>
      )}

      {sidebarOpen && (
        <button
          className="gb-sidebar-backdrop"
          type="button"
          aria-label="Close history sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`gb-sidebar ${sidebarOpen ? "gb-sidebar-open" : ""}`}>
        <div className="gb-sidebar-header">
          <button
            type="button"
            className="gb-sidebar-icon"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <PanelLeftClose size={19} />
          </button>
        </div>

        <button className="gb-sidebar-new" type="button" onClick={newChat} disabled={loading}>
          <Plus size={18} /> New chat
        </button>

        <div className="gb-history-heading">
          <span>Recent chats</span>
          {history.length > 0 && <span className="gb-history-count">{history.length}</span>}
        </div>

        <div className="gb-history-list">
          {history.length === 0 ? (
            <div className="gb-history-empty">
              <MessageSquare size={22} />
              <p>Your conversations will appear here.</p>
            </div>
          ) : (
            [...history]
              .sort((a, b) =>
                Number(pinnedChats.includes(b.id)) - Number(pinnedChats.includes(a.id))
              )
              .map((chat) => (
                <div
                  key={chat.id}
                  className={`gb-history-item ${currentChatId === chat.id ? "gb-history-active" : ""}`}
                >
                  <button
                    type="button"
                    className="gb-history-open"
                    onClick={() => openConversation(chat)}
                    disabled={loading}
                    title={chat.title}
                  >
                    <MessageSquare size={16} />
                    <span>{chat.title || "New chat"}</span>
                  </button>
                  <button
                    type="button"
                    className="gb-history-pin"
                    onClick={(event) => togglePinChat(event, chat.id)}
                    aria-label={pinnedChats.includes(chat.id) ? "Unpin chat" : "Pin chat"}
                    title={pinnedChats.includes(chat.id) ? "Unpin chat" : "Pin chat"}
                  >
                    <Pin size={15} fill={pinnedChats.includes(chat.id) ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    className="gb-history-delete"
                    onClick={(event) => deleteConversation(event, chat.id)}
                    disabled={loading}
                    aria-label={`Delete ${chat.title || "conversation"}`}
                    title="Delete chat"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
          )}
        </div>

        <div className="gb-sidebar-footer">
          <span>Saved to your account</span>
          <div style={{
            display: "flex", alignItems: "center", gap: "10px", padding: "12px 0",
            borderTop: "1px solid var(--border-color, #ddd)", marginTop: "8px",
          }}>
            <UserRound size={22} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: "block", fontSize: "14px" }}>My Profile</strong>
              <span style={{ display: "block", fontSize: "12px", overflowWrap: "anywhere" }}>
                {authUser?.email}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: "8px", width: "100%",
              padding: "10px", border: "1px solid var(--border-color, #ddd)",
              borderRadius: "8px", cursor: loading ? "not-allowed" : "pointer",
              background: "transparent", color: "inherit",
            }}
          >
            <LogOut size={16} /> Logout
          </button>
          <button type="button" onClick={clearHistory} disabled={loading || history.length === 0}>
            <Trash2 size={14} /> Clear history
          </button>
        </div>
      </aside>

      <div className="gb-workspace">
        <header className="gb-header">
          <div className="gb-header-left">
            <button
              className="gb-menu-button"
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={sidebarOpen ? "Close chat history" : "Open chat history"}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
          <div className="gb-header-actions">
            <button className="gb-new-chat" type="button" onClick={newChat} disabled={loading}>
              <Plus size={18} /> <span>New chat</span>
            </button>
            <ReportProblem />
          </div>
        </header>

        <main className="gb-main">
          {messages.length === 0 ? (
            <section className="gb-welcome">
              <div className="gb-eyebrow">YOUR PERSONAL AI ASSISTANT</div>
              <h1>Ideas start here.<br /><span>Let&apos;s explore together.</span></h1>
              <p className="gb-welcome-description">
                Ask questions, learn something new, or write code with Glowbell AI.
              </p>
              <div className="gb-suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    className="gb-suggestion"
                    type="button"
                    key={suggestion}
                    disabled={loading}
                    onClick={() => sendMessage(suggestion)}
                  >
                    <span>{suggestion}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="gb-messages" aria-live="polite">
              {messages.map((message, index) => (
                <article
                  className={`gb-message ${message.role === "user" ? "gb-user-message" : "gb-ai-message"}`}
                  key={`${message.role}-${index}`}
                >
                  <div className="gb-avatar">
                    {message.role === "user" ? <UserRound size={19} /> : null}
                  </div>

                  <div className="gb-message-body">
                    <div className="gb-message-author">
                      <span>{message.role === "user" ? "You" : "Glowbell AI"}</span>
                      {message.role === "user" && (
                        <button
                          type="button"
                          className="gb-delete-message"
                          onClick={() => deleteMessagePair(index)}
                          disabled={loading}
                          aria-label="Delete question and its answer"
                          title="Delete question and answer"
                        >
                          <Trash2 size={15} /><span>Delete</span>
                        </button>
                      )}
                    </div>

                    <div className="gb-message-text">
                      <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          code: CodeBlock,
                          p({ children, ...props }) {
                            return <p className="gb-md-paragraph" {...props}>{children}</p>;
                          },
                          h1({ children, ...props }) {
                            return <h1 className="gb-md-heading" {...props}>{children}</h1>;
                          },
                          h2({ children, ...props }) {
                            return <h2 className="gb-md-heading" {...props}>{children}</h2>;
                          },
                          h3({ children, ...props }) {
                            return <h3 className="gb-md-heading" {...props}>{children}</h3>;
                          },
                          ul({ children, ...props }) {
                            return <ul className="gb-md-list" {...props}>{children}</ul>;
                          },
                          ol({ children, ...props }) {
                            return <ol className="gb-md-list" {...props}>{children}</ol>;
                          },
                        }}
                      >
                        {message.role === "assistant"
                          ? removeAnswerSources(message.content)
                          : message.content}
                      </ReactMarkdown>

                      {message.excelDownloadUrl && (
                        <a
                          href={message.excelDownloadUrl}
                          download={`${message.excelFileName || "Glowbell-Excel"}.xlsx`}
                          className="gb-excel-download"
                        >
                          Download Excel
                        </a>
                      )}
                    </div>

                    {message.role === "user" && message.attachment && (
                      <div className="gb-message-attachment">
                        {message.attachment.isImage && message.attachment.previewUrl ? (
                          <>
                            <img
                              src={message.attachment.previewUrl}
                              alt="Uploaded image"
                              className="gb-sent-thumbnail"
                            />
                            <button
                              type="button"
                              onClick={() => setViewerImageUrl(message.attachment.previewUrl)}
                            >
                              <Eye size={15} /> View image
                            </button>
                          </>
                        ) : (
                          <div className="gb-sent-file">
                            <FileText size={18} />
                            <span>{message.attachment.name}</span>
                            {message.attachment.hasImage && message.attachment.isImage && (
                              <span>(preview unavailable in saved history)</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {message.role === "assistant" && message.sources?.length > 0 && (
                      <div className="gb-sources">
                        <strong>Sources</strong>
                        {message.sources.map((source) => (
                          <div key={`${source.number}-${source.url}`}>
                            <a href={source.url} target="_blank" rel="noopener noreferrer">
                              [{source.number}] {source.title}
                            </a>
                          </div>
                        ))}
                      </div>
                    )}

                    {message.role === "assistant" && (
                      <button
                        className="gb-regenerate"
                        type="button"
                        onClick={() => regenerateAnswer(index)}
                        disabled={loading}
                        title="Regenerate answer"
                      >
                        <RotateCcw size={15} />
                        {loading ? "Generating..." : "Regenerate"}
                      </button>
                    )}

                    {message.role === "assistant" && (
                      <button
                        className="gb-copy"
                        type="button"
                        onClick={() => copyAnswer(message.content, index)}
                      >
                        {copiedIndex === index ? <Check size={15} /> : <Copy size={15} />}
                        {copiedIndex === index ? "Copied" : "Copy answer"}
                      </button>
                    )}
                  </div>
                </article>
              ))}

              {loading && (
                <article className="gb-message gb-ai-message">
                  <div className="gb-avatar" />
                  <div className="gb-message-body">
                    <div className="gb-message-author">Glowbell AI</div>
                    <div className="gb-thinking">
                      <span /><span /><span />
                      <span className="gb-thinking-text">Thinking...</span>
                    </div>
                  </div>
                </article>
              )}
              <div ref={bottomRef} />
            </section>
          )}

          {error && <div className="gb-error" role="alert">{error}</div>}

          <section className="gb-composer">
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              hidden
              onChange={handleFileChange}
            />

            {selectedAttachment && (
              <div className="gb-attachment-preview">
                {selectedAttachment.isImage ? (
                  <img
                    src={selectedAttachment.previewUrl}
                    alt="Selected upload preview"
                    className="gb-attachment-thumbnail"
                  />
                ) : <FileText size={25} />}

                <span className="gb-attachment-name">{selectedAttachment.name}</span>

                {selectedAttachment.isImage && (
                  <button
                    type="button"
                    onClick={() => setViewerImageUrl(selectedAttachment.previewUrl)}
                  >
                    <Eye size={15} /> View image
                  </button>
                )}

                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => setSelectedAttachment(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {!selectedAttachment && contextAttachment && (
              <div className="gb-attachment-preview">
                {contextAttachment.isImage ? (
                  <img
                    src={contextAttachment.previewUrl}
                    alt="Current chat image context"
                    className="gb-attachment-thumbnail"
                  />
                ) : <FileText size={25} />}
                <span className="gb-attachment-name">
                  Context retained: {contextAttachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => setContextAttachment(null)}
                  title="Stop using previous file for follow-up questions"
                  aria-label="Clear retained file context"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <form className="gb-input-form" onSubmit={handleSubmit}>
              <button
                className="gb-attach-button"
                type="button"
                title="Upload image, PDF or Word file"
                aria-label="Upload image, PDF or Word file"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={19} />
              </button>

              
              

              <textarea
                ref={inputRef}
                className="gb-textarea"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit(event);
                  }
                }}
                placeholder="Ask Glowbell AI a question..."
                aria-label="Message Glowbell AI"
                rows={1}
                disabled={loading}
              />

              <button
  className="gb-notes-search-btn"
  type="button"
  title="Open Notepad"
  aria-label="Open Notepad"
  onClick={() =>
    window.dispatchEvent(new CustomEvent("glowbell-open-notes"))
  }
>
  <StickyNote size={20} />
</button>

              <button
                className="gb-send"
                type="submit"
                aria-label="Send message"
                disabled={(!input.trim() && !selectedAttachment) || loading}
              >
                <Send size={19} />
              </button>
            </form>

            
          </section>
        </main>
      </div>
    </div>
  );
}
