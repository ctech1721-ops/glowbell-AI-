import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send, UserRound, Copy, Check, Plus, Menu, MessageSquare, Globe2,
  Trash2, X, PanelLeftClose, Pin, RotateCcw, Paperclip, Sparkles,
  Eye, ArrowLeft, Download, FileText, LogOut, StickyNote,
  Mic, MicOff, Square, Volume2, VolumeX, Pencil, ThumbsUp, ThumbsDown,
  Search, ArrowDown, SlidersHorizontal, Ghost, FileDown, MoreHorizontal,
  Lightbulb, Code2, Rocket, Calculator, CalendarCheck, BookOpen, NotebookPen, MessageCircle,
} from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";

import ReportProblem from "./ReportProblem";
import Auth from "./Auth";
import { supabase } from "./supabaseClient";
import OwnerDashboard from "./OwnerDashboard";
import NotesWidget from "./NotesWidget";
import FeatureHub from "./FeatureHub";
import JSZip from "jszip";
import GlobalLogo from "./GlobalLogo";
import StartIntro from "./StartIntro";
import WelcomeGuide from "./WelcomeGuide";
import SettingsPanel, { loadPrefs, savePrefs, DEFAULT_PREFS } from "./SettingsPanel";
import { sameDay } from "./CalendarWidget";
import SmsFriend, { useSmsUnread } from "./SmsFriend";
import { downloadPdf, downloadDocx } from "./exportDoc";



// Short follow-ups the backend already treats as "continue the previous topic".
const FOLLOW_UPS = [
  ["Simplify", "Simplify"],
  ["More detail", "Explain in detail"],
  ["Give an example", "Give an example"],
  ["Continue", "Continue"],
];

// Type "/" in the composer to open these.
const SLASH_COMMANDS = [
  ["/explain", "Explain a topic simply", "Explain this simply with a real-life example: "],
  ["/summarize", "Summarize pasted text", "Summarize the following in 5 bullet points:\n"],
  ["/code", "Write code", "Write clean, commented code for: "],
  ["/fix", "Debug code", "Find and fix the bug in this code and explain the fix:\n"],
  ["/email", "Draft an email", "Write a professional email about: "],
  ["/plan", "Step-by-step plan", "Create a step-by-step plan for: "],
  ["/quiz", "Practice quiz", "Create a 5-question quiz with answers on: "],
  ["/compare", "Comparison table", "Compare the following in a table: "],
];

function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, now)) return `Today · ${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Close unfinished markdown while the typing effect is mid-way.
function balanceMarkdown(text) {
  let out = text;
  if ((out.match(/```/g) || []).length % 2) out += "\n```";
  else if ((out.match(/`/g) || []).length % 2) out += "`";
  if ((out.match(/\*\*/g) || []).length % 2) out += "**";
  return out;
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\$\$[\s\S]*?\$\$/g, " formula ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_>~|-]{1,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

  const fileName = String(excelData.fileName || "Global-Excel")
    .replace(/\.xlsx$/i, "")
    .replace(/[^a-z0-9_-]/gi, "-")
    .slice(0, 80) || "Global-Excel";

  return {
    excelDownloadUrl: URL.createObjectURL(blob),
    excelFileName: fileName,
  };
}

const mdComponents = {
  code: CodeBlock,
  p({ children, ...props }) { return <p className="gb-md-paragraph" {...props}>{children}</p>; },
  h1({ children, ...props }) { return <h1 className="gb-md-heading" {...props}>{children}</h1>; },
  h2({ children, ...props }) { return <h2 className="gb-md-heading" {...props}>{children}</h2>; },
  h3({ children, ...props }) { return <h3 className="gb-md-heading" {...props}>{children}</h3>; },
  ul({ children, ...props }) { return <ul className="gb-md-list" {...props}>{children}</ul>; },
  ol({ children, ...props }) { return <ol className="gb-md-list" {...props}>{children}</ol>; },
};

const SpeechRec = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

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
  const [showWebsiteBuilder, setShowWebsiteBuilder] = useState(false);
  const [showFeatureHub, setShowFeatureHub] = useState(false);
  const [websitePrompt, setWebsitePrompt] = useState("");
  const [websiteLoading, setWebsiteLoading] = useState(false);
  const [websiteError, setWebsiteError] = useState("");
  const [generatedWebsite, setGeneratedWebsite] = useState(null);
  const [showIntro, setShowIntro] = useState(true);
  const endIntro = useCallback(() => setShowIntro(false), []);

  const [showGuide, setShowGuide] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [customTitles, setCustomTitles] = useState({});
  const [historySearch, setHistorySearch] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [typing, setTyping] = useState(null); // { index, shown, total }
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editText, setEditText] = useState("");
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(-1);
  const [dragging, setDragging] = useState(false);
  const [avatar, setAvatar] = useState("");
  const [showProfileView, setShowProfileView] = useState(false);
  const [notesAsked, setNotesAsked] = useState({}); // ts -> "done"
  const [notesBusy, setNotesBusy] = useState(false);
  const [showSms, setShowSms] = useState(false);
  const [downloadMenu, setDownloadMenu] = useState(-1);
  const [questionMenu, setQuestionMenu] = useState(-1);
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    try { return localStorage.getItem("global-side-collapsed") === "1"; } catch { return false; }
  });
  const sms = useSmsUnread(authUser?.id);

  // Report active time (visible tab + recent activity) so the owner can see daily usage.
  useEffect(() => {
    if (!authUser?.id) return undefined;
    const STEP = 30; // seconds between reports
    let lastActivity = Date.now();
    const mark = () => { lastActivity = Date.now(); };
    const events = ["mousemove", "keydown", "touchstart", "scroll", "click"];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    async function beat() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivity > 120000) return; // idle for 2 minutes
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) return;
        await fetch("/api/usage/heartbeat", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ seconds: STEP }),
        });
      } catch { /* offline — try again next time */ }
    }

    const timer = window.setInterval(beat, STEP * 1000);
    const first = window.setTimeout(beat, 5000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
      events.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [authUser?.id]);
  const avatarInputRef = useRef(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const abortRef = useRef(null);
  const recogRef = useRef(null);
  const scrollRef = useRef(null);
  const shortcutRef = useRef({});


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
        JSON.parse(localStorage.getItem(`global-pinned-chats-${authUser.id}`) || "[]")
      );
    } catch {
      setPinnedChats([]);
    }
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) return;
    try {
      localStorage.setItem(
        `global-pinned-chats-${authUser.id}`,
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
    if (!id || !authUser?.id || !nextMessages.length || temporary) return;

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

  // The latest spreadsheet in this chat, so "add more rows" extends it.
  function getPreviousExcel(sourceMessages) {
    const last = [...sourceMessages].reverse().find((m) => m.role === "assistant" && m.excelData?.headers?.length);
    if (!last) return null;
    const { fileName, headers, rows } = last.excelData;
    return { fileName, headers, rows: (rows || []).slice(0, 500) };
  }

  function getRequestHistory(sourceMessages) {
    return sourceMessages
      .filter((item) =>
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string"
      )
      .slice(-18)
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

  async function sendMessage(text = input, opts = {}) {
    const message = text.trim();
    const newlySelectedAttachment = "attachment" in opts ? opts.attachment : selectedAttachment;

    // If no new file is selected, reuse the current chat's image/file.
    const attachment = newlySelectedAttachment || contextAttachment;

    if ((!message && !attachment) || loading) return;

    const finalMessage = message ||
      `Please analyze the attached file: ${attachment.name}`;

    setError("");
    setSidebarOpen(false);
    if (message === input.trim()) setInput("");

    const baseMessages = opts.base ?? messages;
    const chatId = currentChatId || createId();

    const userMessages = [
      ...baseMessages,
      {
        role: "user",
        ts: Date.now(),
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
        signal: (abortRef.current = new AbortController()).signal,
        body: JSON.stringify({
          message: finalMessage,
          attachment: getRequestAttachment(attachment),
          preferences: buildPreferences(),
          previousExcel: getPreviousExcel(baseMessages),
          history: getRequestHistory(baseMessages),
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
      let excelFileName = "Global-Excel";

      if (data.excelData) {
        const result = await createExcelDownload(data.excelData);
        excelDownloadUrl = rememberExcelUrl(result.excelDownloadUrl);
        excelFileName = result.excelFileName;
      }

      const updatedMessages = [
        ...userMessages,
        {
          role: "assistant",
          ts: Date.now(),
          content: data.answer,
          sources: Array.isArray(data.sources) ? data.sources : [],
          excelData: data.excelData || null,
          excelDownloadUrl,
          excelFileName,
        },
      ];

      setMessages(updatedMessages);
      startTyping(updatedMessages.length - 1, data.answer);

      // Keep the file in React state for subsequent follow-up questions.
      if (attachment) setContextAttachment(attachment);

      setSelectedAttachment(null);
      await saveConversation(chatId, updatedMessages);
    } catch (err) {
      if (err?.name !== "AbortError") {
        setError(err.message || "Could not connect to Global AI. Check that the server is running.");
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }


  async function createWebsite() {
    const prompt = websitePrompt.trim();
    if (!prompt || websiteLoading) return;
    setWebsiteLoading(true);
    setWebsiteError("");
    setGeneratedWebsite(null);
    try {
      const response = await fetch("/api/create-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Website creation failed.");
      if (!data.files || typeof data.files["index.html"] !== "string") {
        throw new Error("AI did not return a valid index.html. Please try a clearer description.");
      }
      setGeneratedWebsite({ name: data.name || "my-website", files: data.files });
    } catch (err) {
      setWebsiteError(err.message || "Could not create the website.");
    } finally {
      setWebsiteLoading(false);
    }
  }

  function getWebsitePreview() {
    if (!generatedWebsite) return "";
    const files = generatedWebsite.files;
    let html = files["index.html"];
    const cssText = files["style.css"] || "";
    const jsText = files["script.js"] || "";

    if (cssText) {
      const inlineStyle = `<style>\n${cssText}\n</style>`;
      if (/<link\b[^>]*href=["'](?:\.\/)?style\.css["'][^>]*>/i.test(html)) {
        html = html.replace(/<link\b[^>]*href=["'](?:\.\/)?style\.css["'][^>]*>/i, inlineStyle);
      } else {
        html = html.replace("</head>", `${inlineStyle}\n</head>`);
      }
    }
    if (jsText) {
      const inlineScript = `<script>\n${jsText}\n</script>`;
      if (/<script\b[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i.test(html)) {
        html = html.replace(/<script\b[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i, inlineScript);
      } else {
        html = html.replace("</body>", `${inlineScript}\n</body>`);
      }
    }
    return html;
  }

  async function downloadWebsiteZip() {
    if (!generatedWebsite) return;
    const zip = new JSZip();
    Object.entries(generatedWebsite.files).forEach(([fileName, content]) => zip.file(fileName, content));
    zip.file("README.md", `# ${generatedWebsite.name}\n\nGenerated with Global AI.\n\nOpen index.html in a browser, or open this folder in VS Code to edit the HTML, CSS and JavaScript files.`);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${generatedWebsite.name || "my-website"}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // --------------------------------------------------
  // FILE SELECTION
  // Allowed: JPG, PNG, WEBP, GIF, PDF, DOCX, TXT, CSV, MD
  // --------------------------------------------------

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    processFile(file);
  }

  function handlePaste(event) {
    const file = Array.from(event.clipboardData?.files || [])[0];
    if (file) {
      event.preventDefault();
      processFile(file);
    }
  }

  function processFile(file) {
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
        signal: (abortRef.current = new AbortController()).signal,
        body: JSON.stringify({
          message: question,
          attachment: getRequestAttachment(attachment),
          preferences: buildPreferences(),
          previousExcel: getPreviousExcel(messages.slice(0, questionIndex)),
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
      let excelFileName = "Global-Excel";

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
              ts: Date.now(),
              feedback: undefined,
              sources: Array.isArray(data.sources) ? data.sources : [],
              excelData: data.excelData || null,
              excelDownloadUrl,
              excelFileName,
            }
          : item
      );

      setMessages(nextMessages);
      startTyping(answerIndex, data.answer);
      if (attachment) setContextAttachment(attachment);
      if (currentChatId) await saveConversation(currentChatId, nextMessages);
    } catch (err) {
      if (err?.name !== "AbortError") setError(err.message || "Could not regenerate the answer.");
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
    setTyping(null);
    setEditingIndex(-1);
    window.speechSynthesis?.cancel();
    setSpeakingIndex(-1);
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
    setTyping(null);
    setEditingIndex(-1);
    window.speechSynthesis?.cancel();
    setSpeakingIndex(-1);
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

  // --------------------------------------------------
  // PREFERENCES, GUIDE, TITLES (per signed-in user)
  // --------------------------------------------------

  useEffect(() => {
    if (!authUser?.id) return;
    setPrefs(loadPrefs(authUser.id));
    try {
      setCustomTitles(JSON.parse(localStorage.getItem(`global-chat-titles-${authUser.id}`) || "{}"));
      setAvatar(localStorage.getItem(`global-avatar-${authUser.id}`) || "");
      if (!localStorage.getItem(`global-welcome-seen-${authUser.id}`)) setShowGuide(true);
    } catch {
      setCustomTitles({});
    }
  }, [authUser?.id]);

  function handleAvatarFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) {
      if (file) setError("Please choose an image file for your profile photo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 192;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const side = Math.min(img.width, img.height);
        canvas.getContext("2d").drawImage(
          img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size
        );
        const url = canvas.toDataURL("image/jpeg", 0.88);
        setAvatar(url);
        try { localStorage.setItem(`global-avatar-${authUser.id}`, url); } catch { /* storage full */ }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function removeAvatar() {
    setAvatar("");
    try { localStorage.removeItem(`global-avatar-${authUser.id}`); } catch { /* ignore */ }
  }

  // Turn an answer into short, simple notes and open them in the Notepad.
  async function makeShortNotes(index) {
    const answer = messages[index];
    const question = messages.slice(0, index).findLast((m) => m.role === "user");
    if (!answer || notesBusy) return;
    setNotesBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Make short notes from the text below. Use very simple words. Maximum 6 bullet points, each one short line. Add a one-line title first. Text:\n" +
            removeAnswerSources(answer.content).slice(0, 2800),
          skipSearch: true,
          history: [],
          preferences: { ...buildPreferences(), style: "short" },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.answer) throw new Error(data.error || "Could not make notes.");
      const lines = String(data.answer).trim().split("\n");
      const title = (question?.content || "Short notes").slice(0, 60);
      const body = lines.join("\n").replace(/^#+\s*/gm, "").replace(/\*\*/g, "");
      window.dispatchEvent(new CustomEvent("global-add-note", { detail: { title, content: body } }));
    } catch (err) {
      setError(err.message || "Could not make notes.");
    } finally {
      setNotesBusy(false);
      setNotesAsked((prev) => ({ ...prev, [answer.ts]: "done" }));
    }
  }

  function finishGuide() {
    try { localStorage.setItem(`global-welcome-seen-${authUser?.id}`, "1"); } catch { /* ignore */ }
    setShowGuide(false);
  }

  function updatePrefs(next) {
    setPrefs(next);
    if (authUser?.id) savePrefs(authUser.id, next);
  }

  function buildPreferences() {
    const now = new Date();
    return {
      style: prefs.style,
      instructions: prefs.instructions.trim(),
      date: now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  function renameChat(event, chat) {
    event.stopPropagation();
    const next = window.prompt("Rename chat", chat.displayTitle || chat.title);
    if (next === null) return;
    const updated = { ...customTitles };
    if (next.trim()) updated[chat.id] = next.trim().slice(0, 60);
    else delete updated[chat.id];
    setCustomTitles(updated);
    try { localStorage.setItem(`global-chat-titles-${authUser.id}`, JSON.stringify(updated)); } catch { /* ignore */ }
  }

  const visibleHistory = history
    .map((chat) => ({ ...chat, displayTitle: customTitles[chat.id] || chat.title }))
    .filter((chat) => {
      const q = historySearch.trim().toLowerCase();
      if (!q) return true;
      return chat.displayTitle.toLowerCase().includes(q) ||
        chat.messages.some((m) => typeof m.content === "string" && m.content.toLowerCase().includes(q));
    });

  function groupHistory(chats) {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86400000;
    const buckets = [["Pinned", []], ["Today", []], ["Yesterday", []], ["Previous 7 days", []], ["Older", []]];
    [...chats].sort((a, b) => b.updatedAt - a.updatedAt).forEach((chat) => {
      let idx = 4;
      if (pinnedChats.includes(chat.id)) idx = 0;
      else if (chat.updatedAt >= startToday) idx = 1;
      else if (chat.updatedAt >= startToday - day) idx = 2;
      else if (chat.updatedAt >= startToday - 7 * day) idx = 3;
      buckets[idx][1].push(chat);
    });
    return buckets.filter(([, list]) => list.length);
  }

  // --------------------------------------------------
  // TYPING EFFECT, STOP, SCROLL
  // --------------------------------------------------

  function startTyping(index, answer) {
    if (!prefs.typewriter) return;
    const total = removeAnswerSources(answer).length;
    if (total > 0) setTyping({ index, shown: 0, total });
  }

  useEffect(() => {
    if (!typing) return undefined;
    if (typing.shown >= typing.total) {
      setTyping(null);
      return undefined;
    }
    const step = Math.max(3, Math.ceil(typing.total / 80));
    const id = window.setTimeout(
      () => setTyping((t) => (t ? { ...t, shown: Math.min(t.total, t.shown + step) } : t)),
      22
    );
    return () => window.clearTimeout(id);
  }, [typing]);

  useEffect(() => {
    if (typing && !showScrollDown) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [typing?.shown]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopGenerating() {
    abortRef.current?.abort();
    setTyping(null);
  }

  function handleScroll(event) {
    const el = event.currentTarget;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 260);
  }

  // Auto-grow the composer textarea.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input, authUser]);

  // --------------------------------------------------
  // MESSAGE ACTIONS: edit, feedback, read aloud, export
  // --------------------------------------------------

  function startEdit(index) {
    setEditingIndex(index);
    setEditText(messages[index].content);
  }

  function submitEdit(index) {
    const text = editText.trim();
    if (!text || loading) return;
    const original = messages[index];
    setEditingIndex(-1);
    sendMessage(text, {
      base: messages.slice(0, index),
      attachment: original.attachment?.data ? original.attachment : null,
    });
  }

  function setFeedback(index, value) {
    const next = messages.map((m, i) =>
      i === index ? { ...m, feedback: m.feedback === value ? undefined : value } : m
    );
    setMessages(next);
    if (currentChatId) saveConversation(currentChatId, next);
  }

  function speak(content, index) {
    const synth = window.speechSynthesis;
    if (!synth) {
      setError("Read aloud is not supported in this browser.");
      return;
    }
    if (speakingIndex === index) {
      synth.cancel();
      setSpeakingIndex(-1);
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(stripMarkdown(removeAnswerSources(content)));
    utterance.lang = "en-IN";
    utterance.onend = () => setSpeakingIndex(-1);
    utterance.onerror = () => setSpeakingIndex(-1);
    setSpeakingIndex(index);
    synth.speak(utterance);
  }

  const speechSupported = Boolean(SpeechRec);

  function toggleListening() {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    if (!SpeechRec) return;
    const recognition = new SpeechRec();
    recognition.lang = prefs.voiceLang;
    recognition.interimResults = true;
    recognition.continuous = false;
    const base = input ? `${input.trimEnd()} ` : "";
    recognition.onresult = (event) => {
      let text = "";
      for (const result of event.results) text += result[0].transcript;
      setInput(base + text);
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access is blocked. Allow the microphone in your browser settings.");
      }
    };
    recognition.onend = () => setListening(false);
    recogRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function exportChat() {
    if (!messages.length) return;
    const title = makeTitle(messages) || "Global AI chat";
    const body = messages
      .map((m) => {
        const who = m.role === "user" ? "You" : "Global AI";
        const when = m.ts ? ` — ${new Date(m.ts).toLocaleString()}` : "";
        return `### ${who}${when}\n\n${m.content}`;
      })
      .join("\n\n---\n\n");
    const blob = new Blob([`# ${title}\n\n${body}\n`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50) || "global-ai-chat"}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function toggleTemporary() {
    if (loading) return;
    setTemporary((on) => !on);
    // Start from a clean slate so saved and unsaved chats never mix.
    setCurrentChatId(null);
    setMessages([]);
    setContextAttachment(null);
    setSelectedAttachment(null);
    setError("");
  }

  const slashMatches = /^\/\S*$/.test(input)
    ? SLASH_COMMANDS.filter(([cmd]) => cmd.startsWith(input.toLowerCase()))
    : [];

  // Keyboard shortcuts (always call the latest handlers).
  function toggleSidebar() {
    if (window.matchMedia("(min-width: 1100px)").matches) {
      setSideCollapsed((c) => {
        const next = !c;
        try { localStorage.setItem("global-side-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
        return next;
      });
    } else {
      setSidebarOpen((o) => !o);
    }
  }

  shortcutRef.current = { newChat, toggleSidebar, setShowSettings };
  useEffect(() => {
    function onKey(event) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "n" && event.altKey) { event.preventDefault(); shortcutRef.current.newChat(); }
      else if (key === "b") { event.preventDefault(); shortcutRef.current.toggleSidebar(); }
      
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.speechSynthesis?.cancel();
    };
  }, []);

  if (isOwnerRoute) return <OwnerDashboard />;
  if (!authReady) return <><div className="gx-boot">Loading Global AI...</div>{showIntro && <StartIntro onDone={endIntro} />}</>;

  if (!authUser && !isOwner) {
    return (
      <>
        <Auth
          onLogin={setAuthUser}
          onOwnerLogin={(token) => {
            setOwnerToken(token);
            setIsOwner(true);
          }}
        />
        {showIntro && <StartIntro onDone={endIntro} />}
      </>
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

  const userName = authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || "";
  const firstName = userName.trim().split(/\s+/)[0];
  const lastIndex = messages.length - 1;
  const lastAssistantIndex = messages.findLastIndex((m) => m.role === "assistant");
  const groups = groupHistory(visibleHistory);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div
      className={`global-app gb-with-sidebar gx-app${sideCollapsed ? " is-collapsed" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); processFile(e.dataTransfer?.files?.[0]); }}
    >
      {showIntro && <StartIntro onDone={endIntro} />}
      {showGuide && <WelcomeGuide name={userName} onComplete={finishGuide} />}
      {dragging && <div className="gx-drop"><Paperclip size={34} /><strong>Drop a file to attach</strong><span>Images, PDF, Word, TXT, CSV, MD</span></div>}
      {showSettings && (
        <SettingsPanel prefs={prefs} onChange={updatePrefs} onClose={() => setShowSettings(false)} />
      )}
      {showFeatureHub && (
        <FeatureHub
          onPickFile={(prefill) => {
            setShowFeatureHub(false);
            setInput(prefill || "");
            window.setTimeout(() => fileInputRef.current?.click(), 50);
          }}
          onClose={() => setShowFeatureHub(false)}
          onUse={(prompt) => {
            setShowFeatureHub(false);
            sendMessage(prompt);
          }}
        />
      )}
      {showWebsiteBuilder && (
        <div className="gb-website-overlay" role="dialog" aria-modal="true" aria-label="Website builder">
          <section className="gb-website-panel">
            <header className="gb-website-header">
              <div><strong>Website Creator</strong><span>Describe your website in simple words</span></div>
              <button type="button" onClick={() => setShowWebsiteBuilder(false)} aria-label="Close website creator"><X size={20} /></button>
            </header>
            <textarea className="gb-website-prompt" value={websitePrompt}
              onChange={(event) => setWebsitePrompt(event.target.value)}
              placeholder="Example: Create a modern portfolio website with a dark background, blue and purple colours, home, about, projects and contact sections..."
              rows={5} />
            <button className="gb-website-create" type="button" onClick={createWebsite}
              disabled={!websitePrompt.trim() || websiteLoading}>
              {websiteLoading ? "Creating website..." : "Create Website"}
            </button>
            {websiteError && <p className="gb-website-error" role="alert">{websiteError}</p>}
            {generatedWebsite && (
              <div className="gb-website-result">
                <div className="gb-website-result-title">
                  <strong>{generatedWebsite.name}</strong>
                  <span>{Object.keys(generatedWebsite.files).join(" · ")}</span>
                </div>
                <div className="gb-website-actions">
                  <button type="button" onClick={() => {
                    const preview = window.open("", "_blank");
                    if (preview) {
                      preview.opener = null;
                      preview.document.open();
                      preview.document.write(getWebsitePreview());
                      preview.document.close();
                    } else setWebsiteError("Allow pop-ups to view your website preview.");
                  }}><Eye size={16} /> View</button>
                  <button type="button" onClick={downloadWebsiteZip}><Download size={16} /> Download ZIP</button>
                </div>
                <p className="gb-website-help">Download ZIP pannitu extract செய்து VS Code-la folder open pannalaam.</p>
              </div>
            )}
          </section>
        </div>
      )}
      {showSms && <SmsFriend user={authUser} sms={sms} onClose={() => setShowSms(false)} />}
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
        <button className="gb-sidebar-backdrop" type="button" aria-label="Close history sidebar"
          onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`gb-sidebar gx-sidebar ${sidebarOpen ? "gb-sidebar-open" : ""}`} aria-label="Chat history">
        <div className="gx-side-top">
          <button className="gx-side-new" type="button" onClick={newChat} disabled={loading}>
            <Plus size={18} /> New chat
          </button>
          <button type="button" className="gx-side-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <PanelLeftClose size={19} />
          </button>
        </div>

        <label className="gx-side-search">
          <Search size={16} />
          <input type="search" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
            placeholder="Search chats" aria-label="Search chats" />
          {historySearch && <button type="button" onClick={() => setHistorySearch("")} aria-label="Clear search"><X size={14} /></button>}
        </label>

        <div className="gx-side-tools">
          <button type="button" onClick={() => { setShowFeatureHub(true); setSidebarOpen(false); }}>
            <Sparkles size={17} /> Explore AI Features
          </button>
          <button type="button" onClick={() => { setShowSms(true); setSidebarOpen(false); }}>
            <MessageCircle size={17} /> SMS Friend
            {sms.total > 0 && <b className="gx-side-badge">{sms.total > 99 ? "99+" : sms.total}</b>}
          </button>
          <button type="button" onClick={() => { setShowWebsiteBuilder(true); setSidebarOpen(false); }}>
            <Globe2 size={17} /> Website Creator
          </button>
          <button type="button" className={temporary ? "is-on" : ""}
            onClick={() => { toggleTemporary(); setSidebarOpen(false); }}>
            <Ghost size={17} /> {temporary ? "Leave temporary chat" : "Temporary chat"}
          </button>
          {messages.length > 0 && (
            <button type="button" onClick={() => { exportChat(); setSidebarOpen(false); }}>
              <FileDown size={17} /> Export chat
            </button>
          )}
        </div>

        <div className="gb-history-list gx-history">
          {history.length === 0 ? (
            <div className="gb-history-empty">
              <MessageSquare size={22} />
              <p>Your conversations will appear here.</p>
            </div>
          ) : groups.length === 0 ? (
            <div className="gb-history-empty"><Search size={22} /><p>No chats match &ldquo;{historySearch}&rdquo;.</p></div>
          ) : (
            groups.map(([label, chats]) => (
              <div key={label} className="gx-history-group">
                <h4>{label}</h4>
                {chats.map((chat) => (
                  <div key={chat.id}
                    className={`gb-history-item ${currentChatId === chat.id ? "gb-history-active" : ""}`}>
                    <button type="button" className="gb-history-open" onClick={() => openConversation(chat)}
                      disabled={loading} title={chat.displayTitle}>
                      {pinnedChats.includes(chat.id) ? <Pin size={14} fill="currentColor" /> : <MessageSquare size={15} />}
                      <span>{chat.displayTitle}</span>
                    </button>
                    <div className="gx-history-actions">
                      <button type="button" onClick={(e) => renameChat(e, chat)} aria-label="Rename chat" title="Rename"><Pencil size={14} /></button>
                      <button type="button" onClick={(event) => togglePinChat(event, chat.id)}
                        aria-label={pinnedChats.includes(chat.id) ? "Unpin chat" : "Pin chat"}
                        title={pinnedChats.includes(chat.id) ? "Unpin chat" : "Pin chat"}>
                        <Pin size={14} fill={pinnedChats.includes(chat.id) ? "currentColor" : "none"} />
                      </button>
                      <button type="button" onClick={(event) => deleteConversation(event, chat.id)}
                        disabled={loading} aria-label={`Delete ${chat.displayTitle}`} title="Delete chat">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="gx-side-footer">
          <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={handleAvatarFile} />
          <button type="button" className="gx-profile gx-profile-trigger" onClick={() => setShowProfileView(true)}
            aria-label="Open profile" title="Open profile">
            <span className="gx-profile-avatar">
              {avatar ? <img src={avatar} alt="Your profile" /> : <UserRound size={19} />}
            </span>
            <span className="gx-profile-identity">
              <strong>{userName || "My Profile"}</strong>
              <span>{authUser?.email}</span>
            </span>
          </button>
          <details className="gx-side-footer-menu">
            <summary aria-label="Profile options" title="Profile options">
              <MoreHorizontal size={21} />
            </summary>
            <div className="gx-side-footer-menu-list">
              <button type="button" onClick={() => { setShowSettings(true); setSidebarOpen(false); }}>
                <SlidersHorizontal size={15} /> Personalise
              </button>
              <button type="button" onClick={clearHistory} disabled={loading || history.length === 0}>
                <Trash2 size={15} /> Clear
              </button>
              <button type="button" onClick={handleLogout} disabled={loading}>
                <LogOut size={15} /> Logout
              </button>
            </div>
          </details>
        </div>
      </aside>

      <div className="gb-workspace gx-workspace">
        <header className="gx-header">
          <div className="gx-header-left">
            <button className="gx-icon-btn gx-menu" type="button"
              onClick={toggleSidebar}
              aria-label="Show or hide chat history" aria-expanded={sidebarOpen || !sideCollapsed}>
              {sidebarOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
            <a className="gx-brand" href="/" aria-label="Global AI home">
              <GlobalLogo size={46} animate="none" crisp className="gx-brand-logo" />
              <span><strong>Global <b>AI</b></strong><small>Smart · Helpful · Always Here</small></span>
            </a>
          </div>
          <div className="gx-header-actions">
            <button className="gx-pill" type="button" onClick={newChat} disabled={loading}>
              <Plus size={18} /><span>New chat</span>
            </button>
            <button className="gx-pill gx-pill-accent" type="button" onClick={() => setShowFeatureHub(true)}>
              <Sparkles size={17} /><span>AI Tools</span>
            </button>
            <ReportProblem />
          </div>
        </header>

        {temporary && (
          <div className="gx-temp-banner"><Ghost size={15} /> Temporary chat — this conversation won&apos;t be saved to your history.</div>
        )}

        <main className="gx-scroll" ref={scrollRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <section className="gx-welcome">
              <GlobalLogo size={150} animate="loop" className="gx-hero-logo" />
              <p className="gx-greeting">{greeting}{firstName ? `, ${firstName}` : ""} 👋</p>
              <h1>Ideas start here. <span>Let&apos;s explore</span> together.</h1>
              <p className="gx-welcome-desc">
                Ask questions, learn something new, or write code with Global AI.
              </p>
            </section>
          ) : (
            <section className="gx-messages" aria-live="polite">
              {messages.map((message, index) => {
                const isUser = message.role === "user";
                const prev = messages[index - 1];
                const showDay = isUser && message.ts;
                const isTyping = typing?.index === index;
                const shownText = isUser
                  ? message.content
                  : removeAnswerSources(message.content);
                const displayText = isTyping ? balanceMarkdown(shownText.slice(0, typing.shown)) : shownText;

                return (
                  <div key={`${message.role}-${index}`} className="gx-msg-wrap">
                    {showDay && <div className="gx-day"><span>{dayLabel(message.ts)}</span></div>}
                    <article className={`gx-msg ${isUser ? "is-user" : "is-ai"}`}>
                      <div className="gx-avatar">
                        {isUser ? (avatar ? <img src={avatar} alt="You" /> : <UserRound size={18} />) : <GlobalLogo size={24} animate="none" crisp />}
                      </div>

                      <div className="gx-msg-body">
                        <div className="gx-msg-meta">
                          <strong>{isUser ? "You" : "Global AI"}</strong>
                          {message.ts && <time dateTime={new Date(message.ts).toISOString()}>{timeLabel(message.ts)}</time>}
                        </div>

                        {editingIndex === index ? (
                          <div className="gx-edit">
                            <textarea value={editText} autoFocus rows={3}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingIndex(-1);
                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitEdit(index);
                              }} />
                            <div>
                              <button type="button" className="gx-edit-cancel" onClick={() => setEditingIndex(-1)}>Cancel</button>
                              <button type="button" onClick={() => submitEdit(index)} disabled={!editText.trim()}>Save &amp; submit</button>
                            </div>
                          </div>
                        ) : (
                          <div className="gb-message-text gx-msg-text">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkMath]}
                              rehypePlugins={[rehypeKatex]}
                              components={mdComponents}
                            >
                              {displayText}
                            </ReactMarkdown>
                            {isTyping && <span className="gx-caret" aria-hidden="true" />}

                            {message.excelDownloadUrl && (
                              <a href={message.excelDownloadUrl}
                                download={`${message.excelFileName || "Global-Excel"}.xlsx`}
                                className="gb-excel-download">
                                Download Excel
                              </a>
                            )}
                          </div>
                        )}

                        {isUser && message.attachment && (
                          <div className="gb-message-attachment">
                            {message.attachment.isImage && message.attachment.previewUrl ? (
                              <>
                                <img src={message.attachment.previewUrl} alt="Uploaded image" className="gb-sent-thumbnail" />
                                <button type="button" onClick={() => setViewerImageUrl(message.attachment.previewUrl)}>
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

                        {!isUser && message.sources?.length > 0 && !isTyping && (
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

                        {!isTyping && editingIndex !== index && (
                          <div className="gx-actions">
                            {isUser ? (
                              <div className="gx-question-menu-wrap">
                                <button type="button" className="gx-question-menu-trigger" onClick={() => setQuestionMenu(questionMenu === index ? -1 : index)} aria-label="Question options" aria-expanded={questionMenu === index} title="Question options"><MoreHorizontal size={18} /></button>
                                {questionMenu === index && <div className="gx-question-menu" role="menu">
                                  <button type="button" role="menuitem" onClick={() => { setQuestionMenu(-1); startEdit(index); }} disabled={loading}><Pencil size={14} /> Edit</button>
                                  <button type="button" role="menuitem" onClick={() => { setQuestionMenu(-1); copyAnswer(message.content, index); }}><Copy size={14} /> Copy</button>
                                  <button type="button" role="menuitem" className="is-danger" onClick={() => { setQuestionMenu(-1); deleteMessagePair(index); }} disabled={loading}><Trash2 size={14} /> Delete</button>
                                </div>}
                              </div>
                            ) : (
                              <>
                                <button type="button" onClick={() => copyAnswer(message.content, index)} title="Copy answer">
                                  {copiedIndex === index ? <Check size={15} /> : <Copy size={15} />}<span>{copiedIndex === index ? "Copied" : "Copy"}</span>
                                </button>
                                <button type="button" onClick={() => speak(message.content, index)} title={speakingIndex === index ? "Stop reading" : "Read aloud"}>
                                  {speakingIndex === index ? <VolumeX size={15} /> : <Volume2 size={15} />}<span>{speakingIndex === index ? "Stop" : "Listen"}</span>
                                </button>
                                <button type="button" onClick={() => regenerateAnswer(index)} disabled={loading} title="Regenerate answer"><RotateCcw size={15} /><span>Regenerate</span></button>
                                <span className="gx-dl-wrap">
                                  <button type="button" onClick={() => setDownloadMenu(downloadMenu === index ? -1 : index)} title="Download as PDF or Word" aria-expanded={downloadMenu === index}><FileDown size={15} /><span>Download</span></button>
                                  {downloadMenu === index && (
                                    <span className="gx-dl-menu" role="menu">
                                      <button type="button" role="menuitem" onClick={() => { setDownloadMenu(-1); downloadPdf(makeTitle(messages.slice(0, index + 1).filter((m) => m.role === "user").slice(-1)) || "Global AI", removeAnswerSources(message.content)).catch(() => setError("Could not create the PDF.")); }}>PDF (.pdf)</button>
                                      <button type="button" role="menuitem" onClick={() => { setDownloadMenu(-1); downloadDocx(makeTitle(messages.slice(0, index + 1).filter((m) => m.role === "user").slice(-1)) || "Global AI", removeAnswerSources(message.content)).catch(() => setError("Could not create the Word file.")); }}>Word (.docx)</button>
                                    </span>
                                  )}
                                </span>
                                <button type="button" className={message.feedback === "up" ? "is-on" : ""} onClick={() => setFeedback(index, "up")} aria-pressed={message.feedback === "up"} title="Good answer"><ThumbsUp size={15} /></button>
                                <button type="button" className={message.feedback === "down" ? "is-on" : ""} onClick={() => setFeedback(index, "down")} aria-pressed={message.feedback === "down"} title="Bad answer"><ThumbsDown size={15} /></button>
                              </>
                            )}
                          </div>
                        )}

                        {!isUser && index === lastAssistantIndex && index === lastIndex && !loading && !isTyping &&
                          message.ts && !notesAsked[message.ts] && removeAnswerSources(message.content).length > 60 && (
                          <div className="gx-notes-ask" role="group" aria-label="Short notes">
                            <span><NotebookPen size={18} /> Simple short notes eduka venuma?</span>
                            <button type="button" disabled={notesBusy} onClick={() => makeShortNotes(index)}>
                              {notesBusy ? "Making notes…" : "Yes, open notes"}
                            </button>
                            <button type="button" className="is-no" disabled={notesBusy}
                              onClick={() => setNotesAsked((prev) => ({ ...prev, [message.ts]: "no" }))}>No</button>
                          </div>
                        )}

                        {!isUser && index === lastAssistantIndex && index === lastIndex && !loading && !isTyping && (
                          <div className="gx-followups">
                            {FOLLOW_UPS.map(([label, prompt]) => (
                              <button type="button" key={label} onClick={() => sendMessage(prompt)}>{label}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  </div>
                );
              })}

              {loading && (
                <article className="gx-msg is-ai">
                  <div className="gx-avatar"><GlobalLogo size={24} animate="none" /></div>
                  <div className="gx-msg-body">
                    <div className="gx-msg-meta"><strong>Global AI</strong></div>
                    <div className="gb-thinking">
                      <span className="gb-earth" aria-hidden="true">🌍</span>
                      <span className="gb-thinking-text">Thinking...</span>
                    </div>
                  </div>
                </article>
              )}
              <div ref={bottomRef} />
            </section>
          )}
        </main>

        {showScrollDown && messages.length > 0 && (
          <button type="button" className="gx-scroll-down" onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })} aria-label="Scroll to latest message">
            <ArrowDown size={18} />
          </button>
        )}

        <footer className="gx-composer">
          {error && <div className="gb-error gx-error" role="alert">{error}</div>}

          <input ref={fileInputRef} type="file" accept={FILE_INPUT_ACCEPT} hidden onChange={handleFileChange} />

          {selectedAttachment && (
            <div className="gb-attachment-preview gx-attach">
              {selectedAttachment.isImage ? (
                <img src={selectedAttachment.previewUrl} alt="Selected upload preview" className="gb-attachment-thumbnail" />
              ) : <FileText size={25} />}
              <span className="gb-attachment-name">{selectedAttachment.name}</span>
              {selectedAttachment.isImage && (
                <button type="button" onClick={() => setViewerImageUrl(selectedAttachment.previewUrl)}>
                  <Eye size={15} /> View
                </button>
              )}
              <button type="button" aria-label="Remove attachment" onClick={() => setSelectedAttachment(null)}>
                <X size={16} />
              </button>
            </div>
          )}

          {!selectedAttachment && contextAttachment && (
            <div className="gb-attachment-preview gx-attach">
              {contextAttachment.isImage ? (
                <img src={contextAttachment.previewUrl} alt="Current chat image context" className="gb-attachment-thumbnail" />
              ) : <FileText size={25} />}
              <span className="gb-attachment-name">Context retained: {contextAttachment.name}</span>
              <button type="button" onClick={() => setContextAttachment(null)}
                title="Stop using previous file for follow-up questions" aria-label="Clear retained file context">
                <X size={16} />
              </button>
            </div>
          )}

          {slashMatches.length > 0 && (
            <div className="gx-slash" role="listbox" aria-label="Commands">
              {slashMatches.map(([cmd, hint, template]) => (
                <button type="button" key={cmd} role="option" onClick={() => { setInput(template); inputRef.current?.focus(); }}>
                  <code>{cmd}</code><span>{hint}</span>
                </button>
              ))}
            </div>
          )}

          <form className="gx-input-form" onSubmit={handleSubmit}>
            <button className="gx-tool" type="button" title="Upload image, PDF or Word file"
              aria-label="Upload image, PDF or Word file" disabled={loading}
              onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={21} />
            </button>

            <textarea
              ref={inputRef}
              className="gx-textarea"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  handleSubmit(event);
                }
              }}
              placeholder={listening ? "Listening… speak now" : "Ask Global AI anything…"}
              aria-label="Message Global AI"
              rows={1}
              disabled={loading}
            />

            {speechSupported && (
              <button className={`gx-tool${listening ? " is-listening" : ""}`} type="button"
                title={listening ? "Stop voice input" : "Voice input"} aria-label={listening ? "Stop voice input" : "Voice input"}
                aria-pressed={listening} onClick={toggleListening} disabled={loading}>
                {listening ? <MicOff size={21} /> : <Mic size={21} />}
              </button>
            )}

            <button className="gx-tool" type="button" title="Open Notepad" aria-label="Open Notepad"
              onClick={() => window.dispatchEvent(new CustomEvent("global-open-notes"))}>
              <StickyNote size={21} />
            </button>

            {loading ? (
              <button className="gx-send is-stop" type="button" onClick={stopGenerating} aria-label="Stop generating" title="Stop generating">
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button className="gx-send" type="submit" aria-label="Send message"
                disabled={!input.trim() && !selectedAttachment}>
                <Send size={20} />
              </button>
            )}
          </form>
          <p className="gx-disclaimer">Global AI can make mistakes. Verify important information.</p>
        </footer>
      </div>

      {showProfileView && (
        <div className="gx-profile-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowProfileView(false);
        }}>
          <section className="gx-profile-modal" role="dialog" aria-modal="true" aria-labelledby="gx-profile-title">
            <button type="button" className="gx-profile-modal-close" onClick={() => setShowProfileView(false)} aria-label="Close profile">
              <X size={19} />
            </button>
            <h2 id="gx-profile-title">Your Profile</h2>
            <div className="gx-profile-modal-avatar">
              {avatar ? <img src={avatar} alt="Your profile" /> : <UserRound size={38} />}
            </div>
            <strong className="gx-profile-modal-name">{userName || "My Profile"}</strong>
            <span className="gx-profile-modal-email">{authUser?.email}</span>
            <button type="button" className="gx-profile-modal-action" onClick={() => avatarInputRef.current?.click()}>
              <Pencil size={16} /> {avatar ? "Change Profile Image" : "Add Profile Image"}
            </button>
            {avatar && (
              <button type="button" className="gx-profile-modal-remove" onClick={removeAvatar}>
                <Trash2 size={16} /> Remove Profile Image
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
