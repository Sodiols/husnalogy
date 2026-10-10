"use client";

import { useRef, useState } from "react";

type Sent = { key: string; name: string; status: "uploading" | "done" | "failed"; preview: string; message?: string };

const BUTTON =
  "flex min-h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-full border-[1.5px] border-[#303839] bg-white px-5 text-[17px] font-semibold text-[#303839] active:bg-[#303839]/[0.06] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2";

/** The customizer's upload route: it stores the photo and adds it to this customer's library. */
async function uploadPhoto(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", "customizer/phone");
  const res = await fetch("/api/customizer/upload", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data?.error || "Could not upload this photo.");
  return data.file;
}

/** Photos from the phone, into the customer's photo library, where the customizer picks them up. */
export default function UploadPhotosClient() {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async (input: FileList | null) => {
    const files = Array.from(input || []);
    if (!files.length) return;
    setBusy(true);
    const entries = files.map((file, index) => ({ key: `${Date.now()}-${index}`, name: file.name, status: "uploading" as const, preview: URL.createObjectURL(file) }));
    setSent((current) => [...entries, ...current]);
    const update = (key: string, patch: Partial<Sent>) => setSent((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
    // One at a time, so a rejected photo never cancels the ones that succeeded.
    for (let index = 0; index < files.length; index += 1) {
      const key = entries[index].key;
      try {
        await uploadPhoto(files[index]);
        update(key, { status: "done" });
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
    <main className="mx-auto grid min-h-dvh max-w-md content-start gap-5 bg-[#F8F6F1] px-5 py-8 text-[#1f2425]">
      <div>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#303839]/55">Husnalogy</p>
        <h1 className="mt-1 font-display text-[28px] leading-tight text-[#303839]">Upload from your phone</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#303839]/75">
          Photos you send here appear in your photos on your computer, ready to add to your design.
        </p>
      </div>

      <div className="grid gap-3">
        <button data-shape="round" type="button" className={BUTTON} disabled={busy} onClick={() => camera.current?.click()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8h3l1.5-2.5h7L17 8h3v11H4Z" /><circle cx="12" cy="13" r="3.5" />
          </svg>
          Take a photo
        </button>
        <button data-shape="round" type="button" className={BUTTON} disabled={busy} onClick={() => library.current?.click()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="m3.5 16 5-5 4 4 2.5-2.5 5.5 5.5" /><circle cx="15.5" cy="9" r="1.5" />
          </svg>
          Choose from your photos
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(event) => void send(event.target.files)} />
        <input ref={library} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Choose photos" onChange={(event) => void send(event.target.files)} />
        <p className="text-center text-[12.5px] text-[#303839]/65">JPG, PNG or WebP · up to 15MB each</p>
      </div>

      {sent.length > 0 && (
        <section aria-live="polite" className="grid gap-3">
          <p className="text-[14px] font-semibold">{done ? `${done} sent to your photos` : "Sending…"}</p>
          <ul className="grid grid-cols-3 gap-2">
            {sent.map((entry) => (
              <li key={entry.key} className="relative aspect-square overflow-hidden rounded-xl bg-[#F3F1EC]">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
                <img src={entry.preview} alt={entry.name} className={`h-full w-full object-cover ${entry.status === "uploading" ? "opacity-50" : ""}`} />
                <span
                  className={`absolute inset-x-1 bottom-1 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold ${
                    entry.status === "failed" ? "bg-red-600 text-white" : "bg-white/90 text-[#1f2425]"
                  }`}
                  title={entry.message}
                >
                  {entry.status === "done" ? "Sent" : entry.status === "failed" ? "Failed" : "Sending…"}
                </span>
              </li>
            ))}
          </ul>
          {done > 0 && <p className="text-[13px] text-[#303839]/70">You can close this page — your photos are waiting on your computer.</p>}
        </section>
      )}
    </main>
  );
}
