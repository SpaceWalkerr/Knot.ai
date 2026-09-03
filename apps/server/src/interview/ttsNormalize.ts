/**
 * Backstop for TTS mispronunciation of technical terms. The proxy runs the
 * interviewer's reply through this before handing text to Agora -> TTS.
 * Keep it conservative: only rewrite tokens we've actually heard mangled.
 *
 * Test these live early with your chosen voice; add/remove as needed.
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bPostgreSQL\b/gi, "Postgres"],
  [/\bK8s\b/g, "Kubernetes"],
  [/\bnginx\b/gi, "engine X"],
  [/\bOAuth\b/g, "oh-auth"],
  [/\bJWT\b/g, "J W T"],
  [/\bGraphQL\b/g, "Graph Q L"],
  [/\bSQL\b/g, "sequel"],
  [/\bNoSQL\b/g, "no sequel"],
  [/\bCI\/CD\b/g, "C I C D"],
  [/\bkubectl\b/gi, "kube control"],
  [/\bAPI\b/g, "A P I"],
  [/\bCPU\b/g, "C P U"],
  [/\bGPU\b/g, "G P U"],
  [/\bI\/O\b/g, "I O"],
  [/\bregex\b/gi, "reg ex"],
  [/\bPII\b/g, "P I I"],
  [/\bLLM\b/g, "L L M"],
  [/\bRTC\b/g, "R T C"],
];

export function normalizeForTts(text: string): string {
  let out = text;
  for (const [re, sub] of REPLACEMENTS) out = out.replace(re, sub);
  return out;
}
