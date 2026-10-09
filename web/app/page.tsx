"use client";

import {
  AssistantRuntimeProvider,
  AuiIf,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ErrorPrimitive,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/ai-sdk";

const SUGGESTIONS = [
  "what did you see today?",
  "when did you last see MENNA?",
  "who appeared today?",
  "is the system healthy?",
];

/**
 * Selectors must be stable references.
 *
 * An inline arrow passed to `AuiIf`/`useAuiState` is a new function on every render, which
 * makes the store re-subscribe forever: "Maximum update depth exceeded". Hoisting it to
 * module scope is what keeps the render loop finite.
 */
const isEmptyThread = (s: { thread: { messages: readonly unknown[] } }) =>
  s.thread.messages.length === 0;

function Composer() {
  return (
    <div className="composer-wrap">
      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="Ask about the recorded timeline…"
        />
        <ComposerPrimitive.Send className="send">Send</ComposerPrimitive.Send>
        <ComposerPrimitive.Cancel className="cancel">Stop</ComposerPrimitive.Cancel>
      </ComposerPrimitive.Root>
      <div className="hint">
        Q&amp;A runs against the real event timeline in PostgreSQL. Answers are evidence only.
      </div>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="msg assistant">
      <MessagePrimitive.Parts />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h2>I-observe Assistant</h2>
      <p>
        Natural-language questions over what the cameras actually recorded:
        who was seen, when, what they were doing, and the matching evidence frames.
      </p>
      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <ThreadPrimitive.Suggestion key={s} prompt={s} className="chip" asChild>
            <button type="button">{s}</button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const runtime = useChatRuntime();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="shell">
        <header className="topbar">
          <div>
            <h1>I-observe Assistant</h1>
            <div className="sub">Recorded events · faces, objects and actions over time</div>
          </div>
          <a href="http://localhost:8000" target="_blank" rel="noreferrer">
            Open the dashboard ↗
          </a>
        </header>

        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="viewport">
            <AuiIf condition={isEmptyThread}>
              <EmptyState />
            </AuiIf>
            <ThreadPrimitive.Messages>
              {({ message }) =>
                message.role === "user" ? <UserMessage /> : <AssistantMessage />
              }
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <Composer />
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}
