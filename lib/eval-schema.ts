import { Type } from "@google/genai";

// Gemini response schema (OpenAPI subset) for the evaluation call. One
// AnswerEvaluation per answered question; inline_notes anchored to page+line.
// Shared by the /api/evaluate route and the calibration harness so the two
// never drift. The matching runtime types/validation live in lib/criteria.ts
// (AnswerEvaluationSchema / EvalResultSchema).
const answerSchema = {
  type: Type.OBJECT,
  properties: {
    questionNumber: { type: Type.STRING, nullable: true },
    core_demand_met: { type: Type.STRING, enum: ["met", "partial", "not"] },
    score: { type: Type.NUMBER },
    max_score: { type: Type.NUMBER },
    one_line: { type: Type.STRING },
    demands: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          point: { type: Type.STRING },
          status: { type: Type.STRING, enum: ["hit", "partial", "missed"] },
        },
        required: ["point", "status"],
      },
    },
    value_additions: { type: Type.ARRAY, items: { type: Type.STRING } },
    structure_note: { type: Type.STRING, nullable: true },
    diagram_note: { type: Type.STRING, nullable: true },
    inline_notes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          page: { type: Type.NUMBER },
          lineIndex: { type: Type.NUMBER },
          type: { type: Type.STRING, enum: ["add", "fix", "praise"] },
          text: { type: Type.STRING },
        },
        required: ["page", "lineIndex", "type", "text"],
      },
    },
  },
  required: [
    "questionNumber",
    "core_demand_met",
    "score",
    "max_score",
    "one_line",
    "demands",
    "value_additions",
    "structure_note",
    "diagram_note",
    "inline_notes",
  ],
};

export const EVAL_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: { answers: { type: Type.ARRAY, items: answerSchema } },
  required: ["answers"],
};
