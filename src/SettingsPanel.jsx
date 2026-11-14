import { useEffect, useState } from "react";
import { X, SlidersHorizontal } from "lucide-react";

export const STYLE_OPTIONS = [
  { id: "short", label: "Short & simple", hint: "Easy words, quick notes" },
  { id: "balanced", label: "Balanced (default)", hint: "Clear and well organised" },
  { id: "concise", label: "Concise", hint: "Short, to the point" },
  { id: "detailed", label: "Detailed", hint: "In-depth explanations" },
  { id: "steps", label: "Step by step", hint: "Numbered walkthroughs" },
  { id: "simple", label: "Explain simply", hint: "Beginner friendly" },
];

export const DEFAULT_PREFS = {
  style: "balanced",
  instructions: "",
  typewriter: true,
  voiceLang: "en-IN",
};

export function loadPrefs(userId) {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(`global-prefs-${userId}`) || "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(userId, prefs) {
  try { localStorage.setItem(`global-prefs-${userId}`, JSON.stringify(prefs)); } catch { /* storage blocked */ }
}

export default function SettingsPanel({ prefs, onChange, onClose }) {
  const [draft, setDraft] = useState(prefs.instructions);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="gx-modal" role="dialog" aria-modal="true" aria-label="Personalise Global AI" onClick={onClose}>
      <section className="gx-modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="gx-modal-head">
          <div><SlidersHorizontal size={19} /><strong>Personalise</strong></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>

        <h3>Response style</h3>
        <div className="gx-chip-grid">
          {STYLE_OPTIONS.map((o) => (
            <button
              type="button" key={o.id}
              className={`gx-chip-option${prefs.style === o.id ? " is-on" : ""}`}
              onClick={() => onChange({ ...prefs, style: o.id })}
            >
              <strong>{o.label}</strong><span>{o.hint}</span>
            </button>
          ))}
        </div>

        <h3>Custom instructions</h3>
        <textarea
          className="gx-modal-text" rows={4} maxLength={600} value={draft}
          placeholder="e.g. I am a 2nd-year CSE student. Explain with real-life examples."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange({ ...prefs, instructions: draft })}
        />
        <small className="gx-modal-count">{draft.length}/600 · applied to every new answer</small>

        <h3>Preferences</h3>
        <label className="gx-switch">
          <input type="checkbox" checked={prefs.typewriter} onChange={(e) => onChange({ ...prefs, typewriter: e.target.checked })} />
          <span>Typing effect for answers</span>
        </label>
        <label className="gx-select">
          <span>Voice input language</span>
          <select value={prefs.voiceLang} onChange={(e) => onChange({ ...prefs, voiceLang: e.target.value })}>
            <option value="en-IN">English (India)</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="ta-IN">Tamil</option>
            <option value="hi-IN">Hindi</option>
            <option value="te-IN">Telugu</option>
            <option value="ml-IN">Malayalam</option>
          </select>
        </label>

        <footer className="gx-modal-foot">
          <button type="button" onClick={() => { onChange({ ...prefs, instructions: draft }); onClose(); }}>Done</button>
        </footer>
      </section>
    </div>
  );
}
