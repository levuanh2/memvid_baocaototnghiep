// Test/dev-only visual harness. It is outside src and is not bundled by the
// production entrypoint. It renders the real guided dialog with fixture APIs.
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import GuidedMindmapHarness from "../src/components/Layout/GuidedMindmapHarness.testonly.jsx";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") || "ready";
const mobile = params.get("mobile") === "1";
const dark = params.get("dark") === "1";

createRoot(document.getElementById("root")).render(
  <GuidedMindmapHarness initialState={state} mobile={mobile} dark={dark} />,
);
