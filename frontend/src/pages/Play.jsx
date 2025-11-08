import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

export default function Play() {
  const { setLeagueData } = useGame();
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== "application/json") {
      setError("Please upload a valid JSON file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        setLeagueData(parsed);
        setFileName(file.name);
        setError("");
      } catch (err) {
        setError("Invalid JSON format.");
      }
    };
    reader.readAsText(file);
  };

  const handleContinue = () => {
    if (!fileName) {
      setError("Please upload a league file first!");
      return;
    }
    navigate("/team-selector");
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
      <h1 className="text-4xl font-bold mb-8 text-orange-500">NBA MyLeague</h1>

      <div className="flex flex-col items-center gap-4 bg-neutral-800 p-8 rounded-2xl shadow-lg">
        <label
          htmlFor="fileUpload"
          className="cursor-pointer px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Upload League JSON
        </label>
        <input
          id="fileUpload"
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileUpload}
        />

        {fileName && (
          <p className="text-green-400 text-sm mt-2">
            ✅ Loaded: <span className="font-semibold">{fileName}</span>
          </p>
        )}
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

        <button
          onClick={handleContinue}
          className="mt-6 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Continue
        </button>
      </div>

      <p className="mt-10 text-sm text-gray-400 italic">
        Tip: You can use your “NBA 2025.json” to test this.
      </p>
    </div>
  );
}
