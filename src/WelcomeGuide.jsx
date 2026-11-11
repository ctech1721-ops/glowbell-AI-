import { useState } from "react";
import "./WelcomeGuide.css";

export default function WelcomeGuide({ onComplete }) {
  const [page, setPage] = useState(1);

  return (
    <main className="welcome-guide">
      <section className="welcome-guide-card">
        <p className="welcome-guide-brand">GLOBAL AI</p>

        {page === 1 ? (
          <>
            <h1>Stay Safe While Using AI</h1>
            <p>Keep your information safe while using Global AI.</p>
            <ul>
              <li>Never share passwords or login codes.</li>
              <li>Avoid sharing private and bank details.</li>
              <li>Verify important information.</li>
              <li>Use AI responsibly.</li>
            </ul>
            <button onClick={() => setPage(2)}>Next</button>
          </>
        ) : (
          <>
            <h1>Welcome to Global AI!</h1>
            <p>
              Ask questions, learn new topics, get coding help,
              and explore ideas with your AI assistant.
            </p>
            <p>You're ready to start chatting!</p>
            <div className="welcome-guide-actions">
              <button
                className="welcome-guide-secondary"
                onClick={() => setPage(1)}
              >
                Previous
              </button>
              <button onClick={onComplete}>OK</button>
            </div>
          </>
        )}

        <p className="welcome-guide-page">Page {page} of 2</p>
      </section>
    </main>
  );
}