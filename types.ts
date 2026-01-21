
export type Provider = 'gemini' | 'groq' | 'mistral';

export interface Model {
  id: string;
  name: string;
  provider: Provider;
  hasVision: boolean;
}

export interface PromptForgeImage {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  prompt?: string;
  resolution?: string;
  error?: string;
}

export interface Settings {
  apiKeys: {
    gemini: string[];
    groq: string[];
    mistral: string[];
  };
  preferredModel: string;
  customInstruction: string;
  prefixes: string[];
  suffixes: string[];
  negativeWords: string[];
  prefixCount: number;
  suffixCount: number;
  negativeWordCount: number;
  theme: 'dark' | 'light';
}

export interface CommunityLink {
  label: string;
  value: string;
  url?: string;
}
