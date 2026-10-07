"use client";

import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";

// Thème accordé à la charte : même fond que la page, gouttière discrète.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#0a0a0a !important", color: "#ededed", fontSize: "13px" },
    ".cm-gutters, .cm-activeLineGutter": { backgroundColor: "#0a0a0a !important" },
    // Police et interligne sur tout le scroller : la gouttière reste alignée avec les lignes.
    ".cm-scroller": { fontFamily: "var(--font-geist-mono), ui-monospace, monospace", lineHeight: "1.6" },
    ".cm-content": { caretColor: "#ededed" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#5c5c5c", border: "none", borderRight: "1px solid #1c1c1c" },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#8f8f8f" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgb(255 255 255 / 0.12) !important" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

const extensions = [StreamLanguage.define(shell), editorTheme];

export function ScriptEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="overflow-hidden rounded-md border border-line focus-within:border-[#5c5c5c]">
      <CodeMirror value={value} onChange={onChange} extensions={extensions} theme="dark" height="360px" basicSetup={{ lineNumbers: true }} />
    </div>
  );
}
