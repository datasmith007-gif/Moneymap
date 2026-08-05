import { useId, useRef, useState, type ReactNode } from 'react';

/**
 * A standing note collapsed to a single glyph, revealed on hover or focus.
 *
 * Exists because a permanent box per caveat teaches the reader to stop seeing
 * all of them, and because a caveat sitting between two figures competes with
 * the figures it only qualifies. Collapsing keeps the text one gesture away
 * without giving it the weight of a finding.
 *
 * Hover alone would put the content out of reach of keyboards and touch, so
 * focus opens it too — which is also what makes a tap work, since tapping a
 * button focuses it. Escape closes an open tip by blurring the trigger, so the
 * keyboard path out is the same as the keyboard path in.
 *
 * The revealed content is mounted only while open. An always-mounted, visually
 * hidden panel is the usual alternative, but it puts every caveat on the page
 * for a screen reader to walk through, which is the always-open box again in a
 * different medium.
 */
export function InfoTip({
  glyph,
  label,
  text,
  badge,
  tone = 'note',
  align = 'start',
  children,
}: {
  /** The trigger's icon. `!` warns, `i` informs. */
  readonly glyph: string;
  /** The trigger's accessible name — it must say what is behind the tip. */
  readonly label: string;
  /** Optional visible trigger label; use when the disclosure is page-level. */
  readonly text?: string;
  /** Optional short text beside the glyph, e.g. how many notes are collected. */
  readonly badge?: string;
  readonly tone?: 'note' | 'warning';
  /** Which edge of the trigger the panel is anchored to. */
  readonly align?: 'start' | 'end';
  readonly children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = hovered || focused;

  return (
    <span
      className={`infotip infotip-${tone} infotip-${align}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setHovered(false);
        trigger.current?.blur();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="infotip-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <span className="infotip-glyph" aria-hidden="true">
          {glyph}
        </span>
        {text !== undefined && <span className="infotip-text">{text}</span>}
        {badge !== undefined && <span className="infotip-badge">{badge}</span>}
      </button>

      {open && (
        <span id={panelId} className="infotip-panel" role="note">
          {children}
        </span>
      )}
    </span>
  );
}
