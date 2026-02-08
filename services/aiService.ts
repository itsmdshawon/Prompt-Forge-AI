
import { GoogleGenAI } from "@google/genai";
import { Provider, Model, PromptForgeImage, Settings } from '../types.ts';

/**
 * Optimized Image Processor
 */
const prepareImage = (file: File, maxDim: number = 1024): Promise<{data: string, mime: string}> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FILE_READ_ERROR"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("IMAGE_LOAD_ERROR"));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({
          data: dataUrl.split(',')[1],
          mime: 'image/jpeg'
        });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

const keyIndices: Record<Provider, number> = {
  gemini: 0,
  groq: 0,
  mistral: 0
};

export class AIService {
  private static async executeWithRotation(
    provider: Provider,
    keys: string[],
    task: (apiKey: string) => Promise<any>,
    onKeySwitch?: () => void
  ): Promise<any> {
    const hasEnvKey = provider === 'gemini' && typeof process !== 'undefined' && process.env.API_KEY;
    
    if (!keys || keys.length === 0) {
      if (hasEnvKey) {
        return await this.retryTask(task, process.env.API_KEY!, provider);
      }
      throw new Error(`MISSING_KEYS_${provider.toUpperCase()}`);
    }

    const startIndex = keyIndices[provider];
    let attempts = 0;
    let lastError = "";

    while (attempts < keys.length) {
      const currentIndex = (startIndex + attempts) % keys.length;
      const currentKey = keys[currentIndex].trim();
      
      if (!currentKey) {
        attempts++;
        continue;
      }

      try {
        if (attempts > 0 && onKeySwitch) {
          onKeySwitch();
        }
        
        const result = await this.retryTask(task, currentKey, provider);
        keyIndices[provider] = currentIndex; 
        return result;
      } catch (error: any) {
        lastError = error.message;
        const errLower = lastError.toLowerCase();
        const isLimitError = errLower.includes("limit") || 
                             errLower.includes("quota") || 
                             errLower.includes("429") || 
                             errLower.includes("exhausted") ||
                             errLower.includes("timeout");

        if (isLimitError) {
          attempts++;
        } else {
          throw error;
        }
      }
    }
    throw new Error(`ALL_KEYS_EXHAUSTED_${provider.toUpperCase()}`);
  }

  private static async retryTask(task: (key: string) => Promise<any>, key: string, provider: Provider, retries = 2): Promise<any> {
    try {
      return await task(key);
    } catch (e: any) {
      const err = (e.message || "").toLowerCase();
      if (err.includes("401") || err.includes("403") || err.includes("invalid_api_key") || err.includes("does not exist")) {
        throw e;
      }
      if (retries > 0) {
        const delay = (3 - retries) * 500;
        await new Promise(r => setTimeout(r, delay));
        return this.retryTask(task, key, provider, retries - 1);
      }
      throw e;
    }
  }

  private static async geminiGenerate(
    apiKey: string,
    modelId: string, 
    prompt: string, 
    base64Data?: string,
    mimeType?: string,
    systemInstruction?: string
  ) {
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [{ text: prompt }];
    if (base64Data && mimeType) {
      parts.unshift({
        inlineData: { mimeType, data: base64Data }
      });
    }

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), 40000)
    );

    const generatePromise = (async () => {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: { parts },
        config: { 
          systemInstruction, 
          temperature: 0.15, // Lowered temperature for tighter logic adherence
          topP: 0.8,
          topK: 40
        }
      });

      const text = response.text || "";
      if (!text.trim()) throw new Error("EMPTY_GEMINI_RESPONSE");
      return text;
    })();

    return await Promise.race([generatePromise, timeoutPromise]) as string;
  }

  private static async providerGenerate(
    provider: Provider,
    apiKey: string,
    modelId: string,
    prompt: string,
    base64Data?: string,
    mimeType?: string,
    systemInstruction?: string
  ) {
    const baseUrl = provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.mistral.ai/v1';
    let actualModelId = modelId;
    if (provider === 'mistral' && modelId === 'pixtral-12b-vision') {
      actualModelId = 'pixtral-12b-2409';
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    if (base64Data && mimeType) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: actualModelId,
          messages,
          temperature: 0.1, // Near zero temperature for strict instruction following
          max_tokens: 2000,
          stream: false
        }),
        signal: controller.signal
      });
      
      clearTimeout(id);

      if (!response.ok) {
        const errText = await response.text();
        let errorData;
        try { errorData = JSON.parse(errText); } catch(e) { errorData = { error: { message: errText } }; }
        const message = errorData.error?.message || `API Error ${response.status}`;
        throw new Error(message);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) throw new Error("EMPTY_PROVIDER_RESPONSE");
      return content;
    } catch (e: any) {
      clearTimeout(id);
      throw e;
    }
  }

  public static async generatePromptFromImage(
    image: PromptForgeImage,
    settings: Settings,
    model: Model,
    onKeySwitch?: () => void
  ) {
    if (!model.hasVision) throw new Error("NON_VISION_MODEL");
    const { data, mime } = await prepareImage(image.file, 1024);

    const activeNegativeWords = settings.negativeWords.slice(0, settings.negativeWordCount);
    
    const systemPrompt = `You are a professional AI image prompt engineer. First, classify if the provided image is a collection/bundle of multiple icons (icon set/bundle) or a standard single image.

IF THE IMAGE IS AN ICON BUNDLE:
1. EXHAUSTIVE DESCRIPTION: Identify and list EVERY single icon visible in the image. Do not miss any.
2. 10% REMIX: Create a near-carbon-copy prompt but remix/change the concept by about 10% for copyright safety.
3. COLOR RULES: Use the exact colors from the image but ONLY flat colors or black and white. 
4. NO GRADIENTS: Never include gradients in the prompt, even if the reference image has them.
5. NO TEXT: Do not include any text from the icons or templates (e.g., "40 icon set", niche names, sidebars). Focus only on the icons.
6. ISOLATED: You MUST include the phrase "Isolated on white background" in the prompt.
7. STYLE: Keep descriptions simple, clean, and properly aligned. 
8. FORMAT: Output only the prompt as a long, detailed paragraph. No explanations.

IF THE IMAGE IS A REGULAR SINGLE IMAGE (NOT AN ICON BUNDLE):
1. NEAR CARBON COPY + 10% VARIATION: Extreme accuracy to subject, pose, colors, and mood with a 10% stylistic shift.
2. PRESERVE MEDIUM: Stay photo if photo, vector if vector, etc.
3. PROMPT LENGTH: Must be at least 3 to 4 full lines. 
4. READY-TO-USE: Output as a direct cohesive paragraph.

GLOBAL RULES (APPLIES TO ALL):
- Use simple English.
- No marketing/promotional language (e.g., "stunning", "4k", "best for").
- No special symbols.
- ${model.provider === 'mistral' ? 'MISTRAL CONSTRAINT: You are known for being too brief. YOU MUST BE EXHAUSTIVE. Write a long, detailed paragraph. Do not finish in 1-2 lines.' : ''}
${settings.customInstruction ? `- CUSTOM GUIDANCE: "${settings.customInstruction}"` : ''}
${activeNegativeWords.length > 0 ? `- FORBIDDEN WORDS: NEVER use: ${activeNegativeWords.join(", ")}` : ''}`;

    const userPrompt = "Analyze this image. If it is an icon bundle, follow the Icon Bundle Protocol and describe every icon in detail. If it is a regular image, follow the Standard Protocol. Output only the prompt paragraph.";

    return await this.executeWithRotation(
      model.provider, 
      settings.apiKeys[model.provider], 
      async (key) => {
        if (model.provider === 'gemini') {
          return await this.geminiGenerate(key, model.id, userPrompt, data, mime, systemPrompt);
        } else {
          return await this.providerGenerate(model.provider, key, model.id, userPrompt, data, mime, systemPrompt);
        }
      },
      onKeySwitch
    );
  }
}
