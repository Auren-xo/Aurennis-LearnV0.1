"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  MoonStar,
  SunMedium,
  Trophy,
  UploadCloud,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { GlobalWorkerOptions } from "pdfjs-dist";
import {
  calculateScore,
  getAssessmentPresets,
  type Flashcard,
  type StudyGuide,
  type StudyQuestion,
  uniqueQuestions,

} from "@/lib/study";

type Theme = "light" | "dark";
type View = "workspace" | "guide" | "flashcards" | "quiz" | "assessment" | "results";

type SessionState = {
  completedActivities: string[];
  markedForRevision: string[];
  weakTopics: string[];
  assessmentHistory: Array<{ score: number; total: number; date: string }>;
};

type DocumentState = {
  fileName: string | null;
  fileSize: number;
  extractedText: string;
  status: "idle" | "processing" | "ready" | "error";
  error: string | null;
};

const defaultSession: SessionState = {
  completedActivities: [],
  markedForRevision: [],
  weakTopics: [],
  assessmentHistory: [],
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter((value) => value.trim().length > 0);
    text += `\n[Page ${pageNumber}] ${strings.join(" ")}`;
  }

  return text.trim();
}

async function fetchStudy(
  mode: "guide" | "flashcards" | "quiz",
  sourceText: string,
  count: number,
  focusTopics: string[] = [],
  batch: { offset?: number; excludeQuestions?: string[] } = {},
) {
  const response = await fetch("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, sourceText, count, focusTopics, ...batch }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Study content could not be generated.");
  }

  return payload.result as StudyGuide | Flashcard[] | { questions: StudyQuestion[] };
}

function triggerTone(enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 660;
  gainNode.gain.value = 0.04;
  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
  void context.close();
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    const storedTheme = window.localStorage.getItem("aurennis-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return storedTheme === "light" || storedTheme === "dark" ? storedTheme : prefersDark ? "dark" : "light";
  });
  const [view, setView] = useState<View>("workspace");
  const [dragActive, setDragActive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [documentState, setDocumentState] = useState<DocumentState>({
    fileName: null,
    fileSize: 0,
    extractedText: "",
    status: "idle",
    error: null,
  });
  const [studyGuide, setStudyGuide] = useState<StudyGuide | null>(null);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [quiz, setQuiz] = useState<StudyQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelected, setQuizSelected] = useState<Record<number, number>>({});
  const [quizFeedback, setQuizFeedback] = useState<Record<number, boolean>>({});
  const [assessmentCount, setAssessmentCount] = useState(10);
  const [assessmentIndex, setAssessmentIndex] = useState(0);
  const [assessmentBank, setAssessmentBank] = useState<StudyQuestion[]>([]);
  const [assessmentAnswers, setAssessmentAnswers] = useState<Array<number | null>>([]);
  const [assessmentSubmitted, setAssessmentSubmitted] = useState(false);
  const [availableAssessmentCount, setAvailableAssessmentCount] = useState(0);
  const [sessionState, setSessionState] = useState<SessionState>(() => {
    if (typeof window === "undefined") return defaultSession;
    const storedSession = window.localStorage.getItem("aurennis-session");
    if (!storedSession) return defaultSession;
    try {
      return JSON.parse(storedSession) as SessionState;
    } catch {
      return defaultSession;
    }
  });
  const [resultSummary, setResultSummary] = useState<{ correct: number; total: number; percentage: number; missed: StudyQuestion[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [popQuizOpen, setPopQuizOpen] = useState(false);
  const [popQuiz, setPopQuiz] = useState<StudyQuestion[]>([]);
  const [popQuizSelection, setPopQuizSelection] = useState<Record<number, number>>({});
  const [lastActivity, setLastActivity] = useState<View>("workspace");

  const assessmentPresets = useMemo(() => getAssessmentPresets(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("aurennis-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("aurennis-session", JSON.stringify(sessionState));
  }, [sessionState]);

  const hasDocument = documentState.extractedText.length > 0;
  const currentFlashcard = flashcards[flashcardIndex] ?? null;
  const updateSession = (patch: Partial<SessionState>) => {
    setSessionState((current) => ({ ...current, ...patch }));
  };

  const handleFileSelection = async (file: File | null) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setDocumentState({
        fileName: file.name,
        fileSize: file.size,
        extractedText: "",
        status: "error",
        error: "Please upload a real PDF file.",
      });
      setErrorMessage("Unsupported file type. Only PDF files are accepted.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setDocumentState({
        fileName: file.name,
        fileSize: file.size,
        extractedText: "",
        status: "error",
        error: "This PDF is too large for a study session. Please use a smaller document.",
      });
      setErrorMessage("The PDF exceeds the 15 MB processing limit.");
      return;
    }

    setDocumentState({
      fileName: file.name,
      fileSize: file.size,
      extractedText: "",
      status: "processing",
      error: null,
    });
    setErrorMessage(null);

    try {
      const text = await extractPdfText(file);
      const cleanText = text.replace(/\s+/g, " ").trim();
      if (!cleanText || cleanText.length < 150) {
        throw new Error("No readable text was detected. This may be a scanned PDF or image-only document.");
      }
      setDocumentState({
        fileName: file.name,
        fileSize: file.size,
        extractedText: text,
        status: "ready",
        error: null,
      });
      setView("workspace");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read this PDF.";
      setDocumentState({
        fileName: file.name,
        fileSize: file.size,
        extractedText: "",
        status: "error",
        error: message,
      });
      setErrorMessage(message);
    }
  };

  const generateGuide = async () => {
    if (!hasDocument) {
      setErrorMessage("Upload a PDF before generating a study guide.");
      return;
    }
    setIsGenerating(true);
    try {
      const result = (await fetchStudy("guide", documentState.extractedText, 6)) as StudyGuide;
      setStudyGuide(result);
      setView("guide");
      setLastActivity("guide");
      updateSession({ completedActivities: [...new Set([...sessionState.completedActivities, "study-guide"]) ] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate the guide.");
    } finally {
      setIsGenerating(false);
    }
  };

  const generateFlashcards = async () => {
    if (!hasDocument) {
      setErrorMessage("Upload a PDF before generating flashcards.");
      return;
    }
    setIsGenerating(true);
    try {
      const result = (await fetchStudy("flashcards", documentState.extractedText, 6, sessionState.markedForRevision)) as Flashcard[];
      setFlashcards(result);
      setFlashcardIndex(0);
      setShowAnswer(false);
      setView("flashcards");
      setLastActivity("flashcards");
      updateSession({ completedActivities: [...new Set([...sessionState.completedActivities, "flashcards"]) ] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate flashcards.");
    } finally {
      setIsGenerating(false);
    }
  };

  const generateQuiz = async (requestedCount = 3, modalMode = false) => {
    if (!hasDocument) {
      setErrorMessage("Upload a PDF before generating practice questions.");
      return;
    }
    setIsGenerating(true);
    try {
      const result = (await fetchStudy("quiz", documentState.extractedText, requestedCount, sessionState.markedForRevision)) as { questions: StudyQuestion[] };
      const questions = result.questions ?? [];
      if (questions.length === 0) {
        throw new Error("The PDF did not provide enough meaningful questions to generate a quiz.");
      }
      setQuiz(questions);
      setQuizIndex(0);
      setQuizSelected({});
      setQuizFeedback({});
      if (modalMode) {
        setPopQuiz(questions);
        setPopQuizOpen(true);
      } else {
        setView("quiz");
        setLastActivity("quiz");
      }
      updateSession({ completedActivities: [...new Set([...sessionState.completedActivities, "quiz"]) ] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate a quiz.");
    } finally {
      setIsGenerating(false);
    }
  };

  const beginAssessment = async () => {
    if (!hasDocument) {
      setErrorMessage("Upload a PDF before beginning an assessment.");
      return;
    }
    setErrorMessage(null);
    setIsGenerating(true);
    setAvailableAssessmentCount(0);
    try {
      const requestedCount = Number(assessmentCount);
      const generatedQuestions: StudyQuestion[] = [];
      let remaining = requestedCount;
      let noProgressAttempts = 0;
      while (remaining > 0 && noProgressAttempts < 3) {
        const batchSize = Math.min(12, remaining);
        const result = (await fetchStudy(
          "quiz",
          documentState.extractedText,
          batchSize,
          sessionState.markedForRevision,
          {
            offset: generatedQuestions.length,
            excludeQuestions: generatedQuestions.map((question) => question.question),
          },
        )) as { questions: StudyQuestion[] };
        const incoming = result.questions ?? [];
        const unique = uniqueQuestions(generatedQuestions, incoming);
        if (unique.length === 0) {
          noProgressAttempts += 1;
          continue;
        }
        generatedQuestions.push(...unique.slice(0, remaining));
        remaining -= unique.length;
        noProgressAttempts = 0;
      }
      if (generatedQuestions.length < requestedCount) {
        setAssessmentBank(generatedQuestions);
        setAvailableAssessmentCount(generatedQuestions.length);
        throw new Error(
          `This document supports ${generatedQuestions.length} distinct questions, fewer than the ${requestedCount} selected. You can choose to start with the available questions or upload a longer source.`,
        );
      }
      const finalAssessment = generatedQuestions.slice(0, requestedCount);
      setAssessmentBank(finalAssessment);
      setAssessmentAnswers(new Array(finalAssessment.length).fill(null));
      setAssessmentIndex(0);
      setAssessmentSubmitted(false);
      setView("assessment");
      setLastActivity("assessment");
      updateSession({ completedActivities: [...new Set([...sessionState.completedActivities, "assessment"]) ] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate the assessment.");
    } finally {
      setIsGenerating(false);
    }
  };

  const beginAvailableAssessment = () => {
    if (assessmentBank.length === 0) return;
    setAssessmentCount(assessmentBank.length);
    setAssessmentAnswers(new Array(assessmentBank.length).fill(null));
    setAssessmentIndex(0);
    setAssessmentSubmitted(false);
    setAvailableAssessmentCount(0);
    setView("assessment");
    setLastActivity("assessment");
    setErrorMessage(null);
  };

  const submitAssessment = () => {
    if (assessmentSubmitted) return;
    const result = calculateScore(assessmentBank, assessmentAnswers);
    setResultSummary(result);
    setAssessmentSubmitted(true);
    setView("results");
    updateSession({
      assessmentHistory: [{ score: result.correct, total: result.total, date: new Date().toISOString() }, ...sessionState.assessmentHistory].slice(0, 8),
      weakTopics: [...new Set([...sessionState.weakTopics, ...result.missed.map((item) => item.topic)])],
    });
    if (result.percentage >= 80) {
      triggerTone(soundEnabled);
      confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
    }
  };

  const currentResultFeedback = useMemo(() => {
    if (!resultSummary) return "";
    if (resultSummary.percentage >= 80) return "You did brilliantly. You have demonstrated a strong understanding of the material. Let’s keep that momentum going.";
    if (resultSummary.percentage >= 60) return "That is a strong result. You understand a lot of the material; now focus on the few concepts that still need tightening.";
    if (resultSummary.percentage >= 40) return "You are making good progress. Some ideas are already clicking, and a few areas still need attention.";
    return "This attempt shows us where to focus next. You do not have to master everything at once; revisit the difficult ideas and try again.";
  }, [resultSummary]);

  const removeDocument = () => {
    setDocumentState({ fileName: null, fileSize: 0, extractedText: "", status: "idle", error: null });
    setStudyGuide(null);
    setFlashcards([]);
    setQuiz([]);
    setAssessmentBank([]);
    setAssessmentAnswers([]);
    setAssessmentIndex(0);
    setAvailableAssessmentCount(0);
    setResultSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 rounded-[28px] border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}>
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl" style={{ background: "linear-gradient(135deg, var(--accent-soft), rgba(171,147,255,0.35))" }}>
              <BookOpen color="var(--accent)" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Aurennis Learn</p>
              <h1 className="text-xl font-semibold">v0.1 study companion</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="rounded-full border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => setSoundEnabled((current) => !current)}>
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button className="rounded-full border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}>
              {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <div className="rounded-[28px] border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div
                className="rounded-3xl border border-dashed p-6 text-center transition-all"
                style={{ borderColor: dragActive ? "var(--accent)" : "var(--border)", background: "var(--surface)" }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void handleFileSelection(event.dataTransfer.files[0] ?? null);
                }}
              >
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={(event) => void handleFileSelection(event.target.files?.[0] ?? null)} />
                <div className="mx-auto flex size-16 items-center justify-center rounded-2xl" style={{ background: "var(--accent-soft)" }}>
                  <UploadCloud size={28} color="var(--accent)" />
                </div>
                <p className="mt-5 text-lg font-semibold">Upload a course PDF</p>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Drag and drop or choose a file. Maximum size: 15 MB.</p>
                <button className="mt-5 rounded-full px-5 py-2.5 font-medium text-white" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }} onClick={() => fileInputRef.current?.click()}>
                  Choose PDF
                </button>
              </div>

              <div className="mt-5 rounded-3xl p-5" style={{ background: "var(--surface-muted)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl p-2" style={{ background: "var(--accent-soft)" }}>
                      <FileText size={18} color="var(--accent)" />
                    </div>
                    <div>
                      <p className="font-semibold">{documentState.fileName ?? "No document selected"}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{documentState.fileName ? formatBytes(documentState.fileSize) : "Upload a PDF to begin"}</p>
                    </div>
                  </div>
                  {documentState.fileName && (
                    <button className="rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }} onClick={removeDocument}>Remove</button>
                  )}
                </div>
                <div className="mt-4 rounded-2xl p-3 text-sm" style={{ background: "rgba(255,255,255,0.04)" }}>
                  {documentState.status === "processing" && <span>Processing PDF text…</span>}
                  {documentState.status === "ready" && <span>Source text extracted successfully and ready for study generation.</span>}
                  {documentState.status === "error" && <span style={{ color: "var(--danger)" }}>{documentState.error}</span>}
                  {documentState.status === "idle" && <span>No document currently loaded.</span>}
                </div>
                {documentState.extractedText && (
                  <div className="mt-4 max-h-40 overflow-auto rounded-2xl border p-3 text-xs leading-6" style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}>
                    {documentState.extractedText.slice(0, 900)}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Study flow</h2>
                <BookOpen size={18} color="var(--accent)" />
              </div>
              <div className="space-y-2">
                {[
                  { label: "Study guide", action: generateGuide },
                  { label: "Flashcards", action: generateFlashcards },
                  { label: "Quick quiz", action: () => void generateQuiz(3, false) },
                  { label: "Assessment", action: beginAssessment },
                ].map((item) => (
                  <button
                    key={item.label}
                    className="flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition-colors"
                    style={{ borderColor: "var(--border)", background: view === item.label.toLowerCase().replace(/\s+/g, "-") ? "var(--accent-soft)" : "transparent" }}
                    onClick={() => {
                      if (!hasDocument) {
                        setErrorMessage("Upload a PDF before beginning a study activity.");
                        return;
                      }
                      void item.action();
                    }}
                  >
                    <span className="font-medium">{item.label}</span>
                    <ArrowRight size={16} color="var(--accent)" />
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <h3 className="mb-3 font-semibold">Session progress</h3>
              <div className="flex flex-wrap gap-2">
                {sessionState.completedActivities.length === 0 ? (
                  <span className="text-sm" style={{ color: "var(--muted)" }}>No activities completed yet.</span>
                ) : (
                  sessionState.completedActivities.map((item) => (
                    <span key={item} className="rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                      {item.replace("-", " ")}
                    </span>
                  ))
                )}
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <p><strong>{sessionState.markedForRevision.length}</strong> flashcards marked for revision</p>
                <p><strong>{sessionState.weakTopics.length}</strong> weak topics tracked</p>
              </div>
            </div>
          </aside>

          <section className="space-y-6">
            {errorMessage && (
              <div role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
                {errorMessage}
                {availableAssessmentCount > 0 && (
                  <button
                    className="ml-3 rounded-full border px-3 py-1.5 font-medium"
                    style={{ borderColor: "var(--border)" }}
                    onClick={beginAvailableAssessment}
                  >
                    Start with {availableAssessmentCount} available
                  </button>
                )}
              </div>
            )}

            {view === "workspace" && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[28px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="mb-4 flex items-center gap-2">
                  <BookOpen size={20} color="var(--accent)" />
                  <h2 className="text-xl font-semibold">Your study workspace</h2>
                </div>
                <p className="max-w-2xl leading-7" style={{ color: "var(--muted)" }}>
                  Upload a document to turn dense course material into a revision-friendly study flow. Start with the guide, work through active recall cards, and then challenge yourself with a short pop quiz or a longer assessment.
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <button onClick={generateGuide} className="rounded-3xl border p-4 text-left" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                    <p className="text-sm uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>01</p>
                    <h3 className="mt-3 text-lg font-semibold">Study guide</h3>
                    <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Review the document’s core ideas, priorities, and clear explanations.</p>
                  </button>
                  <button onClick={generateFlashcards} className="rounded-3xl border p-4 text-left" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                    <p className="text-sm uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>02</p>
                    <h3 className="mt-3 text-lg font-semibold">Flashcards</h3>
                    <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Test recall and flag topics you want to revisit.</p>
                  </button>
                  <button onClick={() => void generateQuiz(3, false)} className="rounded-3xl border p-4 text-left" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                    <p className="text-sm uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>03</p>
                    <h3 className="mt-3 text-lg font-semibold">Practice quiz</h3>
                    <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Try a short focus challenge with immediate feedback.</p>
                  </button>
                </div>

                <div className="mt-6 rounded-3xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Assessment setup</h3>
                    <button onClick={() => void generateQuiz(3, true)} className="rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>Pop quiz</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {assessmentPresets.map((value) => (
                      <button
                        key={value}
                        className="rounded-full border px-3 py-1.5 text-sm"
                        style={{ borderColor: "var(--border)", background: assessmentCount === value ? "var(--accent-soft)" : "transparent" }}
                        onClick={() => setAssessmentCount(value)}
                      >
                        Q-{value}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <label htmlFor="custom-count" className="text-sm" style={{ color: "var(--muted)" }}>Custom</label>
                    <input
                      id="custom-count"
                      type="number"
                      min={1}
                      max={100}
                      value={assessmentCount}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) setAssessmentCount(Math.min(100, Math.max(1, value)));
                      }}
                      className="w-24 rounded-xl border px-2 py-2 text-sm"
                      style={{ background: "transparent", borderColor: "var(--border)" }}
                    />
                    <button className="rounded-full px-4 py-2 text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }} onClick={() => void beginAssessment()}>
                      Start assessment
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {view === "guide" && studyGuide && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 rounded-[28px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Study guide</p>
                    <h2 className="text-2xl font-semibold">Document overview</h2>
                  </div>
                  <button className="rounded-full border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => setView("workspace")}>Return</button>
                </div>
                <div className="rounded-3xl p-5" style={{ background: "var(--surface-muted)" }}>
                  <p className="leading-7">{studyGuide.overview}</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {studyGuide.sections.map((section) => (
                    <div key={section.title} className="rounded-3xl border p-4" style={{ borderColor: "var(--border)" }}>
                      <h3 className="text-lg font-semibold">{section.title}</h3>
                      <p className="mt-3 text-sm leading-6" style={{ color: "var(--muted)" }}>{section.summary}</p>
                      <div className="mt-4">
                        <p className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--muted)" }}>Concepts</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                          {section.concepts.map((concept) => <li key={concept}>{concept}</li>)}
                        </ul>
                      </div>
                      <p className="mt-4 text-sm leading-6"><strong>Plain-language explanation:</strong> {section.simpleExplanation}</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border p-4" style={{ borderColor: "var(--border)" }}>
                    <h3 className="text-lg font-semibold">Key terms</h3>
                    <ul className="mt-3 space-y-2 text-sm">
                      {studyGuide.keyTerms.map((term) => (
                        <li key={term.term} className="rounded-2xl p-3" style={{ background: "var(--surface-muted)" }}>
                          <span className="font-semibold">{term.term}</span>: {term.definition}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-3xl border p-4" style={{ borderColor: "var(--border)" }}>
                    <h3 className="text-lg font-semibold">Priorities</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                      {studyGuide.priorities.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    <h3 className="mt-5 text-lg font-semibold">Learning objectives</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                      {studyGuide.objectives.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                  <div>
                    <p className="font-semibold">Ready to check what you remember?</p>
                    <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Your assessment is set to {assessmentCount} questions. You can change this in the workspace.</p>
                  </div>
                  <button
                    className="rounded-full px-5 py-2.5 text-sm font-medium text-white"
                    style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
                    onClick={() => void beginAssessment()}
                  >
                    Start assessment
                  </button>
                </div>
              </motion.div>
            )}

            {view === "flashcards" && flashcards.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[28px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Flashcards</p>
                    <h2 className="text-2xl font-semibold">Active recall</h2>
                  </div>
                  <div className="rounded-full px-3 py-1 text-sm" style={{ background: "var(--accent-soft)" }}>{flashcardIndex + 1} / {flashcards.length}</div>
                </div>
                {currentFlashcard && (
                  <div className="mt-6 rounded-[28px] border p-6" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                    <p className="mb-3 text-sm uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>{currentFlashcard.topic}</p>
                    <p className="text-2xl font-medium leading-tight">{currentFlashcard.question}</p>
                    <AnimatePresence mode="wait">
                      {showAnswer && (
                        <motion.div key="answer" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mt-6 rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "rgba(122,110,240,0.08)" }}>
                          <p className="text-sm uppercase tracking-[0.16em]" style={{ color: "var(--muted)" }}>Answer</p>
                          <p className="mt-2 leading-7">{currentFlashcard.answer}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <button className="rounded-full px-4 py-2 text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }} onClick={() => setShowAnswer((current) => !current)}>{showAnswer ? "Hide answer" : "Reveal answer"}</button>
                      <button className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => {
                        const topic = currentFlashcard.topic;
                        const next = sessionState.markedForRevision.includes(topic)
                          ? sessionState.markedForRevision.filter((item) => item !== topic)
                          : [...sessionState.markedForRevision, topic];
                        updateSession({ markedForRevision: next });
                      }}>
                        {sessionState.markedForRevision.includes(currentFlashcard.topic) ? "Unmark for review" : "Mark for review"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-6 flex items-center justify-between">
                  <button className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => {
                    setFlashcardIndex((current) => (current === 0 ? flashcards.length - 1 : current - 1));
                    setShowAnswer(false);
                  }}><ChevronLeft size={16} /> Previous</button>
                  <button className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => {
                    setFlashcardIndex((current) => (current + 1) % flashcards.length);
                    setShowAnswer(false);
                  }}>Next <ChevronRight size={16} /></button>
                </div>
              </motion.div>
            )}

            {view === "quiz" && quiz.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[28px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Quick quiz</p>
                    <h2 className="text-2xl font-semibold">Check your understanding</h2>
                  </div>
                  <div className="rounded-full px-3 py-1 text-sm" style={{ background: "var(--accent-soft)" }}>{quizIndex + 1} / {quiz.length}</div>
                </div>
                {quiz[quizIndex] && (
                  <div className="mt-6 space-y-4">
                    <p className="text-xl font-medium leading-tight">{quiz[quizIndex].question}</p>
                    <div className="space-y-3">
                      {quiz[quizIndex].options.map((option, optionIndex) => (
                        <button
                          key={option}
                          className="flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left"
                          style={{ borderColor: "var(--border)", background: quizSelected[quizIndex] === optionIndex ? "var(--accent-soft)" : "transparent" }}
                          onClick={() => {
                            setQuizSelected((current) => ({ ...current, [quizIndex]: optionIndex }));
                            setQuizFeedback((current) => ({ ...current, [quizIndex]: optionIndex === quiz[quizIndex].correctAnswer }));
                          }}
                        >
                          <span>{option}</span>
                          {quizSelected[quizIndex] === optionIndex && (
                            <span className="text-xs" style={{ color: "var(--accent)" }}>{quizFeedback[quizIndex] ? "Correct" : "Choice"}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {quizSelected[quizIndex] !== undefined && (
                      <div className="rounded-2xl p-4 text-sm" style={{ background: "var(--surface-muted)" }}>
                        {quizFeedback[quizIndex] ? "Correct — " : "Not quite — "}{quiz[quizIndex].explanation}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <button className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => setQuizIndex((current) => (current === 0 ? quiz.length - 1 : current - 1))}><ChevronLeft size={16} /> Previous</button>
                      <button className="rounded-full px-4 py-2 text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }} onClick={() => setQuizIndex((current) => (current + 1) % quiz.length)}>Next <ChevronRight size={16} /></button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {view === "assessment" && assessmentBank.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[28px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Assessment</p>
                    <h2 className="text-2xl font-semibold">Question {assessmentIndex + 1} of {assessmentBank.length}</h2>
                  </div>
                  <div className="rounded-full px-3 py-1 text-sm" style={{ background: "var(--accent-soft)" }}>{assessmentBank.length} questions</div>
                </div>
                {assessmentBank[assessmentIndex] && (
                  <div className="space-y-5">
                    <p className="text-xl font-medium leading-8">{assessmentBank[assessmentIndex].question}</p>
                    <div className="space-y-3">
                      {assessmentBank[assessmentIndex].options.map((option, optionIndex) => (
                        <button
                          key={option}
                          className="flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left"
                          style={{ borderColor: "var(--border)", background: assessmentAnswers[assessmentIndex] === optionIndex ? "var(--accent-soft)" : "transparent" }}
                          onClick={() => {
                            const next = [...assessmentAnswers];
                            next[assessmentIndex] = optionIndex;
                            setAssessmentAnswers(next);
                          }}
                        >
                          <span>{option}</span>
                          {assessmentAnswers[assessmentIndex] === optionIndex && <CheckCircle2 size={18} color="var(--accent)" />}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <button
                        className="rounded-full border px-4 py-2 text-sm disabled:opacity-50"
                        style={{ borderColor: "var(--border)" }}
                        onClick={() => setAssessmentIndex((current) => Math.max(0, current - 1))}
                        disabled={assessmentIndex === 0}
                      >
                        <span className="inline-flex items-center gap-1"><ChevronLeft size={16} /> Previous</span>
                      </button>

                      <button
                        className="rounded-full px-5 py-2.5 text-sm font-medium text-white"
                        style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
                        onClick={() => {
                          if (assessmentIndex === assessmentBank.length - 1) {
                            submitAssessment();
                            return;
                          }
                          setAssessmentIndex((current) => Math.min(assessmentBank.length - 1, current + 1));
                        }}
                      >
                        {assessmentIndex === assessmentBank.length - 1 ? "Submit assessment" : "Next question"}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {view === "results" && resultSummary && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[28px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Results</p>
                    <h2 className="text-2xl font-semibold">Assessment summary</h2>
                  </div>
                  <Trophy size={26} color="var(--accent)" />
                </div>
                <div className="mt-6 rounded-[28px] border p-5" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                  <p className="text-4xl font-semibold">{resultSummary.correct}/{resultSummary.total}</p>
                  <p className="mt-2 text-lg">{resultSummary.percentage}%</p>
                  <p className="mt-3 leading-7">{currentResultFeedback}</p>
                </div>
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border p-4" style={{ borderColor: "var(--border)" }}>
                    <h3 className="text-lg font-semibold">Weak topics</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                      {resultSummary.missed.length === 0 ? <li>Excellent work — no weak topics were flagged.</li> : resultSummary.missed.slice(0, 5).map((question) => <li key={question.question}>{question.topic}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-3xl border p-4" style={{ borderColor: "var(--border)" }}>
                    <h3 className="text-lg font-semibold">Review answers</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      {assessmentBank.map((question, index) => (
                        <div key={question.question} className="rounded-2xl p-3" style={{ background: "var(--surface-muted)" }}>
                          <p className="font-medium">Q{index + 1}: {question.question}</p>
                          <p className="mt-1">Your answer: {assessmentAnswers[index] !== null ? question.options[assessmentAnswers[index] as number] : "No response"}</p>
                          <p className="mt-1">Correct answer: {question.options[question.correctAnswer]}</p>
                          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{question.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {popQuizOpen && popQuiz.length > 0 && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
                <div className="w-full max-w-2xl rounded-[28px] border p-6" style={{ background: "var(--surface-strong)", borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Pop quiz</p>
                      <h3 className="text-xl font-semibold">Quick challenge</h3>
                    </div>
                    <button onClick={() => {
                      setPopQuizOpen(false);
                      setView(lastActivity);
                    }} className="rounded-full border p-2" style={{ borderColor: "var(--border)" }}><X size={16} /></button>
                  </div>
                  {popQuiz.map((question, index) => (
                    <div key={question.question} className="mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
                      <p className="font-medium">{index + 1}. {question.question}</p>
                      <div className="mt-3 space-y-2">
                        {question.options.map((option, optionIndex) => (
                          <button
                            key={option}
                            className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm"
                            style={{ borderColor: "var(--border)", background: popQuizSelection[index] === optionIndex ? "var(--accent-soft)" : "transparent" }}
                            onClick={() => setPopQuizSelection((current) => ({ ...current, [index]: optionIndex }))}
                          >
                            <span>{option}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="mt-5 flex items-center justify-between">
                    <button className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => { setPopQuizOpen(false); setView(lastActivity); }}>Skip</button>
                    <button className="rounded-full px-4 py-2 text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }} onClick={() => {
                      triggerTone(soundEnabled);
                      setPopQuizOpen(false);
                      setView(lastActivity);
                    }}>Finish</button>
                  </div>
                </div>
              </div>
            )}

            {isGenerating && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30">
                <div className="rounded-full border px-4 py-2 text-sm font-medium text-white" style={{ background: "rgba(20, 20, 26, 0.8)" }}>
                  Generating study content…
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
