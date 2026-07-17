const DEFAULT_REDIRECT_PATH = "/";

export function getSafeRedirectPath(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_REDIRECT_PATH;
  }

  try {
    const url = new URL(value, "https://core-pathways.local");
    const path = `${url.pathname}${url.search}${url.hash}`;

    if (path.startsWith("/login") || path.startsWith("/auth")) {
      return DEFAULT_REDIRECT_PATH;
    }

    return path;
  } catch {
    return DEFAULT_REDIRECT_PATH;
  }
}

export function getAuthRedirectUrl(baseUrl: string, nextPath: string) {
  const url = new URL("/auth/confirm", baseUrl);
  url.searchParams.set("next", getSafeRedirectPath(nextPath));
  return url.toString();
}
