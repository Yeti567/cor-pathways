"use client";

import { useEffect } from "react";
import { installGlobalErrorReporter } from "@/lib/error-reporter";

/**
 * Mounts the browser error reporter for the worker app.
 *
 * Renders nothing. It exists so a JavaScript failure on a worker's phone reaches
 * the office instead of only the person standing next to the truck. Server errors
 * already show up in the hosting logs; nothing else catches this side.
 */
export function ErrorReporter() {
  useEffect(() => installGlobalErrorReporter(), []);

  return null;
}
