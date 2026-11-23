"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy } from "lucide-react";

export function SubmitButton({
  children, className = "btn-primary", pendingText, name, value, title,
}: { children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string; title?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value} title={title}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

export function CopyButton({ text, label = "Copiar", className = "btn-secondary" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          window.prompt("Copia el texto:", text);
        }
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {done ? "Copiado" : label}
    </button>
  );
}
