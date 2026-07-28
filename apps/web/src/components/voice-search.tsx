"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Voice input for the search box.
 *
 * Typing Devanagari or a transliterated name on a phone keyboard is slow enough
 * that many Indian shoppers simply do not search; speaking "jhumka" is instant.
 * The Web Speech API is used directly rather than through a service — the audio
 * never leaves the device's own speech engine, and there is nothing to consent
 * to beyond the browser's own microphone prompt.
 *
 * The button renders nothing at all where the API is missing. A control that
 * appears and then fails is worse than one that was never offered.
 */

interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecogniser {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type RecogniserConstructor = new () => SpeechRecogniser;

function recogniserClass(): RecogniserConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecogniserConstructor;
    webkitSpeechRecognition?: RecogniserConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function VoiceSearch({
  onResult,
}: {
  onResult: (transcript: string) => void;
}) {
  // Checked after mount, never during render: the server has no `window`, and
  // guessing would make the button appear and then vanish.
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recogniser = useRef<SpeechRecogniser | null>(null);

  useEffect(() => {
    setSupported(recogniserClass() !== undefined);
    return () => recogniser.current?.stop();
  }, []);

  function toggle() {
    if (listening) {
      recogniser.current?.stop();
      return;
    }

    const Recogniser = recogniserClass();
    if (!Recogniser) return;

    const instance = new Recogniser();
    // en-IN, so the engine expects Indian English and the Hinglish product
    // names the catalogue actually uses — a US model hears "jhumka" as noise.
    instance.lang = "en-IN";
    instance.continuous = false;
    instance.interimResults = false;

    instance.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onResult(transcript.trim());
    };
    instance.onerror = () => setListening(false);
    instance.onend = () => setListening(false);

    recogniser.current = instance;
    setListening(true);
    instance.start();
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? "Stop listening" : "Search by voice"}
      aria-pressed={listening}
      className={
        "flex h-11 w-11 shrink-0 items-center justify-center border transition-colors " +
        (listening
          ? "border-accent-ink text-accent-ink"
          : "border-content/20 text-content-muted hover:border-accent-ink hover:text-accent-ink")
      }
    >
      {/* A microphone, drawn at the kit's hairline weight rather than imported
          from an icon set that would bring its own visual language. */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
      </svg>
      {listening && <span className="sr-only">Listening</span>}
    </button>
  );
}
