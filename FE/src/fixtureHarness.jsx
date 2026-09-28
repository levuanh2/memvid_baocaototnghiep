// Export Studio fixture harness entry (Round 2, section 2) — DEV-ONLY,
// never imported by the shipped app (a separate Vite HTML entry,
// fixture-harness.html, not linked from index.html or any route). See
// dev/FixtureHarnessApp.jsx for what actually renders and why.
import ReactDOM from "react-dom/client";
import FixtureHarnessApp from "./dev/FixtureHarnessApp";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(<FixtureHarnessApp />);
