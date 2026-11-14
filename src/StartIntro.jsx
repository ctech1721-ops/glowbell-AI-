import { useEffect } from "react";
import GlobalLogo from "./GlobalLogo";
import "./logo.css";

/**
 * Start screen: a blue ring draws itself, the solid-blue "G" draws inside the
 * circle, then everything zooms away. Tap anywhere to skip.
 */
export default function StartIntro({ onDone, duration = 3400 }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(t);
  }, [onDone, duration]);

  return (
    <div className="gx-intro" role="status" aria-label="Global AI is loading" onClick={onDone}>
      <div className="gx-intro-circle">
        <svg className="gx-intro-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="gx-ring-faint" cx="50" cy="50" r="48" />
          <circle cx="50" cy="50" r="48" pathLength="302" />
        </svg>
        <GlobalLogo className="gx-intro-logo" size={160} animate="intro" />
      </div>
      <div className="gx-intro-word">GLOBAL AI</div>
    </div>
  );
}
