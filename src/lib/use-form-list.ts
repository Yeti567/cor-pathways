"use client";

import { useEffect, useMemo, useState } from "react";
import { flattenManagedListOptions, type FormListFlatOption, type ManagedListTreeItem } from "@/lib/managed-lists";

type FormListResponse = {
  id: string;
  includeOther: boolean;
  items: ManagedListTreeItem[];
  name: string;
};

export function useFormList(listId: string | null | undefined): {
  flatOptions: FormListFlatOption[];
  includeOther: boolean;
  isLoading: boolean;
} {
  const [data, setData] = useState<FormListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(listId));

  useEffect(() => {
    if (!listId) {
      queueMicrotask(() => {
        setData(null);
        setIsLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/form-lists/${listId}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Form list was not loaded."))))
      .then((body: FormListResponse) => setData(body))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [listId]);

  const flatOptions = useMemo(() => flattenManagedListOptions(data?.items ?? [], data?.includeOther ?? false), [data]);

  return {
    flatOptions,
    includeOther: data?.includeOther ?? false,
    isLoading,
  };
}
