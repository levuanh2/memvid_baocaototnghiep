import { useContext } from "react";
import { StudyContext } from "./studyContext";

export function useStudyContext() {
  const ctx = useContext(StudyContext);
  if (ctx === null) {
    throw new Error("useStudyContext must be used within <StudyContextProvider>");
  }
  return ctx;
}
