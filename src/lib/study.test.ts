import { describe, expect, it } from "vitest";
import {
  calculateScore,
  enforceQuestionCount,
  buildQuizQuestionsFromText,
  buildStudyGuideFromText,
  validateQuestionSet,
} from "./study";

describe("study utilities", () => {
  it("calculates a reliable percentage and missed question list", () => {
    const questions = [
      { question: "What is a concept?", options: ["A", "B", "C", "D"], correctAnswer: 1, explanation: "It is an idea.", topic: "Idea", sourceReference: null },
      { question: "What is a process?", options: ["A", "B", "C", "D"], correctAnswer: 2, explanation: "It is a sequence.", topic: "Process", sourceReference: null },
    ];

    const result = calculateScore(questions, [1, 0]);
    expect(result.correct).toBe(1);
    expect(result.percentage).toBe(50);
    expect(result.missed).toHaveLength(1);
  });

  it("enforces the question count by slicing the bank", () => {
    const questions = Array.from({ length: 5 }, (_, index) => ({
      question: `Question ${index + 1}`,
      options: ["A", "B", "C", "D"],
      correctAnswer: 0,
      explanation: "This is a valid test question.",
      topic: "Topic",
      sourceReference: null,
    }));

    expect(enforceQuestionCount(questions, 3)).toHaveLength(3);
    expect(() => enforceQuestionCount(questions, 0)).toThrow();
  });

  it("rejects duplicate questions and invalid question sets", () => {
    const invalid = {
      questions: [
        { question: "Question 1", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "Reason.", topic: "Topic", sourceReference: null },
        { question: "Question 1", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "Reason.", topic: "Topic", sourceReference: null },
      ],
    };

    expect(() => validateQuestionSet(invalid)).toThrow();
  });

  it("builds a structured guide from source text", () => {
    const text = "The central idea is that ecosystems are balanced systems. Plants capture energy, animals transfer it, and decomposers recycle nutrients. This process supports biodiversity and long-term stability.";
    const guide = buildStudyGuideFromText(text);
    expect(guide.overview.length).toBeGreaterThan(20);
    expect(guide.sections.length).toBeGreaterThan(0);
    expect(guide.keyTerms.length).toBeGreaterThan(0);
  });

  it("creates distinct, correctly keyed questions from source statements", () => {
    const source = [
      "Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll absorbs light in the leaves of green plants.",
      "Carbon dioxide and water are used during photosynthesis, while oxygen is released as a product.",
      "Cellular respiration releases energy from glucose, and mitochondria are the main site of this process.",
      "Plants use carbon dioxide from the atmosphere and water from the soil to support growth.",
      "Energy transfer between organisms supports food chains and ecosystem stability.",
    ].join(" ");

    const questions = buildQuizQuestionsFromText(source, 12);

    expect(questions.length).toBeGreaterThan(8);
    expect(new Set(questions.map((question) => question.question)).size).toBe(questions.length);
    for (const question of questions) {
      expect(question.options[question.correctAnswer]).toBe(question.topic);
    }
  });

  it("returns a later question batch without repeating earlier questions", () => {
    const source = [
      "Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll absorbs light in the leaves of green plants.",
      "Carbon dioxide and water are used during photosynthesis, while oxygen is released as a product.",
      "Cellular respiration releases energy from glucose, and mitochondria are the main site of this process.",
      "Plants use carbon dioxide from the atmosphere and water from the soil to support growth.",
      "Energy transfer between organisms supports food chains and ecosystem stability.",
    ].join(" ");

    const firstBatch = buildQuizQuestionsFromText(source, 4);
    const secondBatch = buildQuizQuestionsFromText(source, 4, firstBatch.length);

    expect(secondBatch.length).toBeGreaterThan(0);
    expect(secondBatch.some((question) => firstBatch.some((prior) => prior.question === question.question))).toBe(false);
  });
});
