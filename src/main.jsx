import React from "react";
import { createRoot } from "react-dom/client";
import DonationFinder from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DonationFinder />
  </React.StrictMode>
);
