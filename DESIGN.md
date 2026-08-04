---
name: Cor Pathway 360
colors:
  background: "#F7F9FB"
  surface: "#FFFFFF"
  surfaceMuted: "#EEF3F5"
  ink: "#182024"
  inkMuted: "#56656D"
  primary: "#0F766E"
  primaryDark: "#0B4F4A"
  accent: "#C2410C"
  border: "#D7E0E4"
  success: "#15803D"
  warning: "#B45309"
  danger: "#B42318"
typography:
  family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  bodySize: "16px"
  smallSize: "14px"
  headingWeight: 700
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
radius:
  sm: "4px"
  md: "8px"
  lg: "12px"
elevation:
  card: "0 1px 2px rgba(24, 32, 36, 0.08)"
---

## Overview
Cor Pathway 360 should feel like a practical field operations console. The product is not a marketing site and it is not branded as a safety-only tool. The interface should make forms, locations, workers, resources, and sync state easy to scan under pressure.

## Colors
Use teal as the product anchor, with warm rust only for focused calls to action or warnings. Keep large surfaces neutral and readable. Avoid one-color screens and avoid decorative gradients.

## Typography
Use system UI fonts for fast loading and offline resilience. Headings should be compact and direct. Dense admin tables should use smaller text than mobile form screens.

## Layout
Mobile user workflows are phone first. Admin views can be wider and denser, but must remain usable on tablet. Prefer full-width work surfaces over floating section cards. Cards are for repeated entities, dialogs, and framed tools.

## Components
Buttons, filters, tabs, and forms must expose focus states. Use icon buttons where the action is familiar. Keep radius at 8px or below for most controls unless a mobile touch target benefits from a softer shape.

## Do's And Don'ts
Do make offline state visible and calm. Do make tenant boundaries explicit in admin and developer surfaces. Do not include worker chat. Do not use safety as the product headline.
