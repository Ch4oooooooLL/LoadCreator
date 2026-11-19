import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/workbench.css";
import "./styles/tabular.css";

const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><App /></StrictMode>);
