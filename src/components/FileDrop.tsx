import { useRef, useState } from 'react';

/**
 * Choosing the PDF — drop it or click to browse. Deliberately says where the file
 * goes (nowhere), because "upload your bank statement" is the moment a user most
 * needs to know this app has no server to upload it to.
 */

export interface FileDropProps {
  readonly onFile: (file: File) => void;
  readonly busy: boolean;
}

export function FileDrop({ onFile, busy }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
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
        hidden
        onChange={(e) => {
          take(e.target.files);
          // Clear it so re-picking the same file fires `change` again.
          e.target.value = '';
        }}
      />
      <p className="drop-title">{busy ? 'Reading the statement…' : 'Drop a statement PDF here'}</p>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
        Choose a file
      </button>
      <p className="drop-note">
        Parsed on this device, in memory. Nothing is uploaded, and nothing is kept once you close
        the tab.
      </p>
    </div>
  );
}
