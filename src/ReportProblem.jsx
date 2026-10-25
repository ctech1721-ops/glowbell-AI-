
import { useState } from "react";
import "./ReportProblem.css";

export default function ReportProblem() {
  const [isOpen, setIsOpen] = useState(false);
  const [course, setCourse] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [status, setStatus] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("Submitting...");

    try {
      const response = await fetch("https://formspree.io/f/xljjdqza", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          course,
          difficulty,
        }),
      });

     if (response.ok) {
  setStatus("Report submitted successfully!");
  setCourse("");
  setDifficulty("");

  setTimeout(() => {
    setIsOpen(false);
    setStatus("");
  }, 1500);
}else {
        setStatus("Submission failed. Please try again.");
      }
    } catch {
      setStatus("Network error. Please try again.");
    }
  }

  return (
    <>
      <button
        className="report-problem-button"
        onClick={() => setIsOpen(true)}
      >
        Report a Problem
      </button>

      {isOpen && (
        <div className="report-modal-overlay">
          <div className="report-modal">
            <button
              className="report-close-button"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
            >
              ×
            </button>

            <h2>Report a Problem</h2>

            <form onSubmit={handleSubmit}>
              <label htmlFor="course">Course or Degree</label>
              <input
                id="course"
                type="text"
                placeholder="Enter your course or degree"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                required
              />

              <label htmlFor="difficulty">
                Describe the difficulty
              </label>
              <textarea
                id="difficulty"
                placeholder="Describe the problem..."
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                rows={4}
                required
              />

              <button type="submit" disabled={status === "Submitting..."}>
                {status === "Submitting..." ? "Submitting..." : "Submit"}
              </button>

              {status && <p>{status}</p>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
