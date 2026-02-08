
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
        const errLower = error.message.toLowerCase();
        const isLimitError = errLower.includes("limit") || 
                             errLower.includes("quota") || 
                             errLower.includes("429") || 
                             errLower.includes("exhausted");

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
      if (err.includes("401") || err.includes("403") || err.includes("invalid_api_key")) {
        throw e;
      }
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 500));
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

    const response = await ai.models.generateContent({
      model: modelId,
      contents: { parts },
      config: { 
        systemInstruction, 
        temperature: 0.1,
        topP: 0.8
      }
    });

    return response.text || "";
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

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: actualModelId,
        messages,
        temperature: 0.1,
        max_tokens: 2500,
        stream: false
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `API Error ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
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
    
    // THE MASTER SYSTEM PROMPT - REFINED VERSION
    const systemPrompt = `You are a professional AI image prompt engineer. 

First, analyze the image and internalize the mode:
A) ICON BUNDLE: A collection of many small icons.
B) STANDARD: A single scene, photo, render, or illustration.

FOLLOW THESE RULES STRICTLY:

--- ICON BUNDLE RULES ---
1. EXHAUSTIVE LISTING: Identify every icon in the set. Describe each one clearly.
2. 10% REMIX: Create a prompt that is nearly identical but shifts the concept by 10%.
3. CONCEPT DE-DUPLICATION: If the reference image has repeating or duplicate icons (e.g., the same pill or same shield twice), you MUST replace the duplicates with new, unique icons that fit the theme. Every icon mentioned in the prompt must be a unique concept.
4. FLAT COLORS ONLY: Describe as "flat colors" or "black and white".
5. NO GRADIENTS: Strictly forbidden.
6. NO TEXT: Ignore and never mention text labels or set titles (like "40 icon set").
7. ALIGNMENT: Specify that icons are properly aligned.

--- STANDARD MODE RULES ---
1. NEAR CARBON COPY: Recreate the exact image, subject, pose, and style with a 10% remix shift.
2. PRESERVE MEDIUM: Maintain the exact medium (3D render, photo, illustration, etc.).
3. COLORS: Recreate the exact same colors and lighting.
4. LENGTH: Must be at least 3 to 4 long, detailed lines.

--- CRITICAL OUTPUT RULES (MANDATORY) ---
1. NO LABELS: NEVER include headers like "ICON BUNDLE MODE" or "STANDARD MODE". Start the prompt text immediately.
2. NO MARKDOWN: NEVER use asterisks (*), bolding, hashtags, or any special markdown characters.
3. ALLOWED SYMBOLS: ONLY use letters, numbers, spaces, commas (,), full stops (.), and apostrophes ('). DELETE all other symbols.
4. ABSOLUTELY NO ASTERISKS: Do not use * for any reason.
5. NO MARKETING: Avoid "stunning", "4k", or "best".
6. NO EXPLANATIONS: Provide ONLY the prompt paragraph. Nothing before or after.
${model.provider === 'mistral' ? '- MISTRAL CONSTRAINT: You must write a long, exhaustive paragraph. Do not provide a short 1-2 line output.' : ''}
${settings.customInstruction ? `- USER REQUEST: "${settings.customInstruction}"` : ''}
${activeNegativeWords.length > 0 ? `- EXCLUDE: Never use these words: ${activeNegativeWords.join(", ")}` : ''}`;

    const userPrompt = "Generate the final prompt for this image. Output only the prompt paragraph. No labels, no headers, no asterisks, no special symbols except commas, full stops, and apostrophes.";

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
