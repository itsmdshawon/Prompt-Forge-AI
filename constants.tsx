import React from 'react';
import { Model, Settings } from './types';

export const INITIAL_MODELS: Model[] = [
  // Google Gemini models (Vision Capable)
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (High Quality)', provider: 'gemini', hasVision: true },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Latest)', provider: 'gemini', hasVision: true },
  { id: 'gemini-flash-latest', name: 'Gemini 2.5 Flash (Standard)', provider: 'gemini', hasVision: true },
  { id: 'gemini-flash-lite-latest', name: 'Gemini 2.5 Flash (Lite)', provider: 'gemini', hasVision: true },
  
  // Groq Cloud models (ONLY Vision-capable models as per latest documentation)
  // These are the new multimodal Llama 4 preview models.
  { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B Vision', provider: 'groq', hasVision: true },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B Vision', provider: 'groq', hasVision: true },
  
  // Mistral AI models (Vision Capable)
  { id: 'pixtral-12b-vision', name: 'Pixtral 12B Vision (Standard)', provider: 'mistral', hasVision: true },
];

export const DEFAULT_SETTINGS: Settings = {
  apiKeys: {
    gemini: [],
    groq: [],
    mistral: [],
  },
  preferredModel: 'gemini-3-flash-preview',
  customInstruction: '',
  prefixes: [],
  suffixes: [],
  negativeWords: [],
  prefixCount: 1,
  suffixCount: 1,
  negativeWordCount: 1,
  theme: 'dark',
};

export const LOGO_SVG = (
  <svg viewBox="0 0 100 100" className="w-8 h-8 mr-3" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" rx="20" fill="url(#grad1)" />
    <path d="M35 25V75H48V55H60C70 55 75 50 75 40C75 30 70 25 60 25H35ZM48 35H60C64 35 66 37 66 40C66 43 64 45 60 45H48V35Z" fill="white" />
    <defs>
      <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#8B5CF6', stopOpacity: 1 }} />
        <stop offset="100%" style={{ stopColor: '#D946EF', stopOpacity: 1 }} />
      </linearGradient>
    </defs>
  </svg>
);
