"use client";

import { useRef, useState } from "react";
import { uploadBuilderImage } from "@/app/admin/dashboard/design-builder/builder-utils";

type Sent = { key: string; name: string; status: "uploading" | "done" | "failed"; progress: number; preview: string; message?: string };

const BUTTON =
  "flex min-h-14 w-full items-center justify-center gap-3 rounded-full border-[1.5px] border-[#27307A] bg-white px-5 text-[17px] font-semibold text-[#27307A] active:bg-[#27307A]/[0.06] disabled:opacity-60";

/** Photos from the phone, through the studio's own upload pipeline, into the shared library. */
export default function UploadFromPhoneClient() {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async (input: FileList | null) => {
    const files = Array.from(input || []);
    if (!files.length) return;
    setBusy(true);
    const entries = files.map((file, index) => ({ key: `${Date.now()}-${index}`, name: file.name, status: "uploading" as const, progress: 0, preview: URL.createObjectURL(file) }));
    setSent((current) => [...entries, ...current]);
    const update = (key: string, patch: Partial<Sent>) => setSent((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
    for (let index = 0; index < files.length; index += 1) {
      const key = entries[index].key;
      try {
        await uploadBuilderImage(files[index], "image", { onProgress: (progress) => update(key, { progress }) });
        update(key, { status: "done", progress: 100 });
      } catch (caught: any) {
        update(key, { status: "failed", message: caught?.message || "Could not upload this photo." });
      }
    }
    setBusy(false);
    if (camera.current) camera.current.value = "";
    if (library.current) library.current.value = "";
  };

  const done = sent.filter((entry) => entry.status === "done").length;

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-start gap-5 bg-white px-5 py-8 text-[#1f2425]">
      <div>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#303839]/50">Husnalogy Design Studio</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight">Upload from your phone</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#303839]/75">
          Photos you send here appear in the studio&apos;s Uploads on your computer, ready to add to a design.
        </p>
      </div>

      <div className="grid gap-3">
        <button data-shape="round" type="button" className={BUTTON} disabled={busy} onClick={() => camera.current?.click()}>
          Take a photo
        </button>
        <button data-shape="round" type="button" className={BUTTON} disabled={busy} onClick={() => library.current?.click()}>
          Choose from your photos
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(event) => void send(event.target.files)} />
        <input ref={library} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple className="sr-only" aria-label="Choose photos" onChange={(event) => void send(event.target.files)} />
      </div>

      {sent.length > 0 && (
        <section aria-live="polite" className="grid gap-3">
          <p className="text-[14px] font-semibold">{done ? `${done} sent to the studio` : "Sending…"}</p>
          <ul className="grid grid-cols-3 gap-2">
            {sent.map((entry) => (
              <li key={entry.key} className="relative aspect-square overflow-hidden rounded-xl bg-[#F2F3F5]">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
                <img src={entry.preview} alt={entry.name} className={`h-full w-full object-cover ${entry.status === "uploading" ? "opacity-50" : ""}`} />
                <span
                  className={`absolute inset-x-1 bottom-1 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold ${
                    entry.status === "failed" ? "bg-red-600 text-white" : entry.status === "done" ? "bg-white/90 text-[#1f2425]" : "bg-white/80 text-[#1f2425]"
                  }`}
                  title={entry.message}
                >
                  {entry.status === "done" ? "Sent" : entry.status === "failed" ? "Failed" : `${entry.progress}%`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
