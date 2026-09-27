// Shared config for the Question Builder controls (QuizSetup + ReviewGuide's
// practice Customize dialog). Mirrors BE/app/application/quiz_dispatch.py's
// cau_hinh_quiz() exactly: same presets, same enum, same 1..max range. No
// config endpoint exposes the BE max to FE yet, so QUESTION_COUNT_MAX just
// tracks the shipped default (QUIZ_MAX_QUESTIONS env var, default 50) — if an
// operator raises the env var without updating this, FE simply won't offer
// the extra headroom (BE still accepts more); it can never offer MORE than
// BE allows.
export const QUESTION_COUNT_PRESETS = [5, 10, 15, 20];
export const QUESTION_COUNT_MIN = 1;
export const QUESTION_COUNT_MAX = 50;

export const DIFFICULTY_OPTIONS = [
  ["mixed", "Trộn"],
  ["easy", "Dễ"],
  ["medium", "Trung bình"],
  ["hard", "Khó"],
];

export const QUESTION_TYPES = ["multiple_choice", "true_false", "short_answer"];
