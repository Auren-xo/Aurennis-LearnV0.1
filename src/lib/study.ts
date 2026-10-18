import { z } from "zod";

export const MAX_SOURCE_CHARS = 80_000;
export const MAX_QUESTIONS_PER_REQUEST = 12;

export const studyGuideSchema = z.object({
  overview: z.string().min(20).max(2_000),
  sections: z.array(z.object({
    title: z.string().min(1).max(120),
    summary: z.string().min(20).max(1_500),
    concepts: z.array(z.string().min(1).max(240)).min(1).max(8),
    simpleExplanation: z.string().min(10).max(800),
    sourceReference: z.string().nullable(),
  })).min(1).max(12),
  keyTerms: z.array(z.object({
    term: z.string().min(1).max(120),
    definition: z.string().min(10).max(600),
    sourceReference: z.string().nullable(),
  })).max(24),
  priorities: z.array(z.string().min(1).max(240)).min(1).max(8),
  objectives: z.array(z.string().min(1).max(240)).min(1).max(10),
});

export const flashcardSchema = z.object({
  question: z.string().min(8).max(400),
  answer: z.string().min(2).max(800),
  topic: z.string().min(1).max(120),
  sourceReference: z.string().nullable(),
});

export const questionSchema = z.object({
  question: z.string().min(12).max(600),
  options: z.array(z.string().min(1).max(300)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().min(10).max(800),
  topic: z.string().min(1).max(120),
  sourceReference: z.string().nullable(),
}).superRefine((question, context) => {
  const options = question.options.map((option) => normalizeText(option));
  if (new Set(options).size !== options.length) {
    context.addIssue({
      code: "custom",
      message: "Answer options must be distinct.",
      path: ["options"],
    });
  }
});

export const questionSetSchema = z.object({
  questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS_PER_REQUEST),
});

export type StudyGuide = z.infer<typeof studyGuideSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type StudyQuestion = z.infer<typeof questionSchema>;

export function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function validateQuestionSet(value: unknown): StudyQuestion[] {
  const parsed = questionSetSchema.parse(value);
  const seen = new Set<string>();

  for (const question of parsed.questions) {
    const normalized = normalizeText(question.question);
    if (seen.has(normalized)) {
      throw new Error("Generated questions contained a duplicate.");
    }
    seen.add(normalized);
  }

  return parsed.questions;
}

export function uniqueQuestions(
  existing: StudyQuestion[],
  incoming: StudyQuestion[],
): StudyQuestion[] {
  const seen = new Set(existing.map((question) => normalizeText(question.question)));
  return incoming.filter((question) => {
    const normalized = normalizeText(question.question);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function enforceQuestionCount(
  questions: StudyQuestion[],
  requestedCount: number,
): StudyQuestion[] {
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 100) {
    throw new RangeError("Question count must be between 1 and 100.");
  }
  if (questions.length < requestedCount) {
    throw new RangeError(`Only ${questions.length} unique questions are available.`);
  }
  return questions.slice(0, requestedCount);
}

export function calculateScore(
  questions: StudyQuestion[],
  answers: Array<number | null>,
): { correct: number; total: number; percentage: number; missed: StudyQuestion[] } {
  if (answers.length !== questions.length) {
    throw new RangeError("Each question must have exactly one recorded answer.");
  }
  const missed = questions.filter((question, index) => answers[index] !== question.correctAnswer);
  const correct = questions.length - missed.length;
  return {
    correct,
    total: questions.length,
    percentage: questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100),
    missed,
  };
}

export function keepVerifiedReferences<T extends { sourceReference: string | null }>(
  value: T,
  sourceText: string,
): T {
  const reference = value.sourceReference;
  const pageMatch = reference?.match(/^Page\s+(\d+)$/i);
  const hasVerifiedPage = pageMatch
    ? sourceText.includes(`[Page ${pageMatch[1]}]`)
    : false;
  return { ...value, sourceReference: hasVerifiedPage ? `Page ${pageMatch![1]}` : null };
}

export function sanitizeSourceText(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\u0000/g, "").trim().slice(0, MAX_SOURCE_CHARS);
}

function sentenceChunks(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 25);
}

function getPageMarkers(text: string): string[] {
  const matches = [...text.matchAll(/\[?Page\s+(\d+)\]?/gi)];
  return matches.length > 0 ? matches.map((match) => `Page ${match[1]}`) : [];
}

function topTerms(text: string, limit = 8): string[] {
  const stopwords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into", "over", "under", "have", "has",
    "been", "will", "about", "through", "them", "their", "there", "these", "those", "when",
    "what", "where", "which", "while", "also", "such", "not", "more", "most", "very", "than",
    "your", "you", "are", "was", "were", "but", "can", "may", "its", "it", "is", "of", "to",
    "a", "an", "in", "on", "as", "if", "by", "or", "be", "at", "we", "our", "us",
  ]);

  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const counts = new Map<string, number>();

  for (const word of words) {
    if (stopwords.has(word) || word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

export function buildStudyGuideFromText(sourceText: string): StudyGuide {
  const cleaned = sanitizeSourceText(sourceText);
  const sentences = sentenceChunks(cleaned).slice(0, 18);
  const terms = topTerms(cleaned);
  const pageMarkers = getPageMarkers(cleaned);
  const sourceReference = pageMarkers[0] ?? null;

  const sections = [
    {
      title: "Core concepts",
      summary: sentences[0] ?? "The material introduces the central ideas and how they fit together.",
      concepts: terms.slice(0, 4).map((term) => term.replace(/-/g, " ")),
      simpleExplanation: "The main idea is that the document builds a clear set of concepts and relationships rather than isolated facts. Focus on understanding why each concept matters before memorising definitions.",
      sourceReference,
    },
    {
      title: "Key methods or mechanisms",
      summary: sentences[1] ?? "The document explains the main process, method, or framework it expects students to understand.",
      concepts: terms.slice(2, 6).map((term) => term.replace(/-/g, " ")),
      simpleExplanation: "Try to connect each method to a practical example or a clear cause-and-effect relationship. If you can explain the process in plain language, you are more likely to remember it accurately.",
      sourceReference,
    },
    {
      title: "Applications and implications",
      summary: sentences[2] ?? "The source moves beyond definition into examples, comparisons, or consequences that help explain how ideas are used.",
      concepts: terms.slice(4, 8).map((term) => term.replace(/-/g, " ")),
      simpleExplanation: "Look beyond memorisation and ask how the idea appears in real scenarios or assignments. A useful revision question is: what changes when this principle is applied in a different context?",
      sourceReference,
    },
  ].filter((section) => section.summary.length > 0);

  const keyTerms = terms.slice(0, 5).map((term, index) => ({
    term: term.replace(/-/g, " "),
    definition: `This term is important because it appears repeatedly in the source and helps explain the document's main argument or process. It is worth revising alongside related concepts from the same section.`,
    sourceReference: pageMarkers[index] ?? null,
  }));

  return {
    overview: `This document centres on ${terms[0]?.replace(/-/g, " ") ?? "the central ideas"} and related concepts that build the main argument or method. The strongest way to study it is to understand the central idea, remember the important terms, and practise explaining how the concepts connect.`,
    sections,
    keyTerms,
    priorities: [
      "Identify the central argument or framework of the document.",
      "Revisit the most frequently repeated ideas and their relationships.",
      "Be ready to explain the material in your own words.",
    ],
    objectives: [
      "Summarise the document's main argument in a few sentences.",
      "Explain the key terms and why they matter.",
      "Describe the main process, concept, or framework used in the source.",
      "Apply the material to a practical example or question.",
    ],
  };
}

export function buildFlashcardsFromText(sourceText: string, count = 6): Flashcard[] {
  const cleaned = sanitizeSourceText(sourceText);
  const sentences = sentenceChunks(cleaned).slice(0, 24);
  const terms = topTerms(cleaned);

  const cards: Flashcard[] = [];

  for (let index = 0; index < Math.min(count, Math.max(3, sentences.length)); index += 1) {
    const sentence = sentences[index];
    const term = terms[index % terms.length] ?? "Core concept";
    const topic = term.replace(/-/g, " ");
    cards.push({
      question: `What is the most important idea behind ${topic}?`,
      answer: sentence.length > 200 ? `${sentence.slice(0, 180)}...` : sentence,
      topic,
      sourceReference: null,
    });
  }

  if (cards.length === 0) {
    return [{
      question: "What are the dominant ideas in this document?",
      answer: "The document is best understood by identifying its main argument, supporting concepts, and the way they connect.",
      topic: "Core understanding",
      sourceReference: null,
    }];
  }

  return cards;
}

export function buildQuizQuestionsFromText(
  sourceText: string,
  count = 6,
  offset = 0,
): StudyQuestion[] {
  const cleaned = sanitizeSourceText(sourceText);
  const terms = topTerms(cleaned, 100);
  const sentences = sentenceChunks(cleaned);
  const questions: StudyQuestion[] = [];
  const candidates = sentences.flatMap((sentence, sentenceIndex) => {
    if (sentence.length > 450) return [];

    const normalizedSentence = normalizeText(sentence);
    const sentenceTerms = terms.filter((term) => normalizedSentence.split(" ").includes(term));
    const distractors = terms.filter((term) => !normalizedSentence.split(" ").includes(term));

    if (distractors.length < 3) return [];

    return sentenceTerms.map((term, termIndex) => {
      const sentencePattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const statement = sentence.replace(sentencePattern, "_____");
      const options = [term, ...distractors.slice(0, 3)];
      const rotation = (sentenceIndex + termIndex) % options.length;
      const rotatedOptions = [...options.slice(rotation), ...options.slice(0, rotation)];
      const correctAnswer = rotatedOptions.indexOf(term);

      return {
        question: `Which term completes this statement from the source? “${statement}”`,
        options: rotatedOptions,
        correctAnswer,
        explanation: `The source states this sentence with “${term}” in the blank.`,
        topic: term,
        sourceReference: null,
      };
    });
  });

  for (const candidate of candidates.slice(offset, offset + count)) {
    questions.push(candidate);
  }

  return questions;
}

export function getAssessmentPresets(): number[] {
  return [1, 5, 10, 15, 25, 35, 45, 55, 65, 75, 85, 100];
}
