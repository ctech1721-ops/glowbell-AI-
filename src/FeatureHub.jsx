import React, { useMemo, useState } from "react";
import {
  X, Search, BrainCircuit, FileText, Code2, BarChart3,
  Palette, Briefcase, Sparkles, Wrench, ArrowLeft, Paperclip
} from "lucide-react";

const groups = [
  {
    title: "AI Assistant & Learning",
    icon: BrainCircuit,
    items: [
      ["General AI Assistant", "Answer questions, explain topics, summarize information and continue conversations."],
      ["Education & Learning", "Teach a subject step by step, create notes, assignments and practice questions."],
      ["Mathematics & Statistics", "Solve calculations, probability, statistical tests and formulas."],
      ["Language & Translation", "Translate, improve grammar, practise languages and rewrite text."],
      ["Research & Deep Research", "Research a topic, compare sources and prepare a structured report."],
    ],
  },
  {
    title: "Files & Office",
    icon: FileText,
    items: [
      ["Excel & Spreadsheets", "Create spreadsheet data, formulas, tables and analysis plans."],
      ["Datasets & Data Analysis", "Create sample datasets, clean data and analyse uploaded CSV or spreadsheet files."],
      ["PDF Documents", "Summarize, explain and prepare PDF-ready documents."],
      ["Word Documents", "Draft reports, letters, resumes and project documentation."],
      ["PowerPoint Presentations", "Get a slide-by-slide outline with bullet points and speaker notes."],
      ["File Analysis", "Read and analyse supported uploaded files."],
    ],
  },
  {
    title: "Data & Visualisation",
    icon: BarChart3,
    items: [
      ["Data Science", "Explore datasets, statistics, trends and analytical insights."],
      ["Charts & Graphs", "Create chart-ready data and explain visualisations."],
      ["Dashboards & Business Intelligence", "Plan KPI dashboards and business reports."],
      ["Predictive Analytics", "Explore forecasting, regression and prediction approaches."],
    ],
  },
  {
    title: "Creative Studio",
    icon: Palette,
    items: [
      ["Image Creation", "AI image generation is not available in this version yet.", "soon"],
      ["Video Creation", "AI video generation is not available in this version yet.", "soon"],
      ["Image Analysis & OCR", "Understand uploaded images, screenshots, diagrams and readable text."],
      ["Logo & Graphic Design", "Plan logos, posters, banners, brand kits and design concepts."],
      ["Writing & Content Creation", "Write articles, stories, scripts, captions and creative content."],
      ["Audio & Voice Assistance", "Work with supported audio, transcription and voice workflows."],
    ],
  },
  {
    title: "Business & Productivity",
    icon: Briefcase,
    items: [
      ["Business Planning", "Create business plans, startup ideas and competitor research."],
      ["Marketing & SEO", "Prepare campaigns, social posts, SEO plans and content calendars."],
      ["Project Management", "Break projects into milestones, tasks and deliverables."],
      ["Email & Professional Writing", "Draft emails, proposals, reports and professional messages."],
      ["Schedules & Reminders", "Plan schedules, routines and supported reminders."],
      ["Workflow Automation", "Design repeatable workflows and automation plans."],
    ],
  },
  {
    title: "Specialised Assistance",
    icon: Wrench,
    items: [
      ["Cybersecurity & Networking", "Learn security concepts and review defensive configurations."],
      ["Cloud & DevOps", "Plan cloud architecture, Docker, CI/CD and deployment."],
      ["Game Development", "Plan games, gameplay logic and game code."],
      ["3D, AR & VR", "Explore 3D concepts and augmented or virtual reality projects."],
      ["Engineering & Science", "Assist with technical calculations, scientific concepts and simulations."],
      ["Finance & Business Analysis", "Organize financial data and explain financial concepts."],
      ["Travel & Shopping Research", "Compare options and plan trips or purchases."],
    ],
  },
];

// What each tool asks for and how the request is phrased.
// kind: "file" -> opens the file picker (needs an attachment)
const CONFIG = {
  "Excel & Spreadsheets": { ph: "e.g. Monthly budget tracker with 20 rows", build: (t) => `Create an Excel file: ${t}`, tip: "You get a real .xlsx download. Say \"add more rows\" to extend it." },
  "Datasets & Data Analysis": { ph: "e.g. Student marks dataset with 50 rows (name, subject, marks, date)", build: (t) => `Create an Excel dataset: ${t}`, tip: "You get a real .xlsx download. Say \"add 30 more rows\" to extend it." },
  "Charts & Graphs": { ph: "e.g. Monthly sales of a shop for one year", build: (t) => `Create an Excel file with chart-ready data for: ${t}` },
  "Dashboards & Business Intelligence": { ph: "e.g. KPI data for an online store", build: (t) => `Create an Excel file with KPI data for a dashboard about: ${t}` },
  "PDF Documents": { ph: "e.g. Report on renewable energy", build: (t) => `Write a complete, well-structured document with headings about: ${t}`, tip: "After the answer, tap Download → PDF under it." },
  "Word Documents": { ph: "e.g. Resume for a fresher web developer", build: (t) => `Write a complete, well-structured document about: ${t}`, tip: "After the answer, tap Download → Word under it." },
  "PowerPoint Presentations": { ph: "e.g. 8-slide seminar on Artificial Intelligence", build: (t) => `Create a slide-by-slide presentation outline (slide title, 3-5 short bullet points and speaker notes for each slide) for: ${t}`, tip: "Gives slide text you can paste into PowerPoint." },
  "File Analysis": { kind: "file", ph: "What should I do with the file? e.g. Summarise this PDF", prefill: "Analyse the attached file and summarise the key points." },
  "Image Analysis & OCR": { kind: "file", ph: "", prefill: "Read all the text in this image and explain it." },
  "Mathematics & Statistics": { ph: "e.g. Find the mean and standard deviation of 4, 8, 15, 16, 23, 42", build: (t) => `Solve step by step: ${t}` },
  "Programming & Debugging": { ph: "Paste your code or describe the problem", build: (t) => `Help me with this code or problem. Explain the fix clearly:\n${t}` },
  "Education & Learning": { ph: "e.g. Photosynthesis for class 10", build: (t) => `Teach me step by step with simple examples, then give 5 practice questions with answers: ${t}` },
  "Research & Deep Research": { ph: "e.g. Pros and cons of electric vehicles in India", build: (t) => `Research this and give a structured report with key points: ${t}` },
  "Language & Translation": { ph: "Paste the text, and say what to do (translate / fix grammar / rewrite)", build: (t) => `${t}` },
  "Email & Professional Writing": { ph: "e.g. Leave request email to my manager for 2 days", build: (t) => `Write a professional email: ${t}` },
  "Writing & Content Creation": { ph: "e.g. Short story about a robot who learns to paint", build: (t) => `Write this for me: ${t}` },
  "Business Planning": { ph: "e.g. Small cloud-kitchen startup in Chennai", build: (t) => `Create a clear business plan with key sections for: ${t}` },
  "Schedules & Reminders": { ph: "e.g. Study timetable for 3 exams in 2 weeks", build: (t) => `Create a day-by-day schedule: ${t}` },
};

export default function FeatureHub({ onClose, onUse, onPickFile }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(null); // [name, description]
  const [text, setText] = useState("");

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.map((group) => ({
      ...group,
      items: group.items.filter(([name, description]) =>
        `${name} ${description}`.toLowerCase().includes(q)
      ),
    })).filter((group) => group.items.length);
  }, [query]);

  function open(name, description) {
    const cfg = CONFIG[name];
    if (cfg?.kind === "file") {
      onPickFile?.(cfg.prefill);
      return;
    }
    setActive([name, description]);
    setText("");
  }

  function run() {
    if (!active) return;
    const [name, description] = active;
    const cfg = CONFIG[name];
    const t = text.trim();
    if (!t) return;
    onUse(cfg?.build ? cfg.build(t) : `${name}: ${t}`);
  }

  const cfg = active ? CONFIG[active[0]] : null;

  return (
    <div className="gb-feature-overlay" role="dialog" aria-modal="true" aria-label="Explore Global AI features">
      <section className="gb-feature-panel">
        {active ? (
          <div className="gx-tool-step">
            <button type="button" className="gx-tool-back" onClick={() => setActive(null)}><ArrowLeft size={17} /> All tools</button>
            <h2>{active[0]}</h2>
            <p>{active[1]}</p>
            <textarea
              autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={cfg?.ph || "Tell Global AI what you need…"}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); }}
            />
            {cfg?.tip && <small>{cfg.tip}</small>}
            <div className="gx-tool-actions">
              <button type="button" className="is-ghost" onClick={onClose}>Cancel</button>
              <button type="button" onClick={run} disabled={!text.trim()}>Run</button>
            </div>
          </div>
        ) : (
          <>
            <header className="gb-feature-head">
              <div>
                <span className="gb-feature-eyebrow"><Sparkles size={14} /> GLOBAL AI TOOLS</span>
                <h2>Explore features</h2>
                <p>Choose a tool, tell it what you need, and Global AI does the work.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close features"><X size={21} /></button>
            </header>
            <label className="gb-feature-search">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search features..." />
            </label>
            <div className="gb-feature-groups">
              {visibleGroups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <section className="gb-feature-group" key={group.title}>
                    <h3><GroupIcon size={18} /> {group.title}</h3>
                    <div className="gb-feature-grid">
                      {group.items.map(([name, description, status]) => (
                        <article className={`gb-feature-card ${status === "soon" ? "is-coming-soon" : ""}`} key={name}>
                          <div className="gb-feature-card-top">
                            <strong>{name}</strong>
                            {status === "soon" && <span>COMING SOON</span>}
                          </div>
                          <p>{description}</p>
                          <button type="button" disabled={status === "soon"} onClick={() => open(name, description)}>
                            {status === "soon" ? "Coming Soon" : CONFIG[name]?.kind === "file" ? <><Paperclip size={12} /> Choose file</> : "Open feature"}
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
              {visibleGroups.length === 0 && <p className="gb-feature-empty">No matching features found.</p>}
            </div>
            <p className="gb-feature-footnote">Feature availability depends on connected services, API access and the files or tools enabled in this project.</p>
          </>
        )}
      </section>
    </div>
  );
}
