import { useId } from "react";
import "./logo.css";

/**
 * Global AI logo — a solid electric-blue "G" with a glowing orbit ring and a
 * sparkle. Drawn as SVG so it is always sharp, never has a grey halo, and the
 * whole letter is blue (no PNG artefacts).
 *
 * animate:
 *   "intro" — draws itself in (used inside the start circle)
 *   "loop"  — gentle floating glow + twinkling star (hero / header)
 *   "none"  — static
 */
export default function GlobalLogo({
  size = 120,
  animate = "none",
  crisp = false,
  className = "",
  title = "Global AI",
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const g = `gl-g-${uid}`;
  const o = `gl-o-${uid}`;

  return (
    <svg
      className={`gl-logo gl-${animate} ${className}`}
      width={size}
      height={size * 0.86}
      viewBox="0 0 240 206"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={g} x1="40" y1="30" x2="180" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2f9bff" />
          <stop offset="1" stopColor="#0a5cff" />
        </linearGradient>
        <linearGradient id={o} x1="10" y1="150" x2="225" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0a63ff" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="#35b6ff" />
          <stop offset="1" stopColor="#c9f1ff" />
        </linearGradient>
      </defs>

      {/* orbit — back half (hidden behind the G) */}
      <g transform="rotate(-22 112 104)">
        <path
          className="gl-orbit gl-orbit-back"
          d="M 12 104 A 100 33 0 0 1 212 104"
          pathLength="100"
          fill="none"
          stroke={`url(#${o})`}
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.55"
        />
      </g>

      {/* the letter G */}
      <g className="gl-letter">
        <path
          className="gl-g-arc"
          d="M 158 62 A 62 62 0 1 0 174 106"
          pathLength="100"
          fill="none"
          stroke={`url(#${g})`}
          strokeWidth="32"
          strokeLinecap="butt"
        />
        <path
          className="gl-g-bar"
          d="M 116 104 L 189 104"
          pathLength="100"
          fill="none"
          stroke={`url(#${g})`}
          strokeWidth="30"
          strokeLinecap="butt"
        />
      </g>

      {/* orbit — front half (passes over the G) */}
      <g transform="rotate(-22 112 104)">
        <path
          className="gl-orbit gl-orbit-front"
          d="M 12 104 A 100 33 0 0 0 212 104"
          pathLength="100"
          fill="none"
          stroke={`url(#${o})`}
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>

      {/* sparkle */}
      <g className="gl-star" transform="translate(205 50)">
        <path
          d="M 0 -17 C 1.5 -5 5 -1.5 17 0 C 5 1.5 1.5 5 0 17 C -1.5 5 -5 1.5 -17 0 C -5 -1.5 -1.5 -5 0 -17 Z"
          fill="#ffffff"
        />
      </g>
    </svg>
  );
}
