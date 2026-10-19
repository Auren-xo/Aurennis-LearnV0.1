import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_QUESTIONS_PER_REQUEST,
  MAX_SOURCE_CHARS,
  buildFlashcardsFromText,
  buildQuizQuestionsFromText,
  buildStudyGuideFromText,
} from "@/lib/study";

const requestSchema = z.object({
  mode: z.enum(["guide", "flashcards", "quiz"]),
  sourceText: z.string().min(100).max(MAX_SOURCE_CHARS),
  count: z.number().int().min(1).max(MAX_QUESTIONS_PER_REQUEST).optional(),
  offset: z.number().int().min(0).max(100).optional(),
  focusTopics: z.array(z.string().min(1).max(120)).max(20).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedRequest = requestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json({ error: "The study request is invalid." }, { status: 400 });
  }

  const { mode, sourceText, count = 6, offset = 0, focusTopics = [] } = parsedRequest.data;

  if (mode === "guide") {
    return NextResponse.json({ result: buildStudyGuideFromText(sourceText) });
  }

  if (mode === "flashcards") {
    const cards = buildFlashcardsFromText(sourceText, count);
    const focusedCards = focusTopics.length > 0
      ? cards.filter((card) =>
          focusTopics.some((topic) => card.topic.toLowerCase().includes(topic.toLowerCase())),
        )
      : cards;

    return NextResponse.json({ result: focusedCards.length > 0 ? focusedCards : cards });
  }

  return NextResponse.json({
    result: { questions: buildQuizQuestionsFromText(sourceText, count, offset) },
  });
}
