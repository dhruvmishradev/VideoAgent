"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [source, setSource] = useState("");
  const [language, setLanguage] = useState("English");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [steps, setSteps] = useState([
    { id: 0, text: "Slicing audio spectrum...", num: "01", status: "pending" },
    { id: 1, text: "Generating transcript strings...", num: "02", status: "pending" },
    { id: 2, text: "Compiling summary and descriptors...", num: "03", status: "pending" },
    { id: 3, text: "Extracting tasks, decisions, questions...", num: "04", status: "pending" },
    { id: 4, text: "Constructing RAG vector matrix...", num: "05", status: "pending" }
  ]);
  
  const [pipelineResult, setPipelineResult] = useState(null);
  const [error, setError] = useState("");
  
  // Chat Console States
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");

  const chatEndRef = useRef(null);

  // Auto-scroll chat window
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, chatLoading]);

  // Handle media file upload
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Failed to upload file to the server.");
      }

      const data = await res.json();
      setUploadedFile({
        name: file.name,
        path: data.filepath,
      });
      setSource(data.filepath);
    } catch (err) {
      setError(err.message || "An error occurred during file upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const removeUploadedFile = () => {
    setUploadedFile(null);
    setSource("");
  };

  // Run Backend Pipeline using SSE stream
  const runEngine = () => {
    if (!source.trim()) {
      setError("Please specify a YouTube URL or upload a file first.");
      return;
    }

    setError("");
    setProcessing(true);
    setProgress(0);
    
    // Reset steps status to pending
    setSteps([
      { id: 0, text: "Slicing audio spectrum...", num: "01", status: "pending" },
      { id: 1, text: "Generating transcript strings...", num: "02", status: "pending" },
      { id: 2, text: "Compiling summary and descriptors...", num: "03", status: "pending" },
      { id: 3, text: "Extracting tasks, decisions, questions...", num: "04", status: "pending" },
      { id: 4, text: "Constructing RAG vector matrix...", num: "05", status: "pending" }
    ]);

    const url = `http://localhost:8000/api/process-stream?source=${encodeURIComponent(source)}&language=${language.toLowerCase()}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.status === "done") {
          setPipelineResult(data.result);
          setProcessing(false);
          setProgress(100);
          eventSource.close();
        } else if (data.status === "error") {
          setError(data.message || "Engine pipeline failed.");
          setProcessing(false);
          eventSource.close();
        } else {
          // Update active / completed steps
          const stepId = data.step;
          const status = data.status;

          setSteps((prevSteps) =>
            prevSteps.map((s) => {
              if (s.id === stepId) {
                return { ...s, status };
              } else if (s.id < stepId) {
                return { ...s, status: "completed" };
              }
              return s;
            })
          );
          setProgress((stepId + 1) * 20);
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE EventSource failed", err);
      setError("Connection to the server processing stream was interrupted.");
      setProcessing(false);
      eventSource.close();
    };
  };

  const resetEngine = () => {
    setPipelineResult(null);
    setChatHistory([]);
    setSource("");
    setUploadedFile(null);
    setProgress(0);
  };

  // Submit chat query to the vector DB QA backend
  const handleChatQuery = async (e, customQuery = null) => {
    if (e) e.preventDefault();
    const query = customQuery || chatInput;
    if (!query.trim() || chatLoading) return;

    if (!customQuery) {
      setChatInput("");
    }

    setChatHistory((prev) => [...prev, { role: "user", content: query }]);
    setChatLoading(true);

    try {
      const res = await fetch("http://localhost:8000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query }),
      });

      if (!res.ok) {
        throw new Error("Failed to receive response from backend QA engine.");
      }

      const data = await res.json();
      setChatHistory((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: `❌ Error: ${err.message}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // Helper function to render Markdown content safely
  const renderMarkdown = (text) => {
    if (!text) return null;
    let html = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return `<li>${trimmed.substring(2)}</li>`;
        }
        if (trimmed.startsWith("### ")) {
          return `<h3>${trimmed.substring(4)}</h3>`;
        }
        if (trimmed.startsWith("## ")) {
          return `<h2>${trimmed.substring(3)}</h2>`;
        }
        if (trimmed === "") {
          return "<br />";
        }
        return `<p>${trimmed}</p>`;
      })
      .join("");

    return (
      <div
        className="markdown-wrapper"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };

  const copyTranscript = () => {
    if (pipelineResult?.transcript) {
      navigator.clipboard.writeText(pipelineResult.transcript);
      alert("Raw transcript copied to clipboard!");
    }
  };

  return (
    <div className="stAppContainer">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div>
          <h3 className="sidebar-title">⚙️ System Options</h3>
          <div className="sidebar-divider" style={{ margin: "1.25rem 0" }}></div>
        </div>

        <div className="sidebar-section">
          <label className="sidebar-label">🌐 Select Language Mode</label>
          <select
            className="select-input"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={processing || pipelineResult}
          >
            <option>English</option>
            <option>Hinglish</option>
          </select>
        </div>

        <div className="sidebar-section" style={{ marginTop: "1.5rem" }}>
          <label className="sidebar-label">⚡ System Details</label>
          <div className="system-details-box">
            <li><span>⚙️</span> Engine: Pipeline V2.4</li>
            <li><span>🌐</span> Backplane: React & Next.js</li>
            <li><span>🧠</span> LLM Core: Gemini 3.5 Flash</li>
          </div>
        </div>

        {pipelineResult && (
          <button
            className="btn btn-danger btn-full"
            style={{ marginTop: "auto" }}
            onClick={resetEngine}
          >
            🔄 Reset Engine
          </button>
        )}
      </aside>

      {/* MAIN CONTAINER */}
      <main className="main-content">
        <header className="title-wrapper">
          <div className="app-subtitle">Video Synthesis & QA Engine</div>
          <h1 className="app-title">AI VIDEO ASSISTANT</h1>
        </header>

        {error && (
          <div className="warning-box">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* INPUT PANEL (BEFORE PROCESSING) */}
        {!pipelineResult && !processing && (
          <div className="card">
            <h3 className="card-title">📡 INPUT DATA CHANNEL</h3>
            
            <div className="form-group">
              <label className="form-label">Target YouTube URL or File Path:</label>
              <input
                type="text"
                className="text-input"
                placeholder="Enter address..."
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={uploadedFile}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Or drop local media file directly:</label>
              {!uploadedFile ? (
                <div className="file-uploader" style={{ position: "relative" }}>
                  <input
                    type="file"
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      opacity: 0,
                      cursor: "pointer",
                      top: 0,
                      left: 0,
                    }}
                    accept=".mp3,.wav,.mp4,.m4a"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                  />
                  <span style={{ fontSize: "2rem" }}>📁</span>
                  <div className="file-uploader-text">
                    {isUploading ? "Uploading file to server..." : "Click or drag file here to upload"}
                  </div>
                  <div className="file-uploader-subtext">Supports WAV, MP3, MP4, M4A</div>
                </div>
              ) : (
                <div className="file-details">
                  <span>📄 {uploadedFile.name}</span>
                  <button className="file-remove-btn" onClick={removeUploadedFile} title="Remove File">
                    ×
                  </button>
                </div>
              )}
            </div>

            <button
              className="btn"
              style={{ alignSelf: "flex-start", marginTop: "1rem" }}
              onClick={runEngine}
              disabled={isUploading || !source}
            >
              Run Engine
            </button>
          </div>
        )}

        {/* RUNNING STATUS / SSE PROGRESS */}
        {processing && (
          <div className="card">
            <h3 className="card-title" style={{ letterSpacing: "0.05em" }}>
              ⚙️ PROCESSING CHANNELS
            </h3>
            
            <div style={{ marginTop: "10px" }}>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
              </div>
            </div>

            <div className="step-container">
              {steps.map((step) => (
                <div key={step.id} className={`step-indicator ${step.status}`}>
                  <span className={`status-dot ${step.status}`}></span>
                  <span className={`step-num ${step.status}`}>[{step.num}]</span>
                  <span className={`step-text ${step.status}`}>
                    {step.text} {step.status === "completed" && "(Done)"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DASHBOARD STATUS (AFTER ENGINE RUNS) */}
        {pipelineResult && (
          <>
            <div className="card" style={{ padding: "1.75rem", gap: "0.75rem" }}>
              <div style={{ display: "flex", gap: "10px" }}>
                <span className="tech-badge badge-accent">INDEX ACTIVE</span>
                <span className="tech-badge badge-success">
                  LANG: {pipelineResult.language.toUpperCase()}
                </span>
              </div>
              <h2
                style={{
                  margin: 0,
                  color: "#ffffff",
                  fontSize: "1.9rem",
                  fontFamily: "var(--font-title)",
                  fontWeight: "800",
                  letterSpacing: "-0.01em",
                }}
              >
                {pipelineResult.title}
              </h2>
            </div>

            {/* TAB CONTENT BLOCK */}
            <div>
              <div className="tabs-header">
                <button
                  className={`tab-btn ${activeTab === "summary" ? "active" : ""}`}
                  onClick={() => setActiveTab("summary")}
                >
                  SUMMARY REPORT
                </button>
                <button
                  className={`tab-btn ${activeTab === "insights" ? "active" : ""}`}
                  onClick={() => setActiveTab("insights")}
                >
                  STRUCTURED INSIGHTS
                </button>
                <button
                  className={`tab-btn ${activeTab === "transcript" ? "active" : ""}`}
                  onClick={() => setActiveTab("transcript")}
                >
                  RAW TRANSCRIPT
                </button>
              </div>

              {activeTab === "summary" && (
                <div className="tab-content">
                  {renderMarkdown(pipelineResult.summary)}
                </div>
              )}

              {activeTab === "insights" && (
                <div className="insights-grid">
                  <div className="insight-card action">
                    <h4 className="insight-title action">Action Tasks</h4>
                    <div className="insight-body">
                      {renderMarkdown(pipelineResult.action_items)}
                    </div>
                  </div>
                  <div className="insight-card decision">
                    <h4 className="insight-title decision">Decisions Register</h4>
                    <div className="insight-body">
                      {renderMarkdown(pipelineResult.key_decisions)}
                    </div>
                  </div>
                  <div className="insight-card issue">
                    <h4 className="insight-title issue">Open Issues</h4>
                    <div className="insight-body">
                      {renderMarkdown(pipelineResult.open_questions)}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "transcript" && (
                <div className="tab-content">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "1.25rem",
                    }}
                  >
                    <span style={{ fontSize: "0.95rem", color: "#ffffff", fontWeight: "700", letterSpacing: "0.02em" }}>
                      RAW TRANSCRIPTION DATA
                    </span>
                    <button className="copy-btn" onClick={copyTranscript}>
                      Copy Transcript
                    </button>
                  </div>
                  <textarea
                    className="code-display"
                    value={pipelineResult.transcript}
                    readOnly
                  />
                </div>
              )}
            </div>

            <div className="sidebar-divider"></div>

            {/* CHAT INTERACTIVE BLOCK */}
            <div className="card" style={{ padding: "2.2rem" }}>
              <h3 className="chat-console-title">RAG QUERY CONSOLE</h3>
              <p className="chat-console-subtitle">
                Execute vector similarity QA querying the meeting context data.
              </p>

              {pipelineResult.suggested_queries && (
                <div>
                  <div className="suggested-queries-label">Suggested Queries:</div>
                  <div className="suggested-queries-grid">
                    {pipelineResult.suggested_queries.map((query, index) => (
                      <button
                        key={index}
                        className="suggested-pill"
                        onClick={(e) => handleChatQuery(e, query)}
                        disabled={chatLoading}
                      >
                        ⚡ Ask: {query}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat Log Window */}
              {chatHistory.length > 0 && (
                <div className="chat-history">
                  {chatHistory.map((msg, index) => (
                    <div key={index} className={`chat-message ${msg.role}`}>
                      <span className={`chat-message-role ${msg.role}`}>
                        {msg.role === "user" ? "You" : "Assistant"}
                      </span>
                      <div>{msg.content}</div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="chat-message assistant">
                      <span className="chat-message-role assistant">Assistant</span>
                      <div className="chat-spinner">
                        <div className="spinner-icon"></div>
                        <span>Executing similarity search...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              <form onSubmit={handleChatQuery} className="chat-input-wrapper" style={{ marginTop: "1rem" }}>
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Input transaction queries..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={chatLoading}
                />
                <button type="submit" className="btn" disabled={chatLoading || !chatInput.trim()}>
                  Send
                </button>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
