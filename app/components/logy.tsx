"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Starter questions shown while the conversation is new.
const SUGGESTIONS = [
  "Help me choose wedding invitations",
  "Gift ideas for a birthday",
  "Which paper options do you offer?",
];

export default function Logy({ askOpen, setAskOpen }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Welcome to Husnalogy. Tell me what occasion you are shopping for, and I will help you choose the right card, invitation, or gift.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const toggleLogy = () => {
    setAskOpen(!askOpen);
  };

  const closeLogy = () => {
    setAskOpen(false);
  };

  useEffect(() => {
    if (askOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
    }
  }, [askOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const cleanText = (value) => {
    if (typeof value !== "string") return "";

    return value
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1: $2")
      .replace(/\bAsk\s+Logy\b/gi, "Logy")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/__/g, "")
      .replace(/_/g, "")
      .replace(/`/g, "")
      .replace(/#{1,6}\s?/g, "")
      .replace(/^\s*[-•]\s+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const sendMessage = async (text?: string) => {
    const cleanMessage = (typeof text === "string" ? text : message).trim();

    if (!cleanMessage || loading) return;

    const userMessage = {
      role: "user",
      content: cleanMessage,
    };

    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setMessage("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/ask-logy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: cleanMessage,
          history: messages,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Something went wrong.");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content: cleanText(
            data?.reply ||
            "Of course, I can help. Please tell me what kind of card, invitation, or gift you are looking for."
          ),
        },
      ]);
    } catch (err) {
      const errorMessage =
        err?.message ||
        "Logy is having trouble responding right now. Please try again.";

      setError(errorMessage);

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            "Sorry, Logy is having trouble responding right now. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Sits above the mobile tab bar (60px + safe area) and in the corner on
          desktop, clear of page content and purchase controls. */}
      <button
        type="button"
        onClick={toggleLogy}
        data-shape="round"
        aria-expanded={askOpen}
        className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-12 w-12 items-center justify-center gap-2 rounded-full border border-ink bg-ink text-[14px] sm:h-11 sm:w-auto sm:px-4 font-semibold text-white shadow-[var(--shadow-card)] transition-colors duration-200 hover:bg-ink-hover sm:right-6 lg:bottom-6"
        aria-label={askOpen ? "Close Logy assistant" : "Open Logy assistant"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
        </svg>
        <span className="hidden sm:inline">Ask Logy</span>
      </button>

      {askOpen && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="logy-title"
          className="fixed inset-x-3 bottom-[calc(128px+env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[72vh] w-auto max-w-[400px] flex-col overflow-hidden rounded-[10px] border border-line bg-white shadow-[var(--shadow-overlay)] sm:inset-x-auto sm:right-6 sm:w-[400px] lg:bottom-20"
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="logy-title" className="font-display text-[1.375rem] font-medium leading-tight text-ink">
                Logy
              </h2>
              <p className="text-[13px] leading-5 text-muted">Husnalogy shopping assistant</p>
            </div>
            <button
              type="button"
              onClick={closeLogy}
              data-shape="round"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-cream"
              aria-label="Close Logy"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12" />
                <path d="m18 6-12 12" />
              </svg>
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="max-h-[46vh] flex-1 space-y-3 overflow-y-auto bg-cream/60 px-4 py-4 sm:max-h-[380px]" aria-live="polite">
              {messages.map((item, index) => {
                const isUser = item.role === "user";

                return (
                  <div key={`${item.role}-${index}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <p
                      className={`max-w-[85%] whitespace-pre-line px-3.5 py-2.5 text-[14px] leading-6 ${
                        isUser
                          ? "rounded-[10px] rounded-br-[4px] bg-ink text-white"
                          : "rounded-[10px] rounded-bl-[4px] border border-line bg-white text-ink"
                      }`}
                    >
                      <span className="sr-only">{isUser ? "You: " : "Logy: "}</span>
                      {item.content}
                    </p>
                  </div>
                );
              })}

              {messages.length === 1 && !loading && (
                <div className="flex flex-wrap gap-2 pt-1" aria-label="Suggested questions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => sendMessage(suggestion)}
                      className="min-h-9 border border-field bg-white px-3 py-1.5 text-left text-[13px] font-medium text-ink transition-colors hover:border-ink/50 hover:bg-cream"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex justify-start">
                  <p className="inline-flex items-center gap-1.5 rounded-[10px] rounded-bl-[4px] border border-line bg-white px-3.5 py-3" role="status">
                    <span className="sr-only">Logy is typing</span>
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        aria-hidden="true"
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/50"
                        style={{ animationDelay: `${dot * 160}ms` }}
                      />
                    ))}
                  </p>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <form
              className="border-t border-line bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage();
              }}
            >
              {error && (
                <p role="alert" className="notice notice-error mb-3 text-[13px]">
                  {error}
                </p>
              )}

              <div className="flex items-end gap-2 rounded-[10px] border border-field bg-white p-1.5 pl-3 transition-colors focus-within:border-ink focus-within:shadow-[0_0_0_2px_rgba(48,56,57,0.08)]">
                <label htmlFor="logy-message" className="sr-only">
                  Message Logy
                </label>
                <textarea
                  id="logy-message"
                  ref={inputRef}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Ask about cards, gifts or invitations"
                  className="input-bare max-h-28 min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-[15px] leading-6 text-ink outline-none placeholder:text-[#747b7c]"
                />
                <button
                  type="submit"
                  disabled={loading || !message.trim()}
                  data-shape="round"
                  aria-label="Send message"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-white transition-colors hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                </button>
              </div>

              <p className="mt-2 text-center text-[12px] leading-5 text-muted">
                For help with an existing order,{" "}
                <Link href="/contact" onClick={closeLogy} className="font-semibold text-ink underline underline-offset-2">
                  contact us
                </Link>
                .
              </p>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
