"use client";

import { useState } from "react";
import { LocateFixed } from "lucide-react";

type CapturedCoords = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function formatGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Allow location for this site in your browser.";
    case error.POSITION_UNAVAILABLE:
      return "Could not determine your location. Try again outdoors with GPS on.";
    case error.TIMEOUT:
      return "Location request timed out. Try again with a clearer view of the sky.";
    default:
      return error.message || "GPS capture failed.";
  }
}

export function GpsPreviewButton() {
  const [status, setStatus] = useState<string>("");
  const [coords, setCoords] = useState<CapturedCoords | null>(null);
  const [busy, setBusy] = useState(false);

  function captureLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("GPS is not available on this device.");
      return;
    }

    setStatus("Capturing location...");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          accuracy: position.coords.accuracy,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setStatus("");
        setBusy(false);
      },
      (error) => {
        setStatus(formatGeolocationError(error));
        setBusy(false);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <button
        className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        onClick={captureLocation}
        type="button"
      >
        <LocateFixed className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
        {coords ? "Recapture GPS" : "Capture GPS"}
      </button>
      {coords ? (
        <p className="text-xs text-[var(--ink-muted)]">
          <span className="font-semibold text-[var(--ink)]">
            {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
          </span>
          {" "}
          (±{Math.round(coords.accuracy)} m). Sample only, not saved.
        </p>
      ) : status ? (
        <p className="text-xs text-[var(--ink-muted)]">{status}</p>
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">Workers tap this to record their location on the worker app.</p>
      )}
    </div>
  );
}
