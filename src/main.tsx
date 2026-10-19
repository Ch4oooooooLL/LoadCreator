import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./caseMap.css";
import "./responsive.css";

const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><App /></StrictMode>);
