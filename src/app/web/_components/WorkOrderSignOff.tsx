"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { completeAssignedWorkOrder } from "@/app/actions";

const primaryButton =
  "inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90";
const ghostButton =
  "inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]";

// Completion with an optional customer sign-off, drawn on a canvas. The PNG data
// URL is stashed in a hidden input so the native form submit carries it to the
// server action. Completing with the signature left blank is allowed.
export function WorkOrderSignOff({ disabled = false, workOrderId }: { disabled?: boolean; workOrderId: string }) {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    drawing.current = true;
    lastPoint.current = pointFromEvent(event);
  }

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) {
      return;
    }
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPoint.current) {
      return;
    }
    const next = pointFromEvent(event);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastPoint.current = next;
  }

  function endDrawing() {
    if (!drawing.current) {
      return;
    }
    drawing.current = false;
    lastPoint.current = null;
    const canvas = canvasRef.current;
    if (canvas && hiddenRef.current) {
      hiddenRef.current.value = canvas.toDataURL("image/png");
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (hiddenRef.current) {
      hiddenRef.current.value = "";
    }
  }

  if (!open) {
    return (
      <button
        className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(true)}
        type="button"
      >
        Mark complete
      </button>
    );
  }

  return (
    <form action={completeAssignedWorkOrder} className="w-full space-y-3 rounded-md border border-[var(--border)] bg-white p-3">
      <input name="workOrderId" type="hidden" value={workOrderId} />
      <input name="signatureData" ref={hiddenRef} type="hidden" />
      <p className="text-sm font-semibold text-[var(--ink)]">Customer sign-off (optional)</p>
      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Printed name</span>
        <input
          className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          name="signerName"
          placeholder="Customer name"
          type="text"
        />
      </label>
      <div className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Signature</span>
        <canvas
          className="h-40 w-full touch-none rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-muted)]"
          height={180}
          onPointerDown={startDrawing}
          onPointerLeave={endDrawing}
          onPointerMove={draw}
          onPointerUp={endDrawing}
          ref={canvasRef}
          width={600}
        />
        <button className="text-xs font-semibold text-[var(--primary)] hover:underline" onClick={clearSignature} type="button">
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={primaryButton} type="submit">
          Complete job
        </button>
        <button className={ghostButton} onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
