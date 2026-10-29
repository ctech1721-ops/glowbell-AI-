import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  StickyNote,
  X,
  Minimize2,
  Maximize2,
  MoreVertical,
  Save,
  FileDown,
  Plus,
  Trash2,
  Check,
  FileText,
} from "lucide-react";
import { jsPDF } from "jspdf";

const makeNote = () => ({
  id: crypto.randomUUID(),
  title: "",
  content: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export default function NotesWidget({ userId }) {
  const storageKey = `global-notes-${userId || "guest"}`;

  const [notes, setNotes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load saved notes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) : [];

      setNotes(Array.isArray(parsed) ? parsed : []);
      setActiveId(null);
    } catch (error) {
      console.error("Unable to load notes:", error);
      setNotes([]);
    }

    setLoaded(true);
  }, [storageKey]);

  // Save notes automatically
  useEffect(() => {
    if (!loaded) return;

    try {
      localStorage.setItem(storageKey, JSON.stringify(notes));
    } catch (error) {
      console.error("Unable to save notes:", error);
    }
  }, [notes, storageKey, loaded]);

  const activeNote = notes.find((note) => note.id === activeId);

  // Create a new note
  const createNote = () => {
    const note = makeNote();

    setNotes((previous) => [note, ...previous]);
    setActiveId(note.id);
    setIsOpen(true);
    setMenuOpen(false);
    setSaved(false);
  };

  // Update the selected note
  const updateActiveNote = (field, value) => {
    if (!activeId) return;

    setNotes((previous) =>
      previous.map((note) =>
        note.id === activeId
          ? {
              ...note,
              [field]: value,
              updatedAt: new Date().toISOString(),
            }
          : note
      )
    );

    setSaved(false);
  };

  // Open the existing note or create one
  const openNotes = () => {
    if (activeId && notes.some((note) => note.id === activeId)) {
      setIsOpen(true);
      return;
    }

    if (notes.length > 0) {
      setActiveId(notes[0].id);
      setIsOpen(true);
    } else {
      createNote();
    }
  };

  // Open Notepad from the search/composer icon
  useEffect(() => {
    const handleOpenNotes = () => {
      if (activeId && notes.some((note) => note.id === activeId)) {
        setIsOpen(true);
        return;
      }

      if (notes.length > 0) {
        setActiveId(notes[0].id);
        setIsOpen(true);
        setMenuOpen(false);
      } else {
        const note = makeNote();

        setNotes((previous) => [note, ...previous]);
        setActiveId(note.id);
        setIsOpen(true);
        setMenuOpen(false);
        setSaved(false);
      }
    };

    window.addEventListener("global-open-notes", handleOpenNotes);

    return () => {
      window.removeEventListener("global-open-notes", handleOpenNotes);
    };
  }, [activeId, notes]);

  // Save note
  const saveNote = () => {
    if (!activeNote) {
      createNote();
      setSaved(true);
      return;
    }

    setNotes((previous) =>
      previous.map((note) =>
        note.id === activeId
          ? { ...note, updatedAt: new Date().toISOString() }
          : note
      )
    );

    setSaved(true);
    setMenuOpen(false);
  };

  // Delete note
  const deleteNote = (id) => {
    const confirmed = window.confirm("Indha note-ai delete pannalama?");
    if (!confirmed) return;

    const remaining = notes.filter((note) => note.id !== id);

    setNotes(remaining);

    if (activeId === id) {
      setActiveId(remaining[0]?.id || null);
      setSaved(false);

      if (remaining.length === 0) {
        setIsOpen(false);
      }
    }
  };

  // Download the selected note as PDF
  const downloadPDF = () => {
    if (!activeNote) return;

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 18;
    const usableWidth = pageWidth - margin * 2;
    const title = activeNote.title.trim() || "Untitled Note";
    const content = activeNote.content || "";

    let y = 22;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);

    const titleLines = pdf.splitTextToSize(title, usableWidth);

    pdf.text(titleLines, margin, y);
    y += titleLines.length * 9 + 7;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);

    const lines = pdf.splitTextToSize(content, usableWidth);
    const lineHeight = 6;

    lines.forEach((line) => {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }

      pdf.text(line, margin, y);
      y += lineHeight;
    });

    const safeName =
      title.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 80) ||
      "Global-Note";

    pdf.save(`${safeName}.pdf`);
    setMenuOpen(false);
  };

  // Wait until notes load
  if (!loaded || !userId) return null;

  return createPortal(
    <div className="gb-notes-widget">
      {isOpen && (
        <section
          className={`gb-notes-window ${
            isFullscreen ? "gb-notes-fullscreen" : ""
          }`}
          role="dialog"
          aria-label="Global Notepad"
        >
          <header className="gb-notes-header">
            <div className="gb-notes-header-left">
              <div className="gb-notes-header-icon">
                <StickyNote />
              </div>

              <div>
                <h2 className="gb-notes-header-title">
                  Global Notepad
                </h2>

                <div className="gb-notes-header-subtitle">
                  Your personal notes
                </div>
              </div>
            </div>

            <div className="gb-notes-header-actions">
              <button
                className="gb-notes-icon-btn"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={() => setIsFullscreen((value) => !value)}
              >
                {isFullscreen ? <Minimize2 /> : <Maximize2 />}
              </button>

              <div className="gb-notes-menu-wrap">
                <button
                  className="gb-notes-icon-btn"
                  title="Note options"
                  aria-label="Note options"
                  onClick={() => setMenuOpen((value) => !value)}
                >
                  <MoreVertical />
                </button>

                {menuOpen && (
                  <div className="gb-notes-menu">
                    <button
                      className="gb-notes-menu-item"
                      onClick={saveNote}
                    >
                      <Save />
                      Save note
                    </button>

                    <button
                      className="gb-notes-menu-item"
                      onClick={downloadPDF}
                    >
                      <FileDown />
                      Save &amp; Download PDF
                    </button>
                  </div>
                )}
              </div>

              <button
                className="gb-notes-icon-btn"
                title="Minimize"
                aria-label="Minimize"
                onClick={() => {
                  setIsOpen(false);
                  setIsFullscreen(false);
                  setMenuOpen(false);
                }}
              >
                <Minimize2 />
              </button>

              <button
                className="gb-notes-icon-btn gb-notes-close-btn"
                title="Close"
                aria-label="Close"
                onClick={() => {
                  setIsOpen(false);
                  setIsFullscreen(false);
                  setMenuOpen(false);
                }}
              >
                <X />
              </button>
            </div>
          </header>

          <div className="gb-notes-layout">
            <aside className="gb-notes-history">
              <div className="gb-notes-history-top">
                <h3 className="gb-notes-history-heading">
                  Note History
                </h3>

                <button
                  className="gb-notes-new-btn"
                  onClick={createNote}
                >
                  <Plus />
                  New note
                </button>
              </div>

              <div className="gb-notes-history-list">
                {notes.length === 0 ? (
                  <div className="gb-notes-empty-history">
                    <FileText size={22} />
                    <p>No notes yet.</p>
                    Create your first note.
                  </div>
                ) : (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      className={`gb-notes-history-item ${
                        note.id === activeId ? "active" : ""
                      }`}
                    >
                      <button
                        className="gb-notes-history-item-main"
                        style={{
                          border: 0,
                          background: "transparent",
                          color: "inherit",
                          textAlign: "left",
                          cursor: "pointer",
                          padding: 0,
                        }}
                        onClick={() => {
                          setActiveId(note.id);
                          setSaved(false);
                          setMenuOpen(false);
                        }}
                      >
                        <span className="gb-notes-history-item-title">
                          {note.title.trim() || "Untitled note"}
                        </span>

                        <span className="gb-notes-history-item-date">
                          {new Date(note.updatedAt).toLocaleDateString()}
                        </span>
                      </button>

                      <button
                        className="gb-notes-history-delete"
                        title="Delete note"
                        aria-label="Delete note"
                        onClick={() => deleteNote(note.id)}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </aside>

            <main className="gb-notes-editor">
              {activeNote ? (
                <>
                  <div className="gb-notes-editor-toolbar">
                    <span className="gb-notes-editor-label">
                      Note editor
                    </span>

                    {saved && (
                      <span className="gb-notes-save-status">
                        <Check />
                        Saved
                      </span>
                    )}
                  </div>

                  <div className="gb-notes-editor-content">
                    <input
                      className="gb-notes-title-input"
                      type="text"
                      placeholder="Untitled note"
                      value={activeNote.title}
                      onChange={(event) =>
                        updateActiveNote("title", event.target.value)
                      }
                      aria-label="Note title"
                    />

                    <textarea
                      className="gb-notes-body-input"
                      placeholder="Start writing your thoughts..."
                      value={activeNote.content}
                      onChange={(event) =>
                        updateActiveNote("content", event.target.value)
                      }
                      aria-label="Note content"
                    />
                  </div>

                  <footer className="gb-notes-footer">
                    <span>{activeNote.content.length} characters</span>

                    <div className="gb-notes-footer-actions">
                      <button
                        className="gb-notes-secondary-btn"
                        onClick={saveNote}
                      >
                        <Save />
                        Save
                      </button>

                      <button
                        className="gb-notes-primary-btn"
                        onClick={downloadPDF}
                      >
                        <FileDown />
                        Download PDF
                      </button>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="gb-notes-empty-history">
                  Select a note or create a new one.
                </div>
              )}
            </main>
          </div>
        </section>
      )}
    </div>,
    document.body
  );
}