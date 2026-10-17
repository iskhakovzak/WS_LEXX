import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installFetchAuth } from "./lib/install-fetch-auth";

installFetchAuth();

createRoot(document.getElementById("root")!).render(<App />);
