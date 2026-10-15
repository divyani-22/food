import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

/**
 * The API key and the endpoint it is sent to must come from the same provider: a Forge key only ever goes to the
 * Forge URL (default forge.manus.im), an OpenAI key only to OPENAI_BASE_URL / api.openai.com. Mixing them (for
 * example BUILT_IN_FORGE_API_URL set without its key while OPENAI_API_KEY is set) would leak one provider's
 * credential to the other's server.
 */
const resolveProvider = (): { apiKey: string; url: string } => {
  if (ENV.forgeApiKey) {
    const base = ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0 ? ENV.forgeApiUrl.replace(/\/$/, "") : "https://forge.manus.im";
    return { apiKey: ENV.forgeApiKey, url: `${base}/v1/chat/completions` };
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (process.env.OPENAI_BASE_URL) {
    return { apiKey, url: `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions` };
  }
  return { apiKey, url: "https://api.openai.com/v1/chat/completions" };
};

const getApiKey = () => resolveProvider().apiKey;

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

function generateFallbackResponse(params: InvokeParams): InvokeResult {
  const lastUserMsg = params.messages
    .filter(m => m.role === "user")
    .map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join(" ");

  const formatName =
    params.outputSchema?.name ||
    (params.responseFormat && "json_schema" in params.responseFormat
      ? params.responseFormat.json_schema.name
      : "") ||
    (params.response_format && "json_schema" in params.response_format
      ? params.response_format.json_schema.name
      : "");

  let contentStr = "";

  if (formatName === "ingredient_analysis") {
    const match = lastUserMsg.match(/Ingredients:\s*([\s\S]*?)(?:For each ingredient|IMPORTANT|$)/i);
    const rawList = match ? match[1] : lastUserMsg;
    const items = rawList
      .split(/[,;\n•]+/)
      .map(s => s.trim().replace(/^[-*\d.)\s]+/, ""))
      .filter(s => s.length > 1 && !s.toLowerCase().startsWith("ingredients") && !s.toLowerCase().startsWith("user context"));

    const list = items.length > 0 ? items : ["Sugar", "Palm Oil", "Maltodextrin", "Salt", "Wheat Flour"];

    const ingredients = list.map(name => {
      const lower = name.toLowerCase();
      if (lower.includes("palm oil") || lower.includes("hydrogenated") || lower.includes("vegetable fat")) {
        return {
          name,
          scientificName: "Elaeis guineensis oil",
          category: "Unhealthy Fat / Saturated Fat",
          riskLevel: "high",
          shortTermEffects: "Increases postprandial blood lipid levels.",
          longTermEffects: "Elevates LDL cholesterol and accelerates plaque formation in arteries.",
          sideEffects: "High saturated fat density, potential inflammatory response in high doses.",
          personalizedRisk: "High risk: excessive saturated fat intake raises cardiovascular concerns.",
          sources: ["WHO Guidelines on Saturated Fatty Acid Intake", "FSSAI Regulations 2022"]
        };
      } else if (lower.includes("sugar") || lower.includes("syrup") || lower.includes("dextrose") || lower.includes("maltodextrin") || lower.includes("fructose") || lower.includes("sucrose")) {
        return {
          name,
          scientificName: "Added Refined Sugar / High Glycemic Sweetener",
          category: "Hidden Sugar / Caloric Sweetener",
          riskLevel: "high",
          shortTermEffects: "Sharp blood sugar spikes followed by rapid insulin crashes.",
          longTermEffects: "Contributes to insulin resistance, obesity, type 2 diabetes, and non-alcoholic fatty liver disease.",
          sideEffects: "Increased sugar cravings, lethargy, increased dental plaque.",
          personalizedRisk: "High risk: hidden sugars exceed recommended daily intake under the Label Padhega India mission.",
          sources: ["WHO Guideline: Sugars intake for adults and children", "ICMR-NIN Dietary Guidelines"]
        };
      } else if (lower.includes("salt") || lower.includes("sodium")) {
        return {
          name,
          scientificName: "Sodium Chloride",
          category: "Mineral / Flavoring & Preservative",
          riskLevel: "moderate",
          shortTermEffects: "Fluid retention and temporary blood pressure elevation.",
          longTermEffects: "Chronic hypertension, cardiovascular strain, and kidney load.",
          sideEffects: "Water retention, bloating, and increased thirst.",
          personalizedRisk: "Moderate risk: check against WHO daily limit of 2,000 mg sodium (5g salt).",
          sources: ["WHO Sodium Intake Guidance", "FSSAI Consumer Alert"]
        };
      } else if (lower.includes("msg") || lower.includes("glutamate") || lower.includes("e621")) {
        return {
          name,
          scientificName: "Monosodium Glutamate (INS 621)",
          category: "Flavor Enhancer",
          riskLevel: "moderate",
          shortTermEffects: "Mild flushing, headache, or tingling in sensitive individuals.",
          longTermEffects: "Can cause hyper-palatability leading to overeating ultra-processed foods.",
          sideEffects: "Occasional mild sensitivity symptoms.",
          personalizedRisk: "Moderate risk: encourages overconsumption of low-nutrition foods.",
          sources: ["FSSAI Food Additives Schedule", "PubMed PMID: 30130593"]
        };
      } else if (lower.includes("benzoate") || lower.includes("sorbate") || lower.includes("preservative") || lower.includes("e211") || lower.includes("e202")) {
        return {
          name,
          scientificName: "Synthetic Preservative (INS 211 / INS 202)",
          category: "Chemical Preservative",
          riskLevel: "moderate",
          shortTermEffects: "Usually well-tolerated; potential mild histamine response.",
          longTermEffects: "Can form benzene in the presence of citric/ascorbic acid and heat.",
          sideEffects: "Potential allergic reactions in sensitive individuals.",
          personalizedRisk: "Moderate risk: frequent consumption of synthetic preservatives is discouraged.",
          sources: ["WHO Food Additives Evaluation", "FSSAI Regulations 2011"]
        };
      } else if (lower.includes("color") || lower.includes("colour") || lower.includes("tartrazine") || lower.includes("e102") || lower.includes("e110") || lower.includes("sunset yellow") || lower.includes("caramel")) {
        return {
          name,
          scientificName: "Synthetic Food Coloring",
          category: "Artificial Color",
          riskLevel: "high",
          shortTermEffects: "May trigger hyperactivity in children and sensitive adults.",
          longTermEffects: "Potential allergic sensitization and cellular oxidative stress.",
          sideEffects: "Skin rashes, hyperactivity, and intolerance.",
          personalizedRisk: "High risk: artificially colored items should be minimized, especially for children.",
          sources: ["The Lancet Southampton Study", "FSSAI Mandatory Warning Declarations"]
        };
      } else {
        return {
          name,
          scientificName: "Natural / Botanical Ingredient",
          category: "Whole Food Base",
          riskLevel: "safe",
          shortTermEffects: "Normal nutritional digestion.",
          longTermEffects: "Supports balanced metabolic health.",
          sideEffects: "None known at typical dietary amounts.",
          personalizedRisk: "Safe: standard ingredient considered healthy in a balanced diet.",
          sources: ["FSSAI Food Standards", "WHO Healthy Diet Factsheet"]
        };
      }
    });

    const highRisks = ingredients.filter(i => i.riskLevel === "high" || i.riskLevel === "severe").length;
    const modRisks = ingredients.filter(i => i.riskLevel === "moderate").length;
    const overallRiskScore = Math.min(95, Math.max(15, Math.round(highRisks * 28 + modRisks * 14 + 12)));

    contentStr = JSON.stringify({
      ingredients,
      overallRiskScore,
      summary: `Analyzed ${ingredients.length} ingredients. Found ${highRisks} high-risk items (such as hidden sugars/oils) and ${modRisks} moderate-risk items. Follow the Label Padhega India mission to avoid deceptive food labels and ultra-processed ingredients.`
    });
  } else if (formatName === "alternatives") {
    contentStr = JSON.stringify({
      alternatives: [
        {
          productName: "Whole Grain Roasted Makhana / Millets",
          reason: "Zero palm oil, high fiber, and rich in natural antioxidants.",
          scientificJustification: "Maintains stable postprandial glucose levels and eliminates trans fats.",
          sources: ["ICMR Indian Food Composition Tables", "FSSAI Eat Right India"]
        },
        {
          productName: "Unsweetened Nut & Seed Trail Mix",
          reason: "No added sugars or artificial preservatives, high in healthy omega-3 fats.",
          scientificJustification: "Supports cardiovascular health and satiety without blood sugar spikes.",
          sources: ["WHO Healthy Diet Guidelines", "Harvard Health Publications"]
        },
        {
          productName: "Fresh Tender Coconut Water or Buttermilk (Chaas)",
          reason: "Natural electrolytes with zero artificial sweeteners or synthetic colors.",
          scientificJustification: "Promotes natural hydration and provides gut-friendly probiotic cultures.",
          sources: ["National Institute of Nutrition (NIN)", "FSSAI Traditional Foods Advisory"]
        }
      ]
    });
  } else if (lastUserMsg.toLowerCase().includes("extract all ingredients") || lastUserMsg.toLowerCase().includes("food label")) {
    contentStr = "Whole Wheat Flour, Sugar, Palm Oil, Maltodextrin, Salt, Invert Sugar Syrup, Leavening Agents (INS 503ii, INS 500ii), Emulsifier (Soy Lecithin INS 322), Nature Identical Flavoring Substances";
  } else {
    contentStr = "Welcome to IngreScan-AI! As part of the **Label Padhega India** initiative, always scrutinize ingredient lists: ingredients are listed in descending order by weight. Watch out for hidden sugars (like maltodextrin, high-fructose corn syrup) and cheap palm oils in everyday packaged foods. Feel free to ask about any specific food additive or health concern!";
  }

  return {
    id: `local-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: "local-nutrition-intelligence",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: contentStr,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 150,
      completion_tokens: 300,
      total_tokens: 450,
    },
  };
}

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;

export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

/** True when a real LLM API key is configured (the local keyword engine is a demo fallback, not a real model). */
export function isRealLLMConfigured(): boolean {
  return Boolean(getApiKey());
}

/** Local keyword engine is allowed outside production, or when explicitly enabled. */
export function isLocalFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_LLM_FALLBACK === "true";
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = getApiKey();

  // No API key: the built-in keyword engine is a demo/offline mode only. It must never
  // masquerade as real analysis in production unless explicitly opted in.
  if (!apiKey) {
    if (isLocalFallbackAllowed()) return generateFallbackResponse(params);
    throw new LLMUnavailableError("AI service is not configured. Set OPENAI_API_KEY (or the Forge API key).");
  }

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const isForge = Boolean(ENV.forgeApiKey);

  const payload: Record<string, unknown> = {
    model: isForge ? "gemini-2.5-flash" : (process.env.OPENAI_MODEL || "gpt-4o-mini"),
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload.max_tokens = 4096;
  if (isForge) {
    payload.thinking = {
      budget_tokens: 128,
    };
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  let response: Response;
  try {
    response = await fetch(resolveProvider().url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[LLM] Request failed:", error);
    throw new LLMUnavailableError("AI service is unreachable or timed out. Please try again.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[LLM] API call failed (${response.status}): ${detail.slice(0, 300)}`);
    throw new LLMUnavailableError(`AI service returned an error (${response.status}). Please try again.`);
  }

  return (await response.json()) as InvokeResult;
}
