import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_QUESTIONS_PER_REQUEST,
  MAX_SOURCE_CHARS,
  buildFlashcardsFromText,
  buildQuizQuestionsFromText,
  buildStudyGuideFromText,
  flashcardSchema,
  questionSetSchema,
  studyGuideSchema,
  keepVerifiedReferences,
  validateQuestionSet,
} from "@/lib/study";

export const maxDuration = 60;

const requestSchema = z.object({
  mode: z.enum(["guide", "flashcards", "quiz"]),
  sourceText: z.string().min(100).max(MAX_SOURCE_CHARS),
  count: z.number().int().min(1).max(MAX_QUESTIONS_PER_REQUEST).optional(),
  offset: z.number().int().min(0).max(100).optional(),
  focusTopics: z.array(z.string().min(1).max(120)).max(20).optional(),
  excludeQuestions: z.array(z.string().min(1).max(600)).max(100).optional(),
});

function getPrompt(
  mode: "guide" | "flashcards" | "quiz",
  sourceText: string,
  count: number,
  focusTopics: string[],
  excludeQuestions: string[],
): string {
  const trimmed = sourceText.slice(0, Math.min(sourceText.length, 15_000));
  if (mode === "guide") {
    return `Produce a valid JSON object that matches the studyGuideSchema for this source text. Use only the content in the source and never invent facts. If a claim is unsupported, keep sourceReference as null.\n\n${trimmed}`;
  }
  if (mode === "flashcards") {
    return `Produce a valid JSON array of flashcard objects. Keep to ${count} high-value cards max and use only supported facts from the source.\n\n${trimmed}`;
  }
  const focus = focusTopics.length > 0
    ? `Prioritise these topics where supported: ${focusTopics.join(", ")}.`
    : "";
  const excluded = excludeQuestions.length > 0
    ? `Do not repeat or closely paraphrase these questions: ${excludeQuestions.join(" | ")}`
    : "";
  return `Produce a valid JSON object { questions: [...] } with up to ${count} multiple choice questions using only supported facts. Each question must have 4 distinct options, a correctAnswer index, explanation, topic, and sourceReference. Return fewer if the source cannot support more. ${focus} ${excluded}\n\n${trimmed}`;
}

async function generateWithAI(
  sourceText: string,
  mode: "guide" | "flashcards" | "quiz",
  count: number,
  focusTopics: string[],
  excludeQuestions: string[],
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const providerModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: providerModel,
        temperature: 0.2,
        max_tokens: mode === "guide" ? 5_000 : 4_000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a careful study assistant. Return valid JSON only and use only information supported by the provided source text. Never fabricate facts or page references.",
          },
          { role: "user", content: getPrompt(mode, sourceText, count, focusTopics, excludeQuestions) },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return null;
    }

    const parsed = JSON.parse(content);

    if (mode === "guide") {
      const validated = studyGuideSchema.safeParse(parsed);
      if (!validated.success) return null;
      return {
        ...validated.data,
        sections: validated.data.sections.map((item) => keepVerifiedReferences(item, sourceText)),
        keyTerms: validated.data.keyTerms.map((item) => keepVerifiedReferences(item, sourceText)),
      };
    }

    if (mode === "flashcards") {
      const validated = z.array(flashcardSchema).min(1).max(30).safeParse(parsed);
      if (!validated.success) return null;
      return validated.data.map((item) => keepVerifiedReferences(item, sourceText));
    }

    const validated = questionSetSchema.safeParse(parsed);
    if (!validated.success) return null;
    const uniqueQuestions = validateQuestionSet(validated.data);
    return {
      questions: uniqueQuestions.map((item) => keepVerifiedReferences(item, sourceText)),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json({ error: "The study request is invalid." }, { status: 400 });
  }

  const {
    mode,
    sourceText,
    count = 6,
    offset = 0,
    focusTopics = [],
    excludeQuestions = [],
  } = parsedRequest.data;

  const aiResult = await generateWithAI(sourceText, mode, count, focusTopics, excludeQuestions);
  if (aiResult) {
    return NextResponse.json({ result: aiResult });
  }

  if (mode === "guide") {
    return NextResponse.json({ result: buildStudyGuideFromText(sourceText) });
  }

  if (mode === "flashcards") {
    const cards = buildFlashcardsFromText(sourceText, count);
    const filtered = focusTopics.length > 0
      ? cards.filter((card) => focusTopics.some((topic) => card.topic.toLowerCase().includes(topic.toLowerCase())))
      : cards;
    return NextResponse.json({ result: filtered.length > 0 ? filtered : cards });
  }

  const questions = buildQuizQuestionsFromText(sourceText, count, offset);
  return NextResponse.json({ result: { questions } });
}
