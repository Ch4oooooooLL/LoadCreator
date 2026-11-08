import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./caseMap.css";
import "./responsive.css";
import "./workbench-v2.css";
import "./titlebar.css";

const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><App /></StrictMode>);
