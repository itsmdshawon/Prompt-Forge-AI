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
        const errLower = (error.message || "").toLowerCase();
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
    
    // THE ABSOLUTE MASTER SYSTEM PROMPT - ZERO CREATIVITY MODE
    const systemPrompt = `You are a professional AI image prompt engineer. Your goal is to recreate the reference image with 100% LITERAL ACCURACY. 

### CRITICAL RULES (VIOLATION IS NOT AN OPTION):

1. **STARTING WORD**: You MUST always start with "Create".
2. **STYLE MATCHING (STRICT)**:
   - **SILHOUETTE**: If the image is a silhouette, describe it as a "solid flat black silhouette". NEVER use words like "line art", "outline", "sketched", or "drawing". A silhouette is a SOLID SHAPE.
   - **VECTOR**: If the image is a vector, keep it a "flat 2D vector". 
   - **NO TEXTURES**: On silhouettes/vectors, NEVER add "skin details", "realism", "lighting", "shading", "highlights", or "textures".
3. **SUBJECT INTEGRITY (IDENTITY LOCK)**:
   - **NO MORPHING**: Do not merge subjects. An eagle head on a woman is FORBIDDEN. If it is a woman, describe a woman. If it is an eagle, describe a single-headed eagle.
   - **GENDER LOCK**: A woman must remain a woman. 
   - **ANATOMY LOCK**: One head per creature. No extra limbs or strange merge-points.
4. **NO HALLUCINATIONS**:
   - DO NOT add "cutting lines", "measurement marks", "geometric grids", or "dissection lines".
   - DO NOT use the word "10%", "remix", or any percentage in the prompt.
5. **LENGTH WITHOUT FAKE DETAIL**:
   - Provide 5+ lines of text. 
   - Reach this length by describing the SHAPE, the POSES, the ORIENTATION, the BORDERS, and the NEGATIVE SPACE. Describe the SIMPLE style in detail rather than adding complex elements.
6. **FORMAT**:
   - Plain ASCII only. No markdown (*, #, etc). No promotional words ("stunning", "4k").

### STYLE BOUNDARY EXAMPLES:
- REFERENCE = Solid Black Woman Silhouette -> PROMPT = "Create a solid flat black silhouette of a woman. The shape is perfectly filled with black ink, featuring sharp and clean edges..."
- REFERENCE = Eagle -> PROMPT = "Create a single eagle with one head. The subject is a real bird..."
- NEVER describe a silhouette as "line art". A silhouette has NO lines, only solid fill.`;

    const userPrompt = `Generate the prompt now. 
- Start with "Create".
- LITERAL RECREATION: If it is a silhouette, call it a "solid flat black silhouette". 
- NO LINE ART: Do not turn solid shapes into outlines.
- IDENTITY LOCK: Woman stays woman. Eagle stays eagle. No merging. No extra heads.
- NO ODD STUFF: No "10%", no cutting lines.
- ASCII only, 5+ lines.`;

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