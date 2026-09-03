/**
 * Parser for Agora Conversational AI live-transcription stream messages.
 *
 * ⚠️ Agora has shipped a couple of wire formats for this. The current one is a
 * JSON payload (sometimes length-prefixed / chunked) with fields like
 * { object, text, is_final, stream_id, turn_id }. Verify against the docs when
 * you get access and adjust `parseStreamMessage` — everything downstream keys
 * off the normalised `LiveCaption` shape below.
 *   https://docs.agora.io/en/conversational-ai/develop/subtitles
 */

export interface LiveCaption {
  speaker: "candidate" | "interviewer";
  text: string;
  isFinal: boolean;
  turnId?: string;
}

const decoder = new TextDecoder();

export function parseStreamMessage(payload: Uint8Array): LiveCaption | null {
  const raw = decoder.decode(payload).trim();
  if (!raw) return null;

  // Some builds prefix a small header before the JSON body; find the first '{'.
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let obj: any;
  try {
    obj = JSON.parse(raw.slice(start));
  } catch {
    return null;
  }

  const text: string = obj.text ?? obj.transcript ?? "";
  if (!text) return null;

  // stream_id / uid 0 (or the agent uid) => interviewer; anything else => candidate
  const fromAgent =
    obj.stream_id === 0 ||
    obj.uid === 0 ||
    obj.role === "assistant" ||
    obj.object === "assistant.transcription";

  return {
    speaker: fromAgent ? "interviewer" : "candidate",
    text,
    isFinal: Boolean(obj.is_final ?? obj.final ?? false),
    turnId: obj.turn_id ?? obj.turnId,
  };
}
