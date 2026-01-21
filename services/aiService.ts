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
    // Check if we have standard env key for gemini
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
        // If this is not the first attempt in this loop, we just switched keys
        if (attempts > 0 && onKeySwitch) {
          onKeySwitch();
        }
        
        const result = await this.retryTask(task, currentKey, provider);
        // Successful call! Update the index so next call starts here or with this key's context
        keyIndices[provider] = currentIndex; 
        return result;
      } catch (error: any) {
        lastError = error.message;
        const errLower = lastError.toLowerCase();
        
        // Only rotate keys if the error is related to limits or quotas
        const isLimitError = errLower.includes("limit") || 
                             errLower.includes("quota") || 
                             errLower.includes("429") || 
                             errLower.includes("exhausted") ||
                             errLower.includes("timeout");

        if (isLimitError) {
          attempts++;
        } else {
          // Terminal or logic error, don't rotate, just throw
          throw error;
        }
      }
    }

    // If we reach here, all keys in the pool failed with limit errors
    throw new Error(`ALL_KEYS_EXHAUSTED_${provider.toUpperCase()}`);
  }

  private static async retryTask(task: (key: string) => Promise<any>, key: string, provider: Provider, retries = 2): Promise<any> {
    try {
      return await task(key);
    } catch (e: any) {
      const err = (e.message || "").toLowerCase();
      
      // Stop retrying on terminal errors
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

    // Wrap the SDK call in a promise race to handle timeouts for stability
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), 40000)
    );

    const generatePromise = (async () => {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: { parts },
        config: { 
          systemInstruction, 
          temperature: 0.3, // Optimized lower temperature for faster, more deterministic token generation
          topP: 0.8,       // Slightly tighter topP for speed
          topK: 40         // Standard optimized topK
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
          temperature: 0.15,
          max_tokens: 1500,
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
    const systemPrompt = `You are a professional AI image prompt engineer. Your mission is to create a prompt that is a "near carbon copy" of the provided image but with a small (~10%) safe variation for microstock compliance.

STRICT RULES:
1. PRESERVE IMAGE TYPE: You MUST identify and maintain the original medium. If vector, stay vector. If photo, stay photo. If 3D render, stay 3D. If silhouette, stay silhouette. Never cross mediums.
2. NEAR CARBON COPY + 10% VARIATION: The prompt must be extremely accurate to the subject, pose, position, shapes, colors, background, lighting, and mood. Add only a tiny (~10%) variation in styling or phrasing to ensure it isn't an exact duplicate.
3. PROMPT LENGTH: Every prompt MUST be at least 3 to 4 full lines long. If the image is complex, write it as long as necessary to capture all details. Do not summarize or use short prompts.
4. SIMPLE ENGLISH: Use simple English that a 10-year-old can understand. Keep it clean and readable.
5. NO MARKETING LANGUAGE: Avoid phrases like "best for", "perfect for", "ideal for", or promotional adjectives like "stunning", "masterpiece", "high-quality", "4k".
6. NO SPECIAL SYMBOLS: Avoid unnecessary symbols, brackets, or weird punctuation.
7. READY-TO-USE: Output the prompt immediately as a cohesive paragraph. No meta-phrases like "The image shows...". It must be a direct instruction for an AI generator.
8. COMPLETE DETAILS: Include subject, pose/position, shapes/forms, colors, background, style, lighting, and mood.
${settings.customInstruction ? `9. CUSTOM GUIDANCE: Incorporate the user's request while maintaining the above rules: "${settings.customInstruction}"` : ''}
${activeNegativeWords.length > 0 ? `10. FORBIDDEN WORDS: NEVER use: ${activeNegativeWords.join(", ")}` : ''}`;

    const userPrompt = "Analyze this image and generate a highly detailed, 3-4+ line near-carbon-copy prompt with 10% safe variation in simple English.";

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
