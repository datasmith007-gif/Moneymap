import { useRef, useState } from 'react';

/**
 * Choosing the PDF — drop it or click to browse. Deliberately says where the file
 * goes (nowhere), because "upload your bank statement" is the moment a user most
 * needs to know this app has no server to upload it to.
 */

export interface FileDropProps {
  readonly onFiles: (files: readonly File[]) => void;
  readonly busy: boolean;
}

export function FileDrop({ onFiles, busy }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(files: FileList | null) {
    // Every dropped file, not just the first. A year of statements is the
    // realistic way someone arrives at this screen.
    const chosen = files === null ? [] : [...files];
    if (chosen.length > 0) onFiles(chosen);
  }

  return (
    <div
      className={`drop ${dragging ? 'drop-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) take(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files);
          // Clear it so re-picking the same file fires `change` again.
          e.target.value = '';
        }}
      />
      <p className="drop-title">
        {busy ? 'Reading your statements…' : 'Drop your statement PDFs here'}
      </p>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
        Choose files
      </button>
      <p className="drop-note">
        Drop as many as you like — password-protected files are welcome. Parsed on this device, in
        memory. Nothing is uploaded, and nothing is kept once you close the tab.
      </p>
    </div>
  );
}
