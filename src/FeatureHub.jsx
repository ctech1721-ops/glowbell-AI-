import React, { useMemo, useState } from "react";
import {
  X, Search, BrainCircuit, FileText, Code2, BarChart3,
  Palette, Briefcase, Sparkles, Wrench
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
      ["PowerPoint Presentations", "Prepare slide content, seminar presentations and speaker notes."],
      ["File Analysis", "Read and analyse supported uploaded files."],
    ],
  },
  {
    title: "Development & Technology",
    icon: Code2,
    items: [
      ["Website Development", "Build websites, landing pages and responsive user interfaces."],
      ["Full-Stack Development", "Plan frontend, backend, APIs and application architecture."],
      ["Programming & Debugging", "Write, explain, review and troubleshoot code."],
      ["Mobile App Development", "Plan and develop Android, iOS and cross-platform apps."],
      ["Database & API Development", "Design databases, SQL queries and API integrations."],
      ["AI & Machine Learning", "Plan AI assistants, ML models, NLP and computer vision projects."],
      ["GitHub & Deployment", "Work with Git, GitHub, hosting and deployment steps."],
      ["Software Testing", "Create test cases, debug issues and review application quality."],
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

export default function FeatureHub({ onClose, onUse }) {
  const [query, setQuery] = useState("");
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

  return (
    <div className="gb-feature-overlay" role="dialog" aria-modal="true" aria-label="Explore Global AI features">
      <section className="gb-feature-panel">
        <header className="gb-feature-head">
          <div>
            <span className="gb-feature-eyebrow"><Sparkles size={14} /> GLOBAL AI TOOLS</span>
            <h2>Explore features</h2>
            <p>Choose a capability to start working with Global AI.</p>
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
                      <button
                        type="button"
                        disabled={status === "soon"}
                        onClick={() => onUse(`Help me with ${name}. ${description} Please guide me and complete the task as far as the available Global AI tools allow.`)}
                      >
                        {status === "soon" ? "Coming Soon" : "Open feature"}
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
      </section>
    </div>
  );
}
