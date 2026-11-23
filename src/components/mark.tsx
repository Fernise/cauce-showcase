/** Cauce mark: a channel seen from above — two banks and the water between them, bending to a new course. */
export function Mark({ className = "size-8", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="64" height="64" rx="5" fill="#191816" />
      <g fill="none" strokeWidth="6">
        <path stroke="#f2efe8" d="M8 15H22C33 15 33 31 44 31H56" />
        <path stroke="#6fa6c8" strokeWidth="4" d="M8 26H18C29 26 29 42 40 42H56" />
        <path stroke="#f2efe8" d="M8 37H14C25 37 25 53 36 53H56" />
      </g>
    </svg>
  );
}

/** Lowercase wordmark set in condensed Archivo; pairs with <Mark/>. */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`cond text-[1.375rem] leading-none font-[780] tracking-[-0.01em] ${className}`}>cauce</span>;
}
