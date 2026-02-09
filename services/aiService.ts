
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
    
    // THE MASTER SYSTEM PROMPT - RIGID RECREATION COMMAND
    const systemPrompt = `You are a professional AI image prompt engineer. Your task is to analyze a reference image and create a prompt for an AI generator to recreate it with 90% accuracy and 10% creative variation.

FOLLOW THESE RULES RIGIDLY FOR ALL MODELS:

--- MANDATORY START ---
1. YOU MUST ALWAYS START THE PROMPT WITH THE WORD "Create".
2. NO META-LANGUAGE: NEVER use phrases like "The image is", "This graphic shows", "An illustration of", "A photograph of", or "This image features".
3. Write the response as a direct command for an AI image generator.

--- CATEGORY & MEDIUM INTEGRITY ---
1. IDENTIFY MEDIUM: Determine if the image is a Vector (Flat), 3D Render, Photography, Illustration, or PNG icon. 
2. NO MIXING: Do not treat vectors as photos, or photos as 3D renders. Use specific terms: "Vector illustration", "Realistic photography", "3D render", "Hand-drawn sketch".
3. COMPLEXITY MATCHING: If the reference is simple, the prompt must be simple. If the reference is complex, the prompt must be complex.

--- COLOR ACCURACY (CRITICAL) ---
1. STRICT PALETTE: Only mention colors visible in the image.
2. NO COLOR HALLUCINATION: If the image is black and white, describe it only as "black and white". NEVER add color (gold, neon, vibrant tones) to a monochrome image.
3. PRESERVE COLOR: If the image is in color, describe the exact palette. Do not convert color to black and white.

--- DESCRIPTIVE DEPTH ---
1. EXHAUSTIVE DESCRIPTION: Describe every visible part: subject, composition, line thickness, curves, framing, and background. 
2. LENGTH: The output MUST be a long paragraph of at least 5 lines. Even for simple images, use descriptive language for the shapes and layout to reach the length.
3. ICON BUNDLES: For grids of icons, identify every unique item. Replace duplicates with new unique concepts that fit the same theme.

--- GLOBAL OUTPUT CONSTRAINTS ---
1. NO MARKDOWN: No asterisks (*), bolding, or hashtags.
2. ASCII PUNCTUATION ONLY: 
   - Use ONLY standard ASCII. 
   - Use ONLY the standard straight apostrophe (') - NEVER smart/curly ones (’).
3. NO MARKETING: Do not use words like "stunning", "4k", "amazing", or "hyper-realistic".

${settings.customInstruction ? `- USER REQUEST: "${settings.customInstruction}"` : ''}
${activeNegativeWords.length > 0 ? `- EXCLUDE: Never use: ${activeNegativeWords.join(", ")}` : ''}`;

    const userPrompt = `Write the final prompt now. It MUST start with "Create". 
It MUST be a long descriptive paragraph (at least 5 lines). 
Stay within the same style and concept (90% match, 10% variation).
Describe exactly what is visible. If it is black and white, say so; do not add colors. 
Use only standard ASCII and straight apostrophes. No labels or special symbols.`;

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
