"use client";

import React, { useState, useEffect, useCallback } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  Sparkles,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Trash2,
  Edit3,
  RefreshCw,
  AlertCircle,
  Eye,
  Check,
} from "lucide-react";
import { StagingQuestion } from "@autoqp/schema";

export type StagingDraft = StagingQuestion;

interface MCQTypeData {
  options?: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  expectedValue?: number;
  tolerance?: number;
  solution?: string;
}

/**
 * Safely parses and renders LaTeX math within text ($inline$ and $$display$$) using KaTeX.
 */
function renderMathToHtml(rawText: string = ""): string {
  if (!rawText) return "";

  // 1. Process display/block math $$...$$
  let processed = rawText.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="my-2 p-2 bg-slate-900/60 rounded overflow-x-auto text-center">${katex.renderToString(
        math.trim(),
        { displayMode: true, throwOnError: false }
      )}</div>`;
    } catch {
      return `<pre class="text-rose-400">$$${math}$$</pre>`;
    }
  });

  // 2. Process inline math $...$
  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<span class="text-rose-400">$${math}$</span>`;
    }
  });

  // Preserve newlines as <br/>
  return processed.replace(/\n/g, "<br/>");
}

export default function StagingSandboxPage() {
  const [subjectId, setSubjectId] = useState<string>("00000000-0000-0000-0000-000000000001");
  const [drafts, setDrafts] = useState<StagingDraft[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"ai_gen" | "text_extract" | "screenshot">("ai_gen");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // AI Gen state
  const [genCount, setGenCount] = useState<number>(2);
  const [genDifficulty, setGenDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [genMarks, setGenMarks] = useState<number>(5);
  const [genType, setGenType] = useState<"mcq" | "numerical" | "long_answer">("mcq");
  const [genPrompt, setGenPrompt] = useState<string>("Graph algorithms and shortest paths");

  // Text extract state
  const [rawText, setRawText] = useState<string>("");

  // Screenshot extract state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Edit draft state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<StagingDraft>>({});

  const fetchDrafts = useCallback(async () => {
    if (!subjectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/staging?subjectId=${encodeURIComponent(subjectId)}`);
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Failed to load staging questions");
      }
      const data = (await res.json()) as { questions?: StagingDraft[] };
      setDrafts(data.questions || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({ type: "error", message });
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // Dismiss notification after 5s
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  // Handle AI Question Generation
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setNotification(null);
    try {
      const res = await fetch("/api/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          subjectId,
          count: genCount,
          difficulty: genDifficulty,
          marks: genMarks,
          type: genType,
          prompt: genPrompt,
        }),
      });
      const data = (await res.json()) as { questions?: StagingDraft[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setNotification({
        type: "success",
        message: `Successfully generated ${data.questions?.length || 0} question(s) into Staging!`,
      });
      fetchDrafts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({ type: "error", message });
    } finally {
      setLoading(false);
    }
  };

  // Handle Text Extraction
  const handleExtractText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;
    setLoading(true);
    setNotification(null);
    try {
      const res = await fetch("/api/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract_text",
          subjectId,
          rawText,
        }),
      });
      const data = (await res.json()) as { questions?: StagingDraft[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setNotification({
        type: "success",
        message: `Extracted ${data.questions?.length || 0} question(s) into Staging!`,
      });
      setRawText("");
      fetchDrafts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({ type: "error", message });
    } finally {
      setLoading(false);
    }
  };

  // Handle Screenshot Upload & Vision Extraction
  const handleExtractScreenshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    setLoading(true);
    setNotification(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("subjectId", subjectId);

      const res = await fetch("/api/staging", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Screenshot extraction failed");
      setNotification({
        type: "success",
        message: "Question & diagram extracted and staged successfully!",
      });
      setSelectedFile(null);
      setImagePreview(null);
      fetchDrafts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({ type: "error", message });
    } finally {
      setLoading(false);
    }
  };

  // Discard draft
  const handleDiscard = async (id: string) => {
    if (!confirm("Are you sure you want to discard this question?")) return;
    try {
      const res = await fetch(`/api/staging?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Failed to discard question");
      }
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      setNotification({ type: "success", message: "Question discarded." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({ type: "error", message });
    }
  };

  // Promote draft to committed bank
  const handlePromote = async (id: string) => {
    try {
      const res = await fetch("/api/staging/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as { id?: string; error?: string; details?: unknown };
      if (!res.ok) {
        const details = data.details ? ` (${JSON.stringify(data.details)})` : "";
        throw new Error((data.error || "Promotion failed") + details);
      }
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      setNotification({
        type: "success",
        message: `Question accepted into Bank! (ID: ${data.id || id})`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({ type: "error", message });
    }
  };

  // Begin editing
  const startEditing = (draft: StagingDraft) => {
    setEditingId(draft.id);
    setEditForm({
      text: draft.text || "",
      type: draft.type || "mcq",
      difficulty: draft.difficulty || "medium",
      marks: draft.marks || 5,
      typeData: draft.typeData || {},
    });
  };

  // Save edit
  const saveEdit = async (id: string) => {
    try {
      const res = await fetch("/api/staging", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          patch: editForm,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Update failed");
      }
      setEditingId(null);
      setNotification({ type: "success", message: "Changes saved." });
      fetchDrafts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({ type: "error", message });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              AutoQP Staging Sandbox
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Human-in-the-loop review buffer. Preview LaTeX equations, verify options, and promote approved questions into the bank.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300">
              <span className="text-slate-400 mr-2 font-medium">Subject ID:</span>
              <input
                type="text"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="bg-transparent text-slate-200 outline-none w-48 font-mono text-xs"
                placeholder="Subject UUID"
              />
            </div>
            <button
              onClick={fetchDrafts}
              disabled={loading}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              title="Refresh Queue"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {/* Global Notification Banner */}
        {notification && (
          <div
            className={`p-4 rounded-xl flex items-center gap-3 border shadow-lg text-sm transition-all ${
              notification.type === "success"
                ? "bg-emerald-950/80 border-emerald-700/60 text-emerald-200"
                : "bg-rose-950/80 border-rose-700/60 text-rose-200"
            }`}
          >
            {notification.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            )}
            <span className="flex-1">{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-xs opacity-75 hover:opacity-100 uppercase tracking-wider font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Intake Generation & Extraction Drawer */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
            <button
              onClick={() => setActiveTab("ai_gen")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "ai_gen"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
              AI Generation
            </button>

            <button
              onClick={() => setActiveTab("text_extract")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "text_extract"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-blue-300" />
              Text Extraction
            </button>

            <button
              onClick={() => setActiveTab("screenshot")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "screenshot"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5 text-purple-300" />
              Screenshot / Diagram OCR
            </button>
          </div>

          {/* AI Generator Tab */}
          {activeTab === "ai_gen" && (
            <form onSubmit={handleGenerate} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-400 mb-1">Topic / Custom Prompt</label>
                <input
                  type="text"
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Dijkstra algorithm, calculus integration..."
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Type</label>
                <select
                  value={genType}
                  onChange={(e) =>
                    setGenType(e.target.value as "mcq" | "numerical" | "long_answer")
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="mcq">MCQ</option>
                  <option value="numerical">Numerical</option>
                  <option value="long_answer">Long Answer</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Difficulty & Marks</label>
                <div className="flex gap-2">
                  <select
                    value={genDifficulty}
                    onChange={(e) =>
                      setGenDifficulty(e.target.value as "easy" | "medium" | "hard")
                    }
                    className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={genMarks}
                    onChange={(e) => setGenMarks(Number(e.target.value))}
                    className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    title="Marks"
                  />
                </div>
              </div>

              <div className="md:col-span-4 flex justify-end items-center gap-3 pt-2">
                <span className="text-xs text-slate-400">
                  Count:
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value))}
                    className="w-16 ml-2 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                  />
                </span>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium px-4 py-2 rounded-lg text-sm shadow-md transition disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {loading ? "Generating..." : "Generate into Staging"}
                </button>
              </div>
            </form>
          )}

          {/* Text Extract Tab */}
          {activeTab === "text_extract" && (
            <form onSubmit={handleExtractText} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Paste Raw / Unstructured Question Text (LaTeX math syntax supported)
                </label>
                <textarea
                  rows={4}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  placeholder="Paste question notes or test items here..."
                  required
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={loading || !rawText.trim()}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg text-sm shadow-md transition disabled:opacity-50"
                >
                  <FileText className="w-4 h-4" />
                  {loading ? "Extracting..." : "Parse & Stage"}
                </button>
              </div>
            </form>
          )}

          {/* Screenshot Extract Tab */}
          {activeTab === "screenshot" && (
            <form onSubmit={handleExtractScreenshot} className="space-y-4">
              <div className="flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 w-full">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Upload Exam Screenshot / Diagram (PNG or JPG)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setSelectedFile(file);
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => setImagePreview(ev.target?.result as string);
                        reader.readAsDataURL(file);
                      } else {
                        setImagePreview(null);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-slate-300 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Diagrams are preserved as binary images in <code className="text-indigo-400">question-assets</code> and never converted into ASCII art.
                  </p>
                </div>

                {imagePreview && (
                  <div className="w-32 h-24 border border-slate-700 rounded-lg overflow-hidden flex-shrink-0 bg-slate-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={loading || !selectedFile}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg text-sm shadow-md transition disabled:opacity-50"
                >
                  <ImageIcon className="w-4 h-4" />
                  {loading ? "Transcribing & Uploading..." : "Extract & Save Diagram"}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Staging Sandbox Review Queue */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
              Review Queue
              <span className="bg-indigo-500/20 text-indigo-400 text-xs px-2.5 py-0.5 rounded-full border border-indigo-500/30">
                {drafts.length} Staged
              </span>
            </h2>
            <span className="text-xs text-slate-400">
              Promoting runs strict Zod validation against <code className="text-indigo-300">questionSchema</code>
            </span>
          </div>

          {drafts.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30">
              <Eye className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No questions currently in staging</p>
              <p className="text-slate-500 text-xs mt-1">
                Use AI generation, text extraction, or screenshot OCR above to stage new questions.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {drafts.map((draft) => {
                const isEditing = editingId === draft.id;
                const mcqData = (draft.typeData as MCQTypeData) || {};

                return (
                  <div
                    key={draft.id}
                    className="p-5 rounded-2xl border border-slate-800 bg-slate-900/80 hover:border-slate-700 transition shadow-lg space-y-4"
                  >
                    {/* Header info */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="uppercase text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-950 text-indigo-300 border border-indigo-800">
                          {draft.type || "UNKNOWN"}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 capitalize">
                          {draft.difficulty || "medium"}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-amber-300 font-semibold">
                          {draft.marks || 0} Marks
                        </span>
                        <span className="text-[11px] text-slate-400 bg-slate-800/40 px-2 py-0.5 rounded">
                          Source: {draft.source}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 font-mono">ID: {draft.id.slice(0, 8)}...</div>
                    </div>

                    {/* Question Content / Live KaTeX Preview */}
                    {!isEditing ? (
                      <div className="space-y-3">
                        <div
                          className="text-base text-slate-100 font-normal leading-relaxed overflow-x-auto"
                          dangerouslySetInnerHTML={{
                            __html: renderMathToHtml(draft.text || "No question text"),
                          }}
                        />

                        {/* Preserved Diagram Image */}
                        {draft.imageRefs && draft.imageRefs.length > 0 && (
                          <div className="my-3 p-3 bg-slate-950/70 border border-slate-800 rounded-xl inline-block max-w-md">
                            <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1 mb-2">
                              <ImageIcon className="w-3.5 h-3.5 text-indigo-400" /> Preserved Diagram Asset
                            </span>
                            <p className="text-xs text-indigo-300 font-mono break-all mb-2">
                              {draft.imageRefs[0]}
                            </p>
                            {/* If standard URL, render img */}
                            {draft.imageRefs[0].startsWith("http") && (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={draft.imageRefs[0]}
                                alt="Diagram asset"
                                className="max-h-48 rounded object-contain border border-slate-800"
                              />
                            )}
                          </div>
                        )}

                        {/* MCQ Options Rendering */}
                        {draft.type === "mcq" && Array.isArray(mcqData.options) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                            {mcqData.options.map((opt: { id: string; text: string }) => {
                              const isCorrect = opt.id === mcqData.correctOptionId;
                              return (
                                <div
                                  key={opt.id}
                                  className={`p-2.5 rounded-lg border text-sm flex items-start gap-2 ${
                                    isCorrect
                                      ? "bg-emerald-950/40 border-emerald-600/50 text-emerald-200"
                                      : "bg-slate-950/40 border-slate-800/80 text-slate-300"
                                  }`}
                                >
                                  <span className="font-bold text-xs uppercase px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300">
                                    {opt.id}
                                  </span>
                                  <div
                                    className="flex-1 overflow-x-auto"
                                    dangerouslySetInnerHTML={{
                                      __html: renderMathToHtml(opt.text),
                                    }}
                                  />
                                  {isCorrect && (
                                    <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Numerical answer rendering */}
                        {draft.type === "numerical" && mcqData.expectedValue !== undefined && (
                          <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800 text-xs text-slate-300">
                            <span className="text-slate-400 font-medium">Expected Value: </span>
                            <span className="font-mono text-indigo-300">{mcqData.expectedValue}</span>
                            {mcqData.tolerance !== undefined && (
                              <span className="text-slate-400 ml-2">
                                (Tolerance: ±{mcqData.tolerance})
                              </span>
                            )}
                          </div>
                        )}

                        {/* Long answer solution rendering */}
                        {draft.type === "long_answer" && mcqData.solution && (
                          <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800/80 text-xs text-slate-300 space-y-1">
                            <span className="text-slate-400 font-semibold block">Marking Guide / Solution:</span>
                            <div
                              dangerouslySetInnerHTML={{
                                __html: renderMathToHtml(mcqData.solution),
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      /* In-Place Edit Mode */
                      <div className="space-y-3 bg-slate-950/90 p-4 rounded-xl border border-slate-700">
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1">
                            Question Stem (use $...$ for inline math, $$...$$ for display math)
                          </label>
                          <textarea
                            rows={3}
                            value={editForm.text || ""}
                            onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-slate-100 font-mono"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Type</label>
                            <select
                              value={editForm.type || "mcq"}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  type: e.target.value as "mcq" | "numerical" | "long_answer",
                                })
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200"
                            >
                              <option value="mcq">MCQ</option>
                              <option value="numerical">Numerical</option>
                              <option value="long_answer">Long Answer</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Difficulty</label>
                            <select
                              value={editForm.difficulty || "medium"}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  difficulty: e.target.value as "easy" | "medium" | "hard",
                                })
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200"
                            >
                              <option value="easy">Easy</option>
                              <option value="medium">Medium</option>
                              <option value="hard">Hard</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Marks</label>
                            <input
                              type="number"
                              value={editForm.marks || 1}
                              onChange={(e) => setEditForm({ ...editForm, marks: Number(e.target.value) })}
                              className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(draft.id)}
                            className="px-3 py-1.5 rounded-lg text-xs bg-indigo-600 text-white hover:bg-indigo-700 font-semibold"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Actions Bar */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                      <div className="flex items-center gap-2">
                        {!isEditing && (
                          <button
                            onClick={() => startEditing(draft)}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Edit
                          </button>
                        )}
                        <button
                          onClick={() => handleDiscard(draft.id)}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Discard
                        </button>
                      </div>

                      <button
                        onClick={() => handlePromote(draft.id)}
                        className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium px-4 py-2 rounded-xl text-xs shadow-lg shadow-emerald-950/50 transition transform hover:-translate-y-0.5"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Accept into Bank
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
