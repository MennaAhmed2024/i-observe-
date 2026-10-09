import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";

import { envFromRoot } from "@/lib/env";
import {
  compactEvents,
  compactQuery,
  compactStatus,
  listEvents,
  queryTimeline,
  systemStatus,
} from "@/lib/observe";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are the assistant for I-observe, a video-intelligence system that watches
a live camera and records timestamped observations about people.

What it records: an event timeline in PostgreSQL. Each event has a wall-clock time, an
identity (a recognised enrolled person, or "unknown"/"no_face"), a shirt colour, an action
or event type, an optional rich description, and a link to an evidence image.

Rules:
- Never invent events or identities. If a tool returns nothing, say so plainly.
- Always use the tools for anything about the timeline, who was seen, when, or system health.
- Answers are about recorded evidence only; you cannot infer what was not recorded.
- Reply in the language the user wrote in (Arabic or English).
- Be concise. Quote the concrete timestamps and identities you got from the tools.
- When a tool returns image_url values, mention that an evidence frame is available.
`;

function openRouterKey(): string | undefined {
  return envFromRoot("OPENROUTER_API_KEY");
}

const tools = {
  query_timeline: tool({
    description:
      "Ask a natural-language question over the recorded event timeline. Handles " +
      "'what happened today', 'when did you last see <name>', 'who was wearing black', " +
      "'who appeared today'. Returns the answer plus matching evidence.",
    inputSchema: z.object({
      question: z.string().describe("The user's question, in their own words"),
    }),
    execute: async ({ question }) => compactQuery(await queryTimeline(question)),
  }),

  list_events: tool({
    description:
      "List the most recent events, optionally filtered by enrolled identity or by event type/action.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(15),
      identity: z.string().optional().describe("Enrolled identity name, e.g. MENNA"),
      eventType: z.string().optional().describe("Substring of the event type or action"),
    }),
    execute: async ({ limit, identity, eventType }) =>
      compactEvents(await listEvents({ limit, identity, eventType })),
  }),

  system_status: tool({
    description:
      "Health and configuration of the I-observe backends: PostgreSQL, face recognition, " +
      "the YOLOv8n object detector, the VLM, and event counts.",
    inputSchema: z.object({}),
    execute: async () => compactStatus(await systemStatus()),
  }),
};

/** No OpenRouter key: answer straight from the timeline API instead of the model. */
async function directAnswer(messages: UIMessage[]) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question =
    (lastUser?.parts ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .trim() || "what did you see today?";

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        let answer: string;
        try {
          const result = await queryTimeline(question);
          const count = result.total_events ?? result.evidence?.length ?? 0;
          answer =
            `${result.answer ?? "No answer."}\n\n` +
            (count ? `Evidence matches: ${count}.` : "No matching evidence was recorded.") +
            "\n\n_(OpenRouter key is not set, so this reply came from the timeline API directly. " +
            'Add OPENROUTER_API_KEY to .env for the full agent.)_';
        } catch (error) {
          answer = `I-observe API error: ${(error as Error).message}`;
        }
        const id = "answer";
        writer.write({ type: "text-start", id });
        for (const chunk of answer.match(/[\s\S]{1,60}/g) ?? []) {
          writer.write({ type: "text-delta", id, delta: chunk });
        }
        writer.write({ type: "text-end", id });
      },
    }),
  });
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const apiKey = openRouterKey();
  if (!apiKey) return directAnswer(messages);

  const openrouter = createOpenRouter({
    apiKey,
    headers: { "X-Title": "I-observe Assistant" },
  });
  const model = envFromRoot("VLM_MODEL") ?? "google/gemini-3.6-flash";

  const result = streamText({
    model: openrouter(model),
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
    temperature: 0,
  });

  return result.toUIMessageStreamResponse();
}
