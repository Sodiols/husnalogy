"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadBuilderImage, type BuilderAsset } from "./builder-utils";
import { precheckBackgroundFile, uploadFailureOf, type UploadFailure } from "@/lib/customizer/v2/upload-failure";

/**
 * One page-background upload, start to finish, for every studio control that
 * sets a background (the Background panel and each page card's menu).
 *
 * The page changes only when the upload has succeeded: a refused or failed
 * upload never touches the current background and never adds an undo step.
 * The state says what is happening (uploading with progress, processing on
 * the server, failed with a reason) and a failed upload can be retried with
 * the same file. Only the latest upload may apply — a slower earlier one that
 * finishes afterwards is ignored.
 */
export type BackgroundUploadState =
  | { status: "idle" }
  | { status: "uploading"; pageId: string; fileName: string; progress: number }
  | { status: "processing"; pageId: string; fileName: string }
  | { status: "failed"; pageId: string; fileName: string; failure: UploadFailure };

export function useBackgroundUpload(apply: (pageId: string, asset: BuilderAsset) => void) {
  const [state, setState] = useState<BackgroundUploadState>({ status: "idle" });
  const latest = useRef(0);
  const lastRequest = useRef<{ file: File; pageId: string } | null>(null);
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  const start = useCallback(async (file: File | undefined | null, pageId: string) => {
    if (!file || !pageId) return;
    const token = ++latest.current;
    lastRequest.current = { file, pageId };
    const refused = precheckBackgroundFile(file);
    if (refused) {
      setState({ status: "failed", pageId, fileName: file.name, failure: refused });
      return;
    }
    setState({ status: "uploading", pageId, fileName: file.name, progress: 0 });
    try {
      const asset = await uploadBuilderImage(file, "background", {
        onProgress: (progress) => {
          if (token !== latest.current) return;
          // Every byte sent: the server is now decoding and optimizing.
          setState(progress >= 99
            ? { status: "processing", pageId, fileName: file.name }
            : { status: "uploading", pageId, fileName: file.name, progress });
        },
      });
      if (token !== latest.current) return;
      applyRef.current(pageId, asset);
      lastRequest.current = null;
      setState({ status: "idle" });
    } catch (error) {
      if (token !== latest.current) return;
      setState({ status: "failed", pageId, fileName: file.name, failure: uploadFailureOf(error) });
    }
  }, []);

  const retry = useCallback(() => {
    const request = lastRequest.current;
    if (request) void start(request.file, request.pageId);
  }, [start]);

  const dismiss = useCallback(() => {
    latest.current += 1;
    lastRequest.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, start, retry, dismiss, busy: state.status === "uploading" || state.status === "processing" };
}
