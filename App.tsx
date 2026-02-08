
import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  Download, 
  Settings as SettingsIcon, 
  RotateCcw, 
  MessageSquare, 
  Share2, 
  ChevronDown, 
  X, 
  Check, 
  AlertCircle,
  ExternalLink,
  Sparkles,
  Layers,
  Youtube,
  Users,
  User,
  ArrowRight,
  Mail,
  Phone,
  ImagePlus,
  Loader2,
  FileCheck,
  Trophy,
  Play,
  Ban,
  ChevronUp
} from 'lucide-react';
import { 
  PromptForgeImage, 
  Settings, 
  Model, 
  Provider
} from './types.ts';
import { 
  INITIAL_MODELS, 
  DEFAULT_SETTINGS, 
  LOGO_SVG 
} from './constants.tsx';
import { AIService } from './services/aiService.ts';

export default function App() {
  // --- State ---
  const [images, setImages] = useState<PromptForgeImage[]>([]);
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('prompt_forge_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.apiKeys.gemini === 'string') parsed.apiKeys.gemini = parsed.apiKeys.gemini ? [parsed.apiKeys.gemini] : [];
      if (typeof parsed.apiKeys.groq === 'string') parsed.apiKeys.groq = parsed.apiKeys.groq ? [parsed.apiKeys.groq] : [];
      if (typeof parsed.apiKeys.mistral === 'string') parsed.apiKeys.mistral = parsed.apiKeys.mistral ? [parsed.apiKeys.mistral] : [];
      if (!parsed.negativeWords) parsed.negativeWords = [];
      if (typeof parsed.negativeWordCount !== 'number') parsed.negativeWordCount = 0;
      return parsed;
    }
    return DEFAULT_SETTINGS;
  });

  const settingsRef = useRef<Settings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [models, setModels] = useState<Model[]>(INITIAL_MODELS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState(0);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [activeModal, setActiveModal] = useState<'hub' | 'settings' | 'privacy' | 'terms' | 'faq' | 'contact' | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [usageLimitError, setUsageLimitError] = useState<{ modelId: string; provider: Provider } | null>(null);
  const [lastFailedProvider, setLastFailedProvider] = useState<Provider | null>(null);
  
  const [geminiInput, setGeminiInput] = useState('');
  const [groqInput, setGroqInput] = useState('');
  const [mistralInput, setMistralInput] = useState('');

  const [isDragging, setIsDragging] = useState(false);
  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Wake Lock for background persistence ---
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (isGenerating && document.visibilityState === 'visible') {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
           try {
             wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
           } catch (e) {}
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isGenerating]);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator && (navigator as any).wakeLock) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {}
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  const faqData = [
    { q: "What is Prompt Forge?", a: "Prompt Forge is a tool that helps you turn images into clear, ready-to-use prompts. You can use these prompts with AI image generators to create new images easily." },
    { q: "How does Prompt Forge work?", a: "You upload one or more images. The tool looks at the images and creates full prompts based on what it sees. You can then copy and use those prompts anywhere you like." },
    { q: "Which AI models does Prompt Forge support?", a: "Prompt Forge works with multiple AI models from Gemini, Groq, and Mistral. You can choose the model you prefer before generating prompts." },
    { q: "Do I need my own API keys?", a: "Yes. You need to add your own API keys in the settings so the models can work properly." },
    { q: "Can I upload multiple images at once?", a: "Yes. You can upload many images together using drag and drop or the Add Images button." },
    { q: "What are Add to Start and Add to End?", a: "These options let you add text at the beginning or end of every generated prompt. This helps keep your prompts consistent." },
    { q: "What are Negative Words?", a: "Negative Words let you block specific words so they never appear in any generated prompt, no matter which model you use." },
    { q: "Is my data safe?", a: "Your images are used only to generate results for you. Prompt Forge does not take ownership of your content." },
    { q: "Can I clear all data?", a: "Yes. The Clear Data option removes uploaded images and generated prompts so you can start fresh." },
    { q: "What should I do if something does not work?", a: "First, check your API keys and settings. If the problem continues, try refreshing the page or reloading the tool." }
  ];

  useEffect(() => {
    setModels(INITIAL_MODELS);
    const preventDefault = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const saveSettings = () => {
    localStorage.setItem('prompt_forge_settings', JSON.stringify(settings));
    showNotification("Settings saved.");
  };

  const getFullPrompt = (rawPrompt: string | undefined, currentSettings: Settings) => {
    if (!rawPrompt) return "";
    
    // Clean raw prompt of any asterisks and multiple spaces
    let processedPrompt = rawPrompt.replace(/\*/g, '').trim();
    
    const activePrefixes = currentSettings.prefixes.slice(0, currentSettings.prefixCount).join(' ');
    const activeSuffixes = currentSettings.suffixes.slice(0, currentSettings.suffixCount).join(' ');
    
    const activeNegativeWords = currentSettings.negativeWords.slice(0, currentSettings.negativeWordCount);
    activeNegativeWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      processedPrompt = processedPrompt.replace(regex, '');
    });

    return `${activePrefixes} ${processedPrompt} ${activeSuffixes}`.trim().replace(/\s+/g, ' ');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.type === 'drop') {
      setIsDragging(false);
    }

    let files: File[] = [];
    if (e.type === 'drop' && 'dataTransfer' in e && e.dataTransfer) {
      files = Array.from(e.dataTransfer.files);
    } else if (e.target instanceof HTMLInputElement && e.target.files) {
      files = Array.from(e.target.files);
    }

    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    
    if (fileInputRef.current) fileInputRef.current.value = '';

    const newImages: PromptForgeImage[] = imageFiles.map((file: File) => ({
      id: Math.random().toString(36).substring(2, 11) + Date.now(),
      file,
      previewUrl: URL.createObjectURL(file), 
      status: 'pending',
    }));

    setImages(prev => [...prev, ...newImages]);
  };

  const clearImages = () => {
    images.forEach(img => {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    });
    setImages([]);
    setGenerationProgress(0);
    setCurrentProcessingIndex(0);
    setIsGenerating(false);
    setIsPaused(false);
    setUsageLimitError(null);
    setLastFailedProvider(null);
    releaseWakeLock();
    showNotification("All data cleared.", "success");
  };

  const generatePrompts = async () => {
    if (images.length === 0) return showNotification("Please upload an image first.", "error");
    
    const currentSettings = settingsRef.current;
    const activeModel = models.find(m => m.id === currentSettings.preferredModel) || models[0];
    const keys = currentSettings.apiKeys[activeModel.provider];

    const envKey = typeof process !== 'undefined' ? process.env.API_KEY : undefined;
    if (keys.length === 0 && !(activeModel.provider === 'gemini' && envKey)) {
      return showNotification(`Please add at least one API key for ${activeModel.provider} in settings.`, "error");
    }

    await requestWakeLock();
    setIsGenerating(true);
    setIsPaused(false);
    setUsageLimitError(null);

    for (let i = currentProcessingIndex; i < images.length; i++) {
      const currentImg = images[i];
      if (currentImg.status === 'completed') continue;

      const targetId = currentImg.id;
      try {
        setImages(prev => prev.map(img => img.id === targetId ? { ...img, status: 'processing' } : img));
        
        const rawResult = await AIService.generatePromptFromImage(
          currentImg, 
          settingsRef.current, 
          activeModel,
          () => showNotification(`Switching to next API key for ${activeModel.provider}...`, 'warning')
        );

        if (!rawResult || !rawResult.trim()) throw new Error("Model returned no text data.");
        
        setImages(prev => prev.map(img => img.id === targetId ? { ...img, status: 'completed', prompt: rawResult } : img));
        setCurrentProcessingIndex(i + 1);
        setGenerationProgress(((i + 1) / images.length) * 100);
      } catch (error: any) {
        console.error("Generation failed for image:", targetId, error);
        
        if (error.message.includes('ALL_KEYS_EXHAUSTED')) {
          setUsageLimitError({ modelId: activeModel.name, provider: activeModel.provider });
          setLastFailedProvider(activeModel.provider);
          setIsGenerating(false);
          setIsPaused(true);
          showNotification(`Usage limit reached for ${activeModel.provider}. Please switch provider.`, 'error');
          releaseWakeLock();
          return;
        }

        setImages(prev => prev.map(img => img.id === targetId ? { ...img, status: 'error', error: error.message } : img));
        setCurrentProcessingIndex(i + 1);
        setGenerationProgress(((i + 1) / images.length) * 100);
      }
    }
    
    setIsGenerating(false);
    setIsPaused(false);
    setLastFailedProvider(null);
    releaseWakeLock();
  };

  const exportCSV = () => {
    const completedList = images.filter(img => img.status === 'completed' && img.prompt);
    if (completedList.length === 0) {
      showNotification("No completed prompts to export.", "warning");
      return;
    }

    const header = "SL No.,Prompt\r\n";
    const rows = completedList.map((img, i) => {
      const finalPrompt = getFullPrompt(img.prompt, settingsRef.current);
      // Ensure no asterisks, no quotes, and no extra words are present
      const promptText = finalPrompt
        .replace(/\*/g, '')
        .replace(/"/g, '""')
        .replace(/\n/g, ' ')
        .trim();
      return `${i + 1},"${promptText}"`;
    }).join('\r\n');

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt_forge_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showNotification("CSV downloaded successfully!");
  };

  const handleAddKey = (provider: Provider, key: string) => {
    if (!key.trim()) return;
    setSettings(prev => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: [...prev.apiKeys[provider], key.trim()] }
    }));
    if (provider === 'gemini') setGeminiInput('');
    else if (provider === 'groq') setGroqInput('');
    else if (provider === 'mistral') setMistralInput('');
  };

  const handleDeleteKey = (provider: Provider, index: number) => {
    setSettings(prev => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: prev.apiKeys[provider].filter((_, i) => i !== index) }
    }));
  };

  const activeModel = models.find(m => m.id === settings.preferredModel) || models[0];
  const hasImages = images.length > 0;
  const allFinished = hasImages && images.every(img => img.status === 'completed' || img.status === 'error');
  const hasSuccessfulPrompts = images.some(img => img.status === 'completed');
  const hasErrorPrompts = images.some(img => img.status === 'error');

  const isResuming = isPaused && currentProcessingIndex > 0;
  const showRecreate = isResuming && activeModel.provider !== lastFailedProvider;
  const mainButtonLabel = isResuming ? (showRecreate ? 'Recreate' : 'Resume Processing') : 'Start Creating';

  return (
    <div className={`min-h-screen transition-colors duration-300 ${settings.theme === 'light' ? 'bg-slate-50 text-slate-900' : 'bg-[#020617] text-slate-200'}`}>
      <div className="fixed inset-0 pointer-events-none gradient-bg -z-10" />

      <header className="sticky top-0 z-40 backdrop-blur-xl border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center group cursor-default">
            <div className="transform group-hover:scale-110 transition-transform duration-500">{LOGO_SVG}</div>
            <div>
              <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-white">
                Prompt <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400">Forge</span>
              </h1>
              <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-bold">Make Better Prompts For Real Result</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button onClick={() => setActiveModal('settings')} className={`px-5 py-2.5 rounded-full transition-all border group flex items-center text-sm font-bold ${activeModal === 'settings' ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' : 'glass-card hover:bg-white/10 text-slate-200 border-white/10'}`}>
              <SettingsIcon size={20} className="mr-2 group-hover:rotate-45 transition-transform" /> Settings
            </button>
            <button onClick={() => setActiveModal(activeModal === 'hub' ? null : 'hub')} className={`hidden sm:flex px-5 py-2.5 rounded-full transition-all text-sm font-bold border ${activeModal === 'hub' ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 shadow-[0_0_20px_rgba(139,92,246,0.15)]' : 'glass-card hover:bg-white/10 text-slate-200 border-white/10'}`}>
              <Share2 size={16} className={`mr-2 transition-transform duration-300 ${activeModal === 'hub' ? 'scale-110' : ''}`} /> Community
            </button>
            <button onClick={() => setActiveModal(activeModal === 'contact' ? null : 'contact')} className={`hidden sm:flex px-5 py-2.5 rounded-full transition-all text-sm font-bold border ${activeModal === 'contact' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)]' : 'glass-card hover:bg-white/10 text-slate-200 border-white/10'}`}>Contact</button>
          </div>
        </div>
      </header>

      {usageLimitError && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-3 text-center animate-in slide-in-from-top duration-300">
          <p className="text-amber-300 text-sm font-semibold flex items-center justify-center">
            <AlertCircle size={16} className="mr-2" /> Limit reached for {usageLimitError.provider} pool. Please switch your AI model in settings to continue.
            <button onClick={() => setActiveModal('settings')} className="ml-4 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 rounded-full text-xs transition-all font-bold">Open Settings</button>
          </p>
        </div>
      )}

      {notification && (
        <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-2xl shadow-2xl flex items-center border backdrop-blur-md animate-in slide-in-from-bottom-8 fade-in duration-500 ${notification.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : notification.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
          {notification.type === 'success' ? <Check size={18} className="mr-3" /> : <AlertCircle size={18} className="mr-3" />}
          <span className="font-semibold text-sm">{notification.message}</span>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-12 lg:py-20 space-y-24">
        <section className="space-y-10">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight leading-[1.1] text-white text-balance">Turn your images into <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">amazing prompts</span></h2>
            <p className="text-slate-400 text-lg lg:text-xl font-medium leading-relaxed text-balance">Upload your photos and our AI will create great prompts for you.</p>
          </div>

          <div 
            className={`relative group p-16 lg:p-24 border-2 border-dashed rounded-[2.5rem] text-center glass-card transition-all duration-500 cursor-pointer overflow-hidden premium-shadow ${isDragging ? 'border-violet-400 bg-violet-500/10 scale-[1.01] shadow-[0_0_50px_rgba(139,92,246,0.2)]' : 'border-white/10 hover:border-violet-500/40'}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
            onDrop={handleFileUpload}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <input ref={fileInputRef} type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileUpload} accept="image/png, image/jpeg, image/jpg" />
            <div className={`relative z-10 space-y-6 transition-all duration-500 ${isDragging ? 'scale-95 blur-[1px] opacity-60' : 'scale-100'}`}>
              <div className="w-24 h-24 bg-gradient-to-tr from-violet-600/20 to-fuchsia-600/20 border border-white/10 rounded-3xl flex items-center justify-center mx-auto group-hover:scale-110 group-hover:rotate-3 transition-all duration-500"><Plus size={48} className="text-violet-400" /></div>
              <div className="space-y-2">
                <p className="text-2xl font-bold text-white tracking-tight">Drop your images here</p>
                <p className="text-slate-500 font-medium text-balance px-4">Drag files here or click Add Images to begin (Jpg, Jpeg & Png)</p>
              </div>
            </div>
          </div>

          {hasImages && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex justify-center">
              <div className={`glass-card px-8 py-6 rounded-[2rem] flex items-center gap-4 premium-shadow border-emerald-500/20 bg-emerald-500/5`}>
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-emerald-500/10 text-emerald-400`}>{allFinished ? <FileCheck size={24} /> : (isGenerating ? <Loader2 size={24} className="animate-spin" /> : <FileCheck size={24} />)}</div>
                <div>
                  <p className="text-lg font-black text-white tracking-tight">{isPaused ? `Paused at ${currentProcessingIndex}/${images.length}` : (allFinished ? `Processing sequence finished` : `${images.length} images in workspace`)}</p>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{allFinished ? (hasSuccessfulPrompts ? 'Batch successful' : 'Batch errors detected') : 'Ready to forge or add more'}</p>
                </div>
                {!isGenerating && (
                  <button onClick={(e) => { e.stopPropagation(); clearImages(); }} className="ml-4 p-2.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-xl transition-all"><Trash2 size={18} /></button>
                )}
              </div>
            </div>
          )}

          {isGenerating && (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-8 max-w-2xl mx-auto py-10 px-8 glass-card rounded-[2.5rem] border-violet-500/20 bg-violet-500/5">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 bg-violet-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-violet-500/20 relative"><Loader2 size={32} className="text-violet-400 animate-spin" /><div className="absolute -top-1 -right-1 w-4 h-4 bg-fuchsia-500 rounded-full animate-pulse shadow-[0_0_100px_rgba(217,70,239,0.5)]" /></div>
                <h3 className="text-2xl font-black text-white tracking-tight">Forging Prompts...</h3>
                <p className="text-sm font-bold text-slate-500 uppercase tracking-[0.2em] animate-pulse">Running batch sequence...</p>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest"><span>Current Task: {currentProcessingIndex + 1} of {images.length}</span><span>{Math.round(generationProgress)}% Complete</span></div>
                <div className="w-full h-4 bg-slate-950/50 rounded-full overflow-hidden p-1 border border-white/5"><div className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 rounded-full transition-all duration-700" style={{ width: `${generationProgress}%` }} /></div>
              </div>
            </div>
          )}

          {allFinished && !isGenerating && !isPaused && (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 flex flex-col items-center gap-10">
              <div className={`glass-card w-full max-w-2xl p-12 rounded-[3rem] border-fuchsia-500/20 bg-fuchsia-500/5 text-center space-y-6 premium-shadow relative overflow-hidden ${!hasSuccessfulPrompts ? 'bg-rose-500/5 border-rose-500/20' : ''}`}>
                <div className="absolute -top-10 -right-10 p-6 opacity-5 rotate-12 pointer-events-none"><Trophy size={180} /></div>
                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border ${!hasSuccessfulPrompts ? 'bg-rose-500/10 border-rose-500/20' : 'bg-fuchsia-500/10 border-fuchsia-500/20'}`}>
                   {hasSuccessfulPrompts ? <Check size={40} className="text-fuchsia-400" /> : <X size={40} className="text-rose-400" />}
                </div>
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-white tracking-tight">{hasSuccessfulPrompts ? 'Batch Processed' : 'Batch Failed'}</h3>
                  <p className="text-slate-400 font-medium text-lg">
                    {hasSuccessfulPrompts 
                      ? `Generated ${images.filter(i => i.status === 'completed').length} Prompts` 
                      : "Zero prompts were generated. Please check your API keys and model choice."
                    }
                  </p>
                  {hasErrorPrompts && (
                    <div className="mt-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-xs font-mono max-h-32 overflow-y-auto">
                      {images.filter(img => img.status === 'error').map((img, idx) => (
                        <div key={idx} className="mb-1 text-left">Error: {img.error}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="pt-6">
                  <button 
                    onClick={exportCSV} 
                    disabled={!hasSuccessfulPrompts}
                    className={`w-full py-6 px-12 rounded-[1.5rem] font-black text-xl transition-all flex items-center justify-center gap-4 premium-shadow active:scale-[0.98] ${
                      !hasSuccessfulPrompts 
                        ? 'bg-slate-900 text-slate-600 cursor-not-allowed border border-white/5' 
                        : 'bg-white text-slate-950 hover:bg-slate-200 shadow-xl'
                    }`}
                  >
                    <Download size={28} className={hasSuccessfulPrompts ? "text-fuchsia-600" : "text-slate-600"} />
                    Download CSV List
                  </button>
                  <div className="mt-6">
                    <button 
                      onClick={clearImages} 
                      className="text-slate-500 hover:text-white font-bold transition-colors text-sm"
                    >
                      Clear All Data
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isGenerating && (
            <div className="flex flex-col sm:flex-row gap-5 max-w-2xl mx-auto">
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-5 px-10 rounded-[1.5rem] bg-slate-900 hover:bg-slate-800 text-white font-black text-lg transition-all flex items-center justify-center gap-3 border border-white/10 hover:border-white/20 premium-shadow"><ImagePlus size={24} className="text-violet-400" />Add Images</button>
              <button 
                onClick={generatePrompts} 
                disabled={images.length === 0} 
                className={`flex-1 py-5 px-10 rounded-[1.5rem] font-black text-lg shadow-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 ${images.length === 0 ? 'bg-slate-900 text-slate-600 cursor-not-allowed border border-white/5' : 'bg-white text-slate-950 hover:bg-slate-200 premium-shadow'}`}
              >
                {isResuming ? <Play size={24} className="text-emerald-600" /> : <Sparkles size={24} className="text-violet-600" />}
                {mainButtonLabel}
              </button>
            </div>
          )}
        </section>

        <section className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="flex items-center gap-3 px-2"><Layers size={20} className="text-indigo-400" /><h2 className="text-xl font-black text-white uppercase tracking-wider">Add to Start</h2></div>
              <div className="glass-card p-10 rounded-[2.5rem] space-y-8 premium-shadow min-h-[340px] flex flex-col">
                <input type="text" placeholder="Type a word and press Enter..." onKeyDown={(e) => { if (e.key === 'Enter') { const val = (e.target as HTMLInputElement).value.trim(); if (val && !settings.prefixes.includes(val)) { setSettings({ ...settings, prefixes: [...settings.prefixes, val], prefixCount: settings.prefixes.length + 1 }); (e.target as HTMLInputElement).value = ''; } } }} className="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-6 py-4 text-sm font-semibold outline-none focus:border-indigo-500/50 transition-all placeholder-slate-600" />
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-[11px] font-black text-slate-500 uppercase tracking-widest px-1"><span>How many words to use: {settings.prefixCount}</span></div>
                  <input type="range" min="0" max={settings.prefixes.length} value={settings.prefixCount} onChange={(e) => setSettings({ ...settings, prefixCount: parseInt(e.target.value) })} className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                </div>
                <div className="flex flex-wrap gap-2.5 flex-grow content-start">
                  {settings.prefixes.length === 0 && <p className="text-xs font-bold text-slate-600 italic">No words added yet.</p>}
                  {settings.prefixes.map((p, i) => (
                    <span key={i} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center transition-all duration-300 ${i < settings.prefixCount ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-lg shadow-indigo-500/10' : 'bg-slate-900 text-slate-600 border border-white/5'}`}>
                      {p}
                      <button onClick={() => setSettings({ ...settings, prefixes: settings.prefixes.filter((_, idx) => idx !== i), prefixCount: Math.min(settings.prefixCount, settings.prefixes.length - 1) })} className="ml-3 hover:text-white transition-colors"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-6">
              <div className="flex items-center gap-3 px-2"><Layers size={20} className="text-amber-400 rotate-180" /><h2 className="text-xl font-black text-white uppercase tracking-wider">Add to End</h2></div>
              <div className="glass-card p-10 rounded-[2.5rem] space-y-8 premium-shadow min-h-[340px] flex flex-col">
                <input type="text" placeholder="Type a word and press Enter..." onKeyDown={(e) => { if (e.key === 'Enter') { const val = (e.target as HTMLInputElement).value.trim(); if (val && !settings.suffixes.includes(val)) { setSettings({ ...settings, suffixes: [...settings.suffixes, val], suffixCount: settings.suffixes.length + 1 }); (e.target as HTMLInputElement).value = ''; } } }} className="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-6 py-4 text-sm font-semibold outline-none focus:border-amber-500/50 transition-all placeholder-slate-600" />
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-[11px] font-black text-slate-500 uppercase tracking-widest px-1"><span>How many words to use: {settings.suffixCount}</span></div>
                  <input type="range" min="0" max={settings.suffixes.length} value={settings.suffixCount} onChange={(e) => setSettings({ ...settings, suffixCount: parseInt(e.target.value) })} className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-amber-500" />
                </div>
                <div className="flex flex-wrap gap-2.5 flex-grow content-start">
                  {settings.suffixes.length === 0 && <p className="text-xs font-bold text-slate-600 italic">No words added yet.</p>}
                  {settings.suffixes.map((s, i) => (
                    <span key={i} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center transition-all duration-300 ${i < settings.suffixCount ? 'bg-amber-500/20 text-amber-300 border border-indigo-500/30 shadow-lg shadow-amber-500/10' : 'bg-slate-900 text-slate-600 border border-white/5'}`}>
                      {s}
                      <button onClick={() => setSettings({ ...settings, suffixes: settings.suffixes.filter((_, idx) => idx !== i), suffixCount: Math.min(settings.suffixCount, settings.suffixes.length - 1) })} className="ml-3 hover:text-white transition-colors"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-2xl mx-auto w-full space-y-6">
            <div className="flex items-center gap-3 px-2 justify-center"><Ban size={20} className="text-blue-400" /><h2 className="text-xl font-black text-white uppercase tracking-wider">Negative Words</h2></div>
            <div className="glass-card p-10 rounded-[2.5rem] space-y-8 premium-shadow min-h-[340px] flex flex-col">
              <input type="text" placeholder="Type a word to block and press Enter..." onKeyDown={(e) => { if (e.key === 'Enter') { const val = (e.target as HTMLInputElement).value.trim(); if (val && !settings.negativeWords.includes(val)) { setSettings({ ...settings, negativeWords: [...settings.negativeWords, val], negativeWordCount: settings.negativeWords.length + 1 }); (e.target as HTMLInputElement).value = ''; } } }} className="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-6 py-4 text-sm font-semibold outline-none focus:border-blue-500/50 transition-all placeholder-slate-600" />
              <div className="space-y-4">
                <div className="flex items-center justify-between text-[11px] font-black text-slate-500 uppercase tracking-widest px-1"><span>How many words to block: {settings.negativeWordCount}</span></div>
                <input type="range" min="0" max={settings.negativeWords.length} value={settings.negativeWordCount} onChange={(e) => setSettings({ ...settings, negativeWordCount: parseInt(e.target.value) })} className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>
              <div className="flex flex-wrap gap-2.5 flex-grow content-start justify-center">
                {settings.negativeWords.length === 0 && <p className="text-xs font-bold text-slate-600 italic">No blocked words yet.</p>}
                {settings.negativeWords.map((nw, i) => (
                  <span key={i} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center transition-all duration-300 ${i < settings.negativeWordCount ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 shadow-lg shadow-blue-500/10' : 'bg-slate-900 text-slate-600 border border-white/5'}`}>
                    {nw}
                    <button onClick={() => setSettings({ ...settings, negativeWords: settings.negativeWords.filter((_, idx) => idx !== i), negativeWordCount: Math.min(settings.negativeWordCount, settings.negativeWords.length - 1) })} className="ml-3 hover:text-white transition-colors"><X size={12} /></button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col items-center space-y-6 pt-10">
          <div className="flex flex-col sm:flex-row gap-5 max-w-2xl w-full mx-auto">
            <button onClick={saveSettings} className="flex-1 py-6 bg-white text-slate-950 rounded-[2rem] font-black text-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4 premium-shadow hover:bg-slate-100"><SettingsIcon className="group-hover:rotate-180 transition-transform duration-700" size={28} />Save My Settings</button>
            <button onClick={clearImages} className="flex-1 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4 border border-white/10 premium-shadow hover:bg-slate-800"><RotateCcw size={28} />Clear All Data</button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-slate-950/40 backdrop-blur-3xl pt-20 pb-12 px-6 overflow-hidden relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-12 lg:gap-16 text-sm">
          <div className="md:col-span-5 space-y-5">
            <div className="flex items-center gap-3"><span className="font-black text-2xl tracking-tight text-white">Prompt <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400">Forge</span></span></div>
            <p className="text-slate-500 text-base lg:text-lg leading-relaxed font-medium max-w-md">The best tool for turning images into prompts. Perfect for artists who want fast and high-quality results.</p>
          </div>
          <div className="md:col-span-4 space-y-5">
            <h4 className="font-black text-white uppercase tracking-[0.2em] text-[10px]">Platform</h4>
            <ul className="space-y-3 text-slate-500 font-bold">
              <li><button onClick={() => setActiveModal('privacy')} className="hover:text-white transition-colors">Privacy Policy</button></li>
              <li><button onClick={() => setActiveModal('terms')} className="hover:text-white transition-colors">Terms of Use</button></li>
              <li><button onClick={() => setActiveModal('faq')} className="hover:text-white transition-colors">Help & FAQ</button></li>
            </ul>
          </div>
          <div className="md:col-span-3 space-y-5">
            <h4 className="font-black text-white uppercase tracking-[0.2em] text-[10px]">Developer</h4>
            <p className="text-slate-500 font-bold leading-relaxed">Developed by <a href="https://www.behance.net/itsmdshawon" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 transition-colors no-underline">Md. Shawon</a></p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-16 pt-8 border-t border-white/5"><p className="text-slate-600 font-bold text-[10px] uppercase tracking-[0.2em] text-center">© Copyright 2026 Prompt Forge. All Rights Reserved</p></div>
      </footer>

      {activeModal === 'settings' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-2xl bg-[#0a0f1d] border border-white/10 rounded-[3rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,1)] animate-in zoom-in-95 duration-500">
            <div className="flex items-center justify-between p-10 border-b border-white/5 bg-white/[0.02]"><div><h3 className="text-2xl font-black text-white tracking-tight">Settings</h3><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Manage API Key Pools & Models</p></div><button onClick={() => setActiveModal(null)} className="p-3 hover:bg-white/10 rounded-full transition-all text-slate-400 hover:text-white border border-white/5"><X size={24} /></button></div>
            <div className="p-10 space-y-10 max-h-[65vh] overflow-y-auto">
              <div className="space-y-4 p-6 rounded-[2rem] border border-white/5 bg-white/[0.02]">
                <h4 className="text-lg font-black text-violet-400 tracking-tight">Gemini Lab</h4>
                <div className="flex gap-2"><input type="password" value={geminiInput} onChange={(e) => setGeminiInput(e.target.value)} placeholder="Paste Gemini key..." className="flex-1 bg-slate-950/80 border border-white/5 rounded-xl px-4 py-3 text-sm font-semibold focus:border-violet-500 outline-none transition-all" /><button onClick={() => handleAddKey('gemini', geminiInput)} className="px-6 py-3 bg-white text-slate-950 font-black rounded-xl text-xs hover:bg-slate-200 transition-all active:scale-95">Add</button></div>
                {settings.apiKeys.gemini.map((key, idx) => (<div key={idx} className="flex items-center justify-between p-3 bg-slate-950/50 border border-white/5 rounded-xl"><span className="text-xs font-mono text-slate-400">••••••••••••{key.slice(-4)}</span><button onClick={() => handleDeleteKey('gemini', idx)} className="p-1.5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded-lg transition-all"><Trash2 size={14} /></button></div>))}
                <button onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')} className="w-full mt-2 py-3 border border-white/5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all flex items-center justify-center gap-2"><ExternalLink size={14} /> Get Free Gemini API Keys</button>
              </div>
              <div className="space-y-4 p-6 rounded-[2rem] border border-white/5 bg-white/[0.02]">
                <h4 className="text-lg font-black text-indigo-400 tracking-tight">Groq Lab</h4>
                <div className="flex gap-2"><input type="password" value={groqInput} onChange={(e) => setGroqInput(e.target.value)} placeholder="Paste Groq key..." className="flex-1 bg-slate-950/80 border border-white/5 rounded-xl px-4 py-3 text-sm font-semibold focus:border-violet-500 outline-none transition-all" /><button onClick={() => handleAddKey('groq', groqInput)} className="px-6 py-3 bg-white text-slate-950 font-black rounded-xl text-xs hover:bg-slate-200 transition-all active:scale-95">Add</button></div>
                {settings.apiKeys.groq.map((key, idx) => (<div key={idx} className="flex items-center justify-between p-3 bg-slate-950/50 border border-white/5 rounded-xl"><span className="text-xs font-mono text-slate-400">••••••••••••{key.slice(-4)}</span><button onClick={() => handleDeleteKey('groq', idx)} className="p-1.5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded-lg transition-all"><Trash2 size={14} /></button></div>))}
                <button onClick={() => window.open('https://console.groq.com/keys', '_blank')} className="w-full mt-2 py-3 border border-white/5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all flex items-center justify-center gap-2"><ExternalLink size={14} /> Get Free Groq API Keys</button>
              </div>
              <div className="space-y-4 p-6 rounded-[2rem] border border-white/5 bg-white/[0.02]">
                <h4 className="text-lg font-black text-emerald-400 tracking-tight">Mistral Lab</h4>
                <div className="flex gap-2"><input type="password" value={mistralInput} onChange={(e) => setMistralInput(e.target.value)} placeholder="Paste Mistral key..." className="flex-1 bg-slate-950/80 border border-white/5 rounded-xl px-4 py-3 text-sm font-semibold focus:border-violet-500 outline-none transition-all" /><button onClick={() => handleAddKey('mistral', mistralInput)} className="px-6 py-3 bg-white text-slate-950 font-black rounded-xl text-xs hover:bg-slate-200 transition-all active:scale-95">Add</button></div>
                {settings.apiKeys.mistral.map((key, idx) => (<div key={idx} className="flex items-center justify-between p-3 bg-slate-950/50 border border-white/5 rounded-xl"><span className="text-xs font-mono text-slate-400">••••••••••••{key.slice(-4)}</span><button onClick={() => handleDeleteKey('mistral', idx)} className="p-1.5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded-lg transition-all"><Trash2 size={14} /></button></div>))}
                <button onClick={() => window.open('https://console.mistral.ai/api-keys/', '_blank')} className="w-full mt-2 py-3 border border-white/5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all flex items-center justify-center gap-2"><ExternalLink size={14} /> Get Free Mistral API Keys</button>
              </div>
              <div className="space-y-4"><h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">Select an AI Model</h4><div className="relative"><select value={settings.preferredModel} onChange={(e) => setSettings({ ...settings, preferredModel: e.target.value })} className="w-full bg-slate-950/80 border border-white/5 rounded-2xl px-6 py-4 text-sm font-bold appearance-none outline-none focus:border-violet-500 transition-all text-white">{models.map(m => (<option key={m.id} value={m.id} className="bg-slate-900">{m.name} ({m.provider.toUpperCase()})</option>))}</select><ChevronDown size={20} className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" /></div></div>
              <div className="space-y-4"><h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em]">Custom Instructions</h4><textarea value={settings.customInstruction} onChange={(e) => setSettings({ ...settings, customInstruction: e.target.value })} placeholder="Example: 'Make it bright' or 'Focus on the textures'" className="w-full h-32 bg-slate-950/80 border border-white/5 rounded-2xl px-6 py-5 text-sm font-semibold outline-none focus:border-violet-500 transition-all resize-none text-slate-100" /></div>
            </div>
            <div className="p-10 bg-white/[0.02] border-t border-white/5 flex flex-col sm:flex-row items-center justify-end gap-6"><button onClick={() => { saveSettings(); setActiveModal(null); }} className="w-full sm:w-auto px-12 py-4 bg-white text-slate-950 font-black rounded-2xl transition-all shadow-2xl hover:bg-slate-200 active:scale-95">Save Changes</button></div>
          </div>
        </div>
      )}

      {activeModal === 'hub' && (
        <div className="fixed inset-0 z-50 flex items-center justify-end p-0 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="absolute inset-0" onClick={() => setActiveModal(null)} />
          <div className="relative w-full max-w-[480px] h-full bg-[#030712] border-l border-white/10 shadow-[-20px_0_60px_rgba(0,0,0,0.5)] animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-violet-500/5 to-transparent">
              <div className="space-y-1"><div className="flex items-center gap-3"><div className="p-2 bg-violet-500/20 rounded-lg text-violet-400"><Share2 size={18} /></div><h3 className="text-xl font-black text-white tracking-tight">Community</h3></div></div>
              <button onClick={() => setActiveModal(null)} className="p-3 bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 rounded-2xl transition-all text-slate-400 border border-white/5 hover:border-rose-500/30"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
              <div className="grid grid-cols-1 gap-4">
                {[
                  { label: 'Support & Help', value: 'Join Our WhatsApp Support Group', url: 'https://chat.whatsapp.com/IVGlwnekD2CI5vj5E0n8WR', icon: <MessageSquare size={20} />, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', desc: 'Connect with creators, share knowledge, and get help.', extra: '+88 01881-447666' },
                  { label: 'Learning Center', value: 'Subscribe to My Channel', url: 'https://youtube.com/@MasterWithShawon', icon: <Youtube size={20} />, color: 'text-rose-400', bgColor: 'bg-rose-500/10', borderColor: 'border-rose-500/20', desc: 'Watch tutorials, tips, and insights for growing your work.' },
                  { label: 'Facebook Group', value: 'Join Our Group', url: 'https://www.facebook.com/groups/masterwithshawon', icon: <Users size={20} />, color: 'text-indigo-400', bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', desc: 'Join discussions and learn from other contributors.' },
                  { label: 'The Creator', value: 'Follow Me', url: 'https://www.facebook.com/itsmdshawon/', icon: <User size={20} />, color: 'text-fuchsia-400', bgColor: 'bg-fuchsia-500/10', borderColor: 'border-fuchsia-500/20', desc: 'Follow Md. Shawon for updates and community posts.' },
                ].map((item, i) => (
                  <a key={i} href={item.url} target="_blank" className="group relative flex flex-col p-6 glass-card rounded-[2rem] border border-white/5 hover:border-white/20 transition-all duration-500 overflow-hidden">
                    <div className="flex items-start gap-5 mb-4 relative z-10 min-w-0"><div className={`flex-shrink-0 p-4 ${item.bgColor} ${item.borderColor} border rounded-2xl ${item.color} group-hover:scale-110 transition-transform duration-500`}>{item.icon}</div><div className="space-y-1 min-w-0 flex-1"><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{item.label}</p><p className="text-lg font-black text-white leading-tight">{item.value}</p></div></div>
                    <div className="flex items-center justify-between pl-1 relative z-10 min-w-0"><div className="space-y-1 min-w-0 flex-1"><p className="text-xs text-slate-500 font-medium">{item.desc}</p>{item.extra && <p className="text-xs text-slate-400 font-bold">{item.extra}</p>}</div><div className={`flex-shrink-0 flex items-center gap-2 text-xs font-bold ${item.color} opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all ml-4`}>Join Now <ArrowRight size={14} /></div></div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {['privacy', 'terms', 'faq', 'contact'].includes(activeModal || '') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-3xl bg-[#0a0f1d] border border-white/10 rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-500">
            <div className="flex items-center justify-between p-10 border-b border-white/5 bg-white/[0.02]">
              <div><h3 className="text-2xl font-black text-white tracking-tight">{activeModal === 'faq' ? 'Help & FAQ' : activeModal === 'terms' ? 'Terms of Use' : activeModal === 'privacy' ? 'Privacy Policy' : 'Contact'}</h3></div>
              <button onClick={() => setActiveModal(null)} className="p-3 hover:bg-white/10 rounded-full transition-all text-slate-400 hover:text-white border border-white/5"><X size={24} /></button>
            </div>
            <div className="p-8 lg:p-14 max-h-[60vh] overflow-y-auto scrollbar-hide">
              {activeModal === 'privacy' && (
                <div className="space-y-6 text-slate-400 text-lg leading-relaxed">
                  <p className="font-semibold text-white">Your privacy matters to us. This page explains how Prompt Forge handles information when you use our website.</p>
                  <div className="space-y-4">
                    <p>When you use Prompt Forge, images you upload are used only to generate prompts for you. <span className="text-white font-bold">We do not own your images or your prompts.</span></p>
                    <p>If you add API keys or settings, they are used only to make the website work properly and remember your choices.</p>
                    <p>The website may save small data in your browser to keep your settings and improve your experience.</p>
                    <p>We do not collect personal details like your name, phone number, or address unless you choose to share them.</p>
                    <p>We use information only to run and improve the website. We do not use it for marketing.</p>
                    <p className="pt-4 text-sm border-t border-white/5 text-slate-500 italic">This Privacy Policy may change if the website is updated. Any changes will be shown on this page.</p>
                  </div>
                </div>
              )}
              {activeModal === 'terms' && (
                <div className="space-y-6 text-slate-400 text-lg leading-relaxed">
                  <p className="font-semibold text-white">Welcome to Prompt Forge. By using this website, you agree to follow these terms.</p>
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <p>Prompt Forge allows you to upload images and generate prompts for creating images with AI tools. <span className="text-white font-bold">You are responsible for how you use the prompts and results.</span></p>
                    </div>
                    <div className="space-y-2">
                      <p>All images you upload and prompts you generate belong to you. We do not claim ownership of your content.</p>
                    </div>
                    <div className="space-y-2">
                      <p>You agree not to use this website for harmful, illegal, or abusive purposes. Please use the tool responsibly.</p>
                    </div>
                    <div className="space-y-2">
                      <p>We work hard to keep the website running smoothly, but sometimes there may be small issues or interruptions.</p>
                    </div>
                    <div className="space-y-2">
                      <p>We may update or improve the website over time. These changes may affect how the site works.</p>
                    </div>
                    <p className="pt-6 text-sm border-t border-white/5 text-slate-500 italic">These Terms of Use may change in the future. Any updates will be shown on this page.</p>
                  </div>
                </div>
              )}
              {activeModal === 'faq' && (
                <div className="space-y-4">
                  {faqData.map((item, idx) => (
                    <div key={idx} className={`glass-card rounded-2xl border transition-all duration-300 ${expandedFaqIndex === idx ? 'border-violet-500/30 bg-violet-500/5' : 'border-white/5'}`}>
                      <button 
                        onClick={() => setExpandedFaqIndex(expandedFaqIndex === idx ? null : idx)}
                        className="w-full flex items-center justify-between p-6 text-left"
                      >
                        <span className={`text-lg font-black tracking-tight transition-colors ${expandedFaqIndex === idx ? 'text-violet-400' : 'text-white'}`}>{item.q}</span>
                        {expandedFaqIndex === idx ? <ChevronUp size={20} className="text-violet-400" /> : <ChevronDown size={20} className="text-slate-500" />}
                      </button>
                      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${expandedFaqIndex === idx ? 'max-h-[500px] opacity-100 pb-6 px-6' : 'max-h-0 opacity-0'}`}>
                        <p className="text-slate-400 text-base leading-relaxed font-medium pt-2 border-t border-white/5">{item.a}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeModal === 'contact' && (
                <div className="space-y-12">
                  <div className="space-y-4">
                    <h4 className="text-white text-3xl font-black tracking-tight leading-tight">Get in Touch</h4>
                    <p className="text-slate-400 text-lg leading-relaxed max-w-2xl font-medium">If you have questions or need help, feel free to contact us.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-2">
                    <a href="mailto:its.mdshawon@gmail.com" className="glass-card p-10 rounded-[3rem] border border-white/5 group hover:border-violet-500/30 transition-all block text-left relative overflow-hidden no-underline">
                      <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:scale-110 transition-transform duration-700 pointer-events-none"><Mail size={120} /></div>
                      <div className="p-5 bg-violet-500/10 rounded-2xl text-violet-400 w-fit mb-8 border border-violet-500/20 group-hover:scale-110 group-hover:rotate-3 transition-transform"><Mail size={28} /></div>
                      <h4 className="text-2xl font-black text-white mb-3">Send us an Email</h4>
                      <p className="text-slate-500 text-base mb-6 font-medium leading-relaxed">You can email us for general questions, feedback or support.</p>
                      <div className="flex items-center gap-2">
                        <span className="text-violet-400 font-bold text-lg transition-all no-underline">its.mdshawon@gmail.com</span>
                      </div>
                    </a>
                    <a href="https://wa.me/8801881447666" target="_blank" className="glass-card p-10 rounded-[3rem] border border-white/5 group hover:border-emerald-500/30 transition-all block text-left relative overflow-hidden no-underline">
                      <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:scale-110 transition-transform duration-700 pointer-events-none"><Phone size={120} /></div>
                      <div className="p-5 bg-emerald-500/10 rounded-2xl text-emerald-400 w-fit mb-8 border border-emerald-500/20 group-hover:scale-110 group-hover:-rotate-3 transition-transform"><Phone size={28} /></div>
                      <h4 className="text-2xl font-black text-white mb-3">WhatsApp Chat</h4>
                      <p className="text-slate-500 text-base mb-6 font-medium leading-relaxed">You can message us on WhatsApp for questions or updates.</p>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold text-lg transition-all no-underline">+880 1881-447666</span>
                      </div>
                    </a>
                  </div>
                  <div className="pt-8 border-t border-white/5 flex justify-center">
                    <div className="bg-white/[0.03] border border-white/10 px-8 py-4 rounded-2xl backdrop-blur-md">
                      <p className="text-sm font-medium text-slate-400">
                        <span className="text-violet-400 font-black uppercase tracking-[0.2em] text-[10px] mr-3 px-2 py-1 bg-violet-500/10 rounded border border-violet-500/20">Response Time</span>
                        We usually respond within 24 to 48 hours.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
