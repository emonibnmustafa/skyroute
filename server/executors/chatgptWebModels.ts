export const MODEL_MAP: Record<string,string> = {
  "gpt-5-6": "gpt-5-6",
  "gpt-5-6-thinking": "gpt-5-6-thinking",
  "gpt-5-6-pro": "gpt-5-6-pro",
  "gpt-5-5": "gpt-5-5",
  "gpt-5-5-thinking": "gpt-5-5-thinking",
  "gpt-5-5-pro": "gpt-5-5-pro",
  "gpt-5.6-luna-free": "auto",
  "gpt-5.6-luna-free-thinking": "auto",
  "gpt-5.6-sol-instant": "gpt-5-6",
  "gpt-5.6-sol-medium": "gpt-5-6-thinking",
  "gpt-5.6-sol-high": "gpt-5-6-thinking",
  "gpt-5.6-sol-xhigh": "gpt-5-6-thinking",
  "gpt-5.6-sol-pro": "gpt-5-6-pro",
  "gpt-5.5-instant": "gpt-5-5",
  "gpt-5.5-medium": "gpt-5-5-thinking",
  "gpt-5.5-high": "gpt-5-5-thinking",
  "gpt-5.5-xhigh": "gpt-5-5-thinking",
  "gpt-5.5-pro": "gpt-5-5-pro",
  "gpt-5.5-pro-extended": "gpt-5-5-pro",
  "gpt-5.5": "gpt-5-5",
  // legacy aliases from earlier OmniRoute versions
  "gpt-5.6": "gpt-5-6",
  "gpt-5.4": "gpt-5-6",
  "gpt-4o": "gpt-5-6",
  "gpt-4": "gpt-5-6",
  "o3": "gpt-5-6-thinking",
};

export const CHATGPT_WEB_MODELS: Array<{ id:string; name:string; description:string }> = [
  { id:"gpt-5-6", name:"GPT-5.6 Sol Instant", description:"Fast ChatGPT 5.6 - Plus" },
  { id:"gpt-5-6-thinking", name:"GPT-5.6 Sol Thinking", description:"Thinking / reasoning" },
  { id:"gpt-5-6-pro", name:"GPT-5.6 Sol Pro", description:"Pro long-running (Pro plan)" },
  { id:"gpt-5-5", name:"GPT-5.5", description:"GPT-5.5 base" },
  { id:"gpt-5-5-thinking", name:"GPT-5.5 Thinking", description:"GPT-5.5 reasoning" },
  { id:"gpt-5-5-pro", name:"GPT-5.5 Pro", description:"Pro" },
  { id:"gpt-5-6-thinking", name:"GPT-5.6 Thinking", description:"Alias" },
  { id:"gpt-5.6-luna-free", name:"GPT-5.6 Luna Free (auto)", description:"Free auto router" },
  { id:"gpt-5.6-luna-free-thinking", name:"GPT-5.6 Luna Free Thinking", description:"Free thinking" },
];

export function resolveChatGptModel(modelId: string): { slug:string; isPro:boolean } {
  const slug = MODEL_MAP[modelId] ?? MODEL_MAP[modelId.toLowerCase()] ?? modelId;
  const isPro = slug === "gpt-5-6-pro" || slug === "gpt-5-5-pro" || modelId.includes("-pro");
  return { slug, isPro };
}
