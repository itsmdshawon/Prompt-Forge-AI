
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
    
    // THE MASTER SYSTEM PROMPT
    const systemPrompt = `You are a professional AI image prompt engineer. 

First, look at the image and decide:
A) Is this a collection/bundle of many small icons? (ICON BUNDLE MODE)
B) Is this a single scene, photograph, 3D render, or illustration? (STANDARD MODE)

FOLLOW THESE RULES STRICTLY BASED ON THE MODE:

--- ICON BUNDLE MODE ONLY ---
1. EXHAUSTIVE LISTING: Identify and describe every single icon in the set. You must mention each object clearly.
2. 10% REMIX: Create a prompt that is a near-carbon copy but changes the concept by exactly 10% for copyright safety.
3. FLAT COLORS ONLY: Use the exact colors from the image, but ensure they are described as "flat colors" or "black and white". 
4. NO GRADIENTS: Strictly forbidden. Even if the reference has them, you MUST NOT include gradients in the prompt.
5. NO TEXT: Ignore all text in the image (like "40 icon set", templates, or labels). Do not describe text.
6. ALIGNMENT: Specify that icons must be properly aligned.
7. OUTPUT: Only the prompt paragraph. No explanations.

--- STANDARD MODE ONLY ---
1. NEAR CARBON COPY: Recreate the exact image, subject, pose, and style with a 10% remix shift.
2. PRESERVE MEDIUM: If it is a 3D render, describe it as such. If it is a photo, keep it as a photo.
3. COLORS: Recreate the exact same colors and lighting used in the image.
4. LENGTH: Must be at least 3 to 4 long, detailed lines.
5. OUTPUT: Only the prompt paragraph. No explanations.

--- GLOBAL RULES ---
- No marketing words (stunning, 4k, best). 
- Use simple but descriptive English.
${model.provider === 'mistral' ? '- MISTRAL CONSTRAINT: Do not be short. Write a long, exhaustive paragraph. 1-2 lines is NOT allowed.' : ''}
${settings.customInstruction ? `- USER REQUEST: "${settings.customInstruction}"` : ''}
${activeNegativeWords.length > 0 ? `- EXCLUDE: Never use these words: ${activeNegativeWords.join(", ")}` : ''}`;

    const userPrompt = "Analyze this image. Determine the mode (Icon Bundle or Standard) and follow the specific rules for that mode to write a single long paragraph prompt.";

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
