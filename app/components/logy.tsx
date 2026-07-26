"use client";

import { useEffect, useRef, useState } from "react";

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

  const sendMessage = async () => {
    const cleanMessage = message.trim();

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
      <button type="button" onClick={toggleLogy} className="group fixed bottom-[76px] right-5 z-30 overflow-hidden rounded-full bg-[#303839] px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-white transition-all duration-300 hover:scale-[1.02] sm:right-6 sm:px-7 sm:py-3.5 lg:bottom-6" aria-label="Open Logy assistant">
        <span className="absolute inset-0 -translate-x-full rounded-none bg-white transition-transform duration-500 ease-out group-hover:translate-x-0" />

        <span className="relative z-10 duration-500 group-hover:text-[#303839] font-bold">
          Logy
        </span>
      </button>

      {askOpen && (
        <section
          className="fixed inset-x-3 bottom-[144px] z-50 mx-auto flex max-h-[78vh] w-auto max-w-[420px] flex-col overflow-hidden rounded-none border border-[#E6E6E6]/20 bg-white shadow-[0_30px_90px_rgba(0,0,0,0.22)] sm:inset-x-auto sm:right-6 sm:w-[420px] sm:rounded-none lg:bottom-24"
          aria-label="Logy assistant"
        >
          <div className="bg-[#303839] p-4 text-white sm:p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold leading-none sm:text-2xl">
                  Chat with Logy
                </h2>
              </div>

              <button
                type="button"
                onClick={closeLogy}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-2xl leading-none transition hover:bg-white hover:text-black"
                aria-label="Close Logy"
              >
                ×
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="max-h-[46vh] flex-1 space-y-3 overflow-y-auto p-4 sm:max-h-[420px] sm:p-5">
              {messages.map((item, index) => {
                const isUser = item.role === "user";

                return (
                  <div
                    key={`${item.role}-${index}`}
                    className={`flex ${isUser ? "justify-end" : "justify-start"
                      }`}
                  >
                    <div
                      className={`max-w-[85%] whitespace-pre-line rounded-none px-4 py-3 text-sm leading-6 ${isUser
                        ? "bg-[#303839] text-white"
                        : "border border-black/5 bg-white text-[#303839]/80 shadow-sm"
                        }`}
                    >
                      {item.content}
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-none border border-black/5 bg-white px-4 py-3 text-sm leading-6 text-[#303839]/60 shadow-sm">
                    Logy is thinking...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-black/10 bg-white p-4 sm:p-5">
              {error && (
                <p className="mb-3 rounded-none bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
                  {error}
                </p>
              )}

              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  className="min-h-12 max-h-28 flex-1 resize-none rounded-none border border-black/10 px-5 py-3 text-sm leading-6 text-[#303839] outline-none transition focus:border-[#303839]"
                  placeholder="Ask about cards, gifts, or invitations"
                />

                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={loading || !message.trim()}
                  className="h-12 shrink-0 rounded-full bg-[#303839] px-5 text-xs font-extrabold uppercase tracking-[0.12em] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 sm:px-6"
                >
                  {loading ? "Wait" : "Send"}
                </button>
              </div>

              <p className="mt-3 text-center text-[10px] leading-4 text-black/40">
                Logy can help with finding the best products, gift ideas and more. Just ask!
              </p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
