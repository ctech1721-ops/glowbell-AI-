import { useState } from "react";
import { ShieldCheck, Sparkles, KeyRound, Landmark, BadgeCheck, Scale } from "lucide-react";
import GlobalLogo from "./GlobalLogo";
import "./WelcomeGuide.css";

const SAFETY = [
  [KeyRound, "Never share passwords or login codes."],
  [Landmark, "Avoid sharing private and bank details."],
  [BadgeCheck, "Verify important information."],
  [Scale, "Use AI responsibly."],
];

export default function WelcomeGuide({ onComplete, name }) {
  const [page, setPage] = useState(1);
  const first = (name || "").trim().split(/\s+/)[0];

  return (
    <main className="welcome-guide">
      <section className="welcome-guide-card" aria-live="polite">
        <GlobalLogo size={92} animate="loop" className="welcome-guide-logo" />
        <p className="welcome-guide-brand">GLOBAL AI</p>

        {page === 1 ? (
          <>
            <h1><ShieldCheck size={26} /> Stay Safe While Using AI</h1>
            <p className="welcome-guide-lead">Keep your information safe while using Global AI.</p>
            <ul className="welcome-guide-list">
              {SAFETY.map(([Icon, text]) => (
                <li key={text}><Icon size={18} /><span>{text}</span></li>
              ))}
            </ul>
            <div className="welcome-guide-actions">
              <button type="button" className="welcome-guide-secondary" onClick={onComplete}>Skip</button>
              <button type="button" onClick={() => setPage(2)}>Next</button>
            </div>
          </>
        ) : (
          <>
            <h1><Sparkles size={26} /> Welcome{first ? `, ${first}` : ""}!</h1>
            <p className="welcome-guide-lead">
              Ask questions, learn new topics, get coding help, and explore ideas with your AI assistant.
            </p>
            <p className="welcome-guide-lead">You&apos;re ready to start chatting!</p>
            <div className="welcome-guide-actions">
              <button type="button" className="welcome-guide-secondary" onClick={() => setPage(1)}>Previous</button>
              <button type="button" onClick={onComplete}>Start chatting</button>
            </div>
          </>
        )}

        <div className="welcome-guide-dots" aria-label={`Page ${page} of 2`}>
          <span className={page === 1 ? "on" : ""} /><span className={page === 2 ? "on" : ""} />
        </div>
      </section>
    </main>
  );
}
