import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Zap, Play, Square, Monitor, BarChart2, Radio, Activity, Settings, AlertCircle, Loader2, Sparkles, Mic, MicOff, X, Eye, EyeOff, Sliders, Volume2, VolumeX, Volume1, User } from 'lucide-react';
import { StreamStatus, OrganizedNote, StatPoint, AudioConfig } from './types';
import { organizeTranscript } from './services/organizerService';
import Visualizer from './components/Visualizer';
import NoteCard from './components/NoteCard';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, YAxis } from 'recharts';
import { useGeminiLive } from './hooks/useGeminiLive';

/**
 * Character threshold to trigger automatic note analysis.
 * We wait for a sufficient buffer size to generate meaningful insights.
 */
const AUTO_ANALYZE_THRESHOLD = 200; 

/**
 * Audio Feedback Utility
 * Generates simple synth beeps using the Web Audio API for UI interactions.
 * Helps screen reader users and provides tactile feedback.
 */
const playFeedback = (type: 'click' | 'success' | 'on' | 'off') => {
    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (type === 'click') {
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
        } else if (type === 'on') {
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(500, now + 0.15);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        } else if (type === 'off') {
            osc.frequency.setValueAtTime(500, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        }
    } catch (e) {
        // Ignore audio errors
    }
};

/**
 * Main Application Component.
 * Orchestrates the UI, State, and the Gemini Live integration.
 */
export default function App() {
  // --- State ---
  const [notes, setNotes] = useState<OrganizedNote[]>([]);
  const [isProcessingNotes, setIsProcessingNotes] = useState(false);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);
  const [talkbackEnabled, setTalkbackEnabled] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [manualInput, setManualInput] = useState("");
  
  // Audio Config State
  const [audioConfig, setAudioConfig] = useState<AudioConfig>({
      latencyMode: 'interactive',
      noiseGateThreshold: 0.01
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Hook ---
  // The core logic for Gemini Live is encapsulated in this hook.
  const { 
    status, 
    segments, 
    currentTranscriptBuffer, 
    analyser, 
    errorMessage, 
    isReconnecting, // Status flag for auto-retry
    connect, 
    disconnect, 
    setCurrentTranscriptBuffer,
    isMicOn,
    toggleMic,
    sendTextMessage
  } = useGeminiLive({ 
    apiKey: process.env.API_KEY, 
    systemAudioEnabled,
    talkbackEnabled,
    audioConfig
  });

  // Sync hook errors to local state for dismissal
  useEffect(() => {
    if (errorMessage) setLocalError(errorMessage);
  }, [errorMessage]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [segments]);

  /**
   * "Ping Pong" Buffer Logic:
   * 1. Takes the current accumulated buffer.
   * 2. Sends it to Gemini Flash for summarization.
   * 3. Clears the buffer (resets for new input).
   */
  const handleGenerateInsight = useCallback(async () => {
    if (!process.env.API_KEY) return;
    if (currentTranscriptBuffer.length < 10) return;

    playFeedback('click');
    setIsProcessingNotes(true);
    const note = await organizeTranscript(currentTranscriptBuffer, process.env.API_KEY);
    if (note) {
      setNotes(prev => [note, ...prev]);
      setCurrentTranscriptBuffer(""); 
      playFeedback('success');
    }
    setIsProcessingNotes(false);
  }, [currentTranscriptBuffer, setCurrentTranscriptBuffer]);
  
  // Auto-trigger insight generation when threshold is reached
  useEffect(() => {
    if (currentTranscriptBuffer.length >= AUTO_ANALYZE_THRESHOLD && !isProcessingNotes) {
      handleGenerateInsight();
    }
  }, [currentTranscriptBuffer, isProcessingNotes, handleGenerateInsight]);

  // Aggregate stats for the bar chart
  const chartData = useMemo(() => {
    return notes
      .flatMap(n => n.topics)
      .reduce((acc: StatPoint[], topic) => {
        const existing = acc.find(a => a.topic === topic);
        if (existing) existing.count++;
        else acc.push({ topic, count: 1 });
        return acc;
      }, [])
      .sort((a,b) => b.count - a.count)
      .slice(0, 5);
  }, [notes]);

  const handleManualSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualInput.trim()) return;
      sendTextMessage(manualInput);
      setManualInput("");
      playFeedback('click');
  };

  // --- Theme Classes ---
  // Dynamic class sets for High Contrast vs Default Dark Mode
  const theme = isHighContrast ? {
    bg: 'bg-black',
    text: 'text-white',
    border: 'border-white',
    accent: 'text-yellow-400',
    accentBg: 'bg-yellow-400',
    card: 'bg-black border-2 border-white',
    subText: 'text-yellow-200',
    button: 'bg-white text-black border-2 border-white hover:bg-yellow-200',
    buttonSecondary: 'bg-black text-white border-2 border-white hover:bg-zinc-800'
  } : {
    bg: 'bg-zinc-950',
    text: 'text-zinc-100',
    border: 'border-zinc-800',
    accent: 'text-indigo-400',
    accentBg: 'bg-indigo-400',
    card: 'bg-zinc-900/50',
    subText: 'text-zinc-400',
    button: 'bg-white text-black hover:bg-zinc-200',
    buttonSecondary: 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
  };

  return (
    <div className={`flex h-screen w-full ${theme.bg} ${theme.text} overflow-hidden selection:bg-yellow-500/50`}>
      <a href="#main-content" className="skip-link focus-visible:ring-4 focus-visible:ring-yellow-400">Skip to content</a>
      
      {/* Navigation / Control Panel */}
      <nav aria-label="Main Controls" className={`w-80 border-r ${theme.border} flex flex-col flex-shrink-0 z-20`}>
        <header className={`p-6 border-b ${theme.border}`}>
          <div className="flex justify-between items-center">
             <h1 className={`text-2xl font-bold flex items-center gap-2 ${theme.accent}`}>
                <Zap fill="currentColor" aria-hidden="true" /> VibeNote
             </h1>
             <div className="flex gap-2">
                 <button 
                    onClick={() => { setShowSettings(!showSettings); playFeedback('click'); }}
                    className={`p-2 rounded-lg hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${showSettings ? 'bg-white/10' : ''}`}
                    aria-label={showSettings ? "Hide Settings" : "Show Settings"}
                    title="Audio Settings"
                 >
                    <Sliders size={20} />
                 </button>
                 <button 
                    onClick={() => { setIsHighContrast(!isHighContrast); playFeedback('click'); }}
                    className={`p-2 rounded-lg hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none`}
                    aria-label={isHighContrast ? "Disable High Contrast Mode" : "Enable High Contrast Mode"}
                    title="Toggle High Contrast"
                 >
                    {isHighContrast ? <EyeOff size={20} /> : <Eye size={20} />}
                 </button>
             </div>
          </div>
          <p className={`text-xs mt-2 font-mono ${theme.subText}`}>Real-time Neural Sync</p>
        </header>

        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          <section aria-labelledby="conn-heading" className="space-y-4">
            <h2 id="conn-heading" className={`text-xs font-bold uppercase tracking-wider ${theme.subText}`}>Connection</h2>
            
            {/* Auto-Reconnect Indicator */}
            {isReconnecting && (
                 <div role="status" className="p-3 bg-yellow-900/30 border border-yellow-500 text-yellow-200 rounded-lg text-sm flex items-center gap-2 animate-pulse">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Connection lost. Retrying...</span>
                 </div>
            )}
            
            {localError && !isReconnecting && (
              <div role="alert" className="p-3 bg-red-900/30 border border-red-500 text-red-200 rounded-lg text-sm flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{localError}</span>
                <button onClick={() => setLocalError(null)} aria-label="Dismiss error">
                  <X size={16} />
                </button>
              </div>
            )}

            {status === StreamStatus.DISCONNECTED || status === StreamStatus.ERROR ? (
              <button 
                onClick={() => { connect(); playFeedback('on'); }}
                className={`w-full py-3 px-4 rounded-lg font-bold transition-all flex items-center justify-center gap-2 focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${theme.button}`}
              >
                <Play size={18} fill="currentColor" aria-hidden="true" /> Start Session
              </button>
            ) : (
              <button 
                onClick={() => { disconnect(); playFeedback('off'); }}
                className="w-full py-3 px-4 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all flex items-center justify-center gap-2 focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-red-500 focus-visible:outline-none"
              >
                <Square size={18} fill="currentColor" aria-hidden="true" /> End Session
              </button>
            )}

            <button 
                onClick={() => { toggleMic(); playFeedback('click'); }}
                title="Uses System Default Microphone"
                className={`w-full py-2 px-3 text-sm rounded-md border flex items-center justify-between transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${theme.buttonSecondary}`}
                aria-pressed={isMicOn}
            >
                <span className="flex items-center gap-2">
                    {isMicOn ? <Mic size={16} aria-hidden="true"/> : <MicOff size={16} aria-hidden="true" />} 
                    Microphone (Default)
                </span>
                <span className={`w-3 h-3 rounded-full border border-white ${isMicOn ? 'bg-emerald-500' : 'bg-red-500'}`} aria-label={isMicOn ? "Microphone On" : "Microphone Off"}></span>
            </button>

            <button 
                onClick={() => { setSystemAudioEnabled(!systemAudioEnabled); playFeedback('click'); }}
                disabled={status === StreamStatus.CONNECTED} 
                className={`w-full py-2 px-3 text-sm rounded-md border flex items-center justify-between transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none disabled:opacity-50 ${theme.buttonSecondary}`}
                aria-pressed={systemAudioEnabled}
            >
                <span className="flex items-center gap-2"><Monitor size={16} aria-hidden="true" /> System Audio</span>
                <span className={`w-3 h-3 rounded-full border border-white ${systemAudioEnabled ? theme.accentBg : 'bg-zinc-600'}`} aria-label={systemAudioEnabled ? "System Audio Enabled" : "System Audio Disabled"}></span>
            </button>

            <button 
                onClick={() => { setTalkbackEnabled(!talkbackEnabled); playFeedback('click'); }}
                className={`w-full py-2 px-3 text-sm rounded-md border flex items-center justify-between transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${theme.buttonSecondary}`}
                aria-pressed={talkbackEnabled}
            >
                <span className="flex items-center gap-2">
                    {talkbackEnabled ? <Volume2 size={16} aria-hidden="true"/> : <VolumeX size={16} aria-hidden="true" />} 
                    AI Voice Response
                </span>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${talkbackEnabled ? 'bg-emerald-500' : 'bg-zinc-600'}`}>
                    <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${talkbackEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
            </button>
          </section>

          {showSettings && (
             <section aria-labelledby="settings-heading" className={`p-4 rounded-lg space-y-4 border ${theme.border} ${isHighContrast ? 'bg-zinc-900' : 'bg-zinc-900/50'}`}>
                <h2 id="settings-heading" className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${theme.subText}`}>
                   <Settings size={14} /> Audio Configuration
                </h2>
                
                <div className="space-y-2">
                    <label htmlFor="latency-mode" className={`text-xs block ${theme.subText}`}>Latency Mode</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button 
                           onClick={() => setAudioConfig(prev => ({ ...prev, latencyMode: 'interactive' }))}
                           className={`text-xs py-1.5 px-2 rounded border ${audioConfig.latencyMode === 'interactive' ? (isHighContrast ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-indigo-600 border-indigo-500 text-white') : `${theme.buttonSecondary}`}`}
                        >
                            Interactive (Fast)
                        </button>
                        <button 
                           onClick={() => setAudioConfig(prev => ({ ...prev, latencyMode: 'balanced' }))}
                           className={`text-xs py-1.5 px-2 rounded border ${audioConfig.latencyMode === 'balanced' ? (isHighContrast ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-indigo-600 border-indigo-500 text-white') : `${theme.buttonSecondary}`}`}
                        >
                            Balanced (HQ)
                        </button>
                    </div>
                </div>

                <div className="space-y-2">
                   <div className="flex justify-between">
                       <label htmlFor="noise-gate" className={`text-xs block ${theme.subText}`}>Noise Gate (Sensitivity)</label>
                       <span className="text-xs font-mono">{Math.round((1 - audioConfig.noiseGateThreshold / 0.05) * 100)}%</span>
                   </div>
                   <input 
                      id="noise-gate"
                      type="range" 
                      min="0" 
                      max="0.05" 
                      step="0.001"
                      value={audioConfig.noiseGateThreshold}
                      onChange={(e) => setAudioConfig(prev => ({ ...prev, noiseGateThreshold: parseFloat(e.target.value) }))}
                      className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      aria-label="Adjust noise gate threshold"
                   />
                   <div className="flex justify-between text-[10px] opacity-60">
                       <span>Sensitive</span>
                       <span>Strict</span>
                   </div>
                </div>
             </section>
          )}

          <section aria-labelledby="signal-heading" className="space-y-2">
            <h2 id="signal-heading" className={`text-xs font-bold uppercase tracking-wider flex justify-between ${theme.subText}`}>
              Signal Processing
              {status === StreamStatus.CONNECTED && <span className="text-emerald-500 font-bold animate-pulse" role="status">LIVE</span>}
            </h2>
            <div className={`rounded-lg p-2 border ${theme.border} h-24 flex items-center justify-center overflow-hidden bg-zinc-900`} aria-hidden="true">
               <Visualizer analyser={analyser} isActive={status === StreamStatus.CONNECTED} highContrast={isHighContrast} />
            </div>
          </section>

          {chartData.length > 0 && (
             <section aria-labelledby="stats-heading" className="space-y-2 h-56">
              <h2 id="stats-heading" className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${theme.subText}`}>
                 <BarChart2 size={16} aria-hidden="true"/> Topic Frequency
              </h2>
              {/* Screen Reader Table for Charts */}
              <table className="sr-only">
                  <caption>Frequency of topics mentioned in conversation</caption>
                  <thead><tr><th scope="col">Topic</th><th scope="col">Count</th></tr></thead>
                  <tbody>
                      {chartData.map(d => (
                          <tr key={d.topic}><td>{d.topic}</td><td>{d.count}</td></tr>
                      ))}
                  </tbody>
              </table>
              <div aria-hidden="true" className="h-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={isHighContrast ? "#333" : "#333"} />
                        <XAxis dataKey="topic" hide />
                        <YAxis stroke={isHighContrast ? "#fff" : "#888"} fontSize={10} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#000', border: '1px solid #fff', borderRadius: '4px' }} 
                            itemStyle={{ color: '#fff' }}
                            cursor={{fill: 'rgba(255,255,255,0.1)'}}
                        />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={isHighContrast ? '#FFFF00' : ['#818cf8', '#a78bfa', '#c084fc'][index % 3]} stroke={isHighContrast ? '#fff' : 'none'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
              </div>
             </section>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        {/* Transcript Feed */}
        <section className={`flex-1 flex flex-col border-r ${theme.border} relative`} aria-label="Live Transcript">
            <header className={`h-16 border-b ${theme.border} flex items-center justify-between px-6 bg-opacity-90 backdrop-blur-md sticky top-0 z-10 ${theme.bg}`}>
                <div className={`flex items-center gap-2 text-sm font-bold ${theme.text}`}>
                    <Radio size={18} className={status === StreamStatus.CONNECTED ? "text-red-500 animate-pulse" : "text-zinc-600"} aria-hidden="true" />
                    <h2>Live Transcript</h2>
                </div>
                <div className={`text-xs font-mono ${theme.subText}`}>
                    {segments.length} segments
                </div>
            </header>
            
            <div 
                className="flex-1 overflow-y-auto p-6 space-y-6" 
                ref={scrollRef}
                role="log" 
                aria-live="polite" 
                aria-atomic="false"
                tabIndex={0}
            >
                {segments.length === 0 && (
                    <div className={`h-full flex flex-col items-center justify-center ${theme.subText} opacity-70`}>
                        <Activity size={48} className="mb-4" aria-hidden="true" />
                        <p className="text-lg">Waiting for audio stream...</p>
                    </div>
                )}
                {segments.map((seg) => (
                    <div key={seg.id} className={`flex ${seg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex gap-3 max-w-[85%] ${seg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                            {/* Avatar Icon */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${
                                seg.sender === 'user' 
                                    ? (isHighContrast ? 'bg-white text-black' : 'bg-zinc-700 text-zinc-300') 
                                    : (isHighContrast ? 'bg-yellow-400 text-black' : 'bg-indigo-600 text-white')
                            }`}>
                                {seg.sender === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                            </div>

                            <div className={`rounded-2xl px-6 py-4 border relative ${
                                seg.sender === 'user' 
                                    ? `${isHighContrast ? 'bg-black border-white text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-100'} rounded-tr-sm` 
                                    : `${isHighContrast ? 'bg-black border-yellow-400 text-yellow-300' : 'bg-indigo-950/40 border-indigo-500/30 text-indigo-100'} rounded-tl-sm`
                            }`}>
                                <p className="text-base leading-relaxed">{seg.text}</p>
                                <div className="flex justify-between items-center mt-2 opacity-60">
                                    {/* Audio indicator if needed in future */}
                                    {seg.sender === 'model' && <Volume2 size={12} aria-label="Audio response" />}
                                    <span className={`text-xs font-mono ml-auto`}>
                                        {seg.timestamp.toLocaleTimeString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            
            {/* Input Area (Manual + Status) */}
            <div className={`border-t ${theme.border} bg-opacity-95 ${theme.bg}`}>
                 {/* Progress Bar */}
                 <div className="h-1 w-full bg-zinc-800 relative">
                     <div 
                        className={`absolute top-0 left-0 h-full transition-all duration-300 ease-out ${isHighContrast ? 'bg-yellow-400' : 'bg-indigo-500'}`}
                        style={{ width: `${Math.min(100, (currentTranscriptBuffer.length / AUTO_ANALYZE_THRESHOLD) * 100)}%` }}
                        role="progressbar"
                        aria-valuenow={currentTranscriptBuffer.length}
                        aria-valuemax={AUTO_ANALYZE_THRESHOLD}
                        aria-label="Analysis buffer progress"
                    />
                 </div>

                 <div className="p-4 flex flex-col gap-3">
                     {/* Manual Input Form */}
                     <form onSubmit={handleManualSubmit} className="flex gap-2">
                         <input 
                            type="text" 
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                            placeholder="Type a message or correction..."
                            className={`flex-1 px-4 py-2 rounded-lg bg-transparent border focus:outline-none focus:ring-2 ${
                                isHighContrast 
                                ? 'border-white text-white placeholder-zinc-400 focus:ring-yellow-400' 
                                : 'border-zinc-700 text-white placeholder-zinc-500 focus:ring-indigo-500 focus:border-transparent'
                            }`}
                         />
                         <button 
                            type="submit"
                            disabled={!manualInput.trim()}
                            className={`px-4 py-2 rounded-lg font-bold disabled:opacity-50 ${theme.button}`}
                         >
                            Send
                         </button>
                     </form>

                     <div className="flex items-center justify-between">
                         <div className="flex items-center gap-3 overflow-hidden">
                            <span className={`text-sm font-mono truncate ${theme.subText}`} aria-live="off">
                                Buffer: {currentTranscriptBuffer.length} / {AUTO_ANALYZE_THRESHOLD}
                            </span>
                            {isProcessingNotes && (
                                <span className={`flex items-center gap-2 text-xs font-bold px-3 py-1 rounded-full border ${isHighContrast ? 'text-black bg-yellow-400 border-yellow-400' : 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30'}`} role="status">
                                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                                    Analyzing...
                                </span>
                            )}
                        </div>

                        <button 
                            onClick={handleGenerateInsight}
                            disabled={isProcessingNotes || currentTranscriptBuffer.length < 10}
                            className={`text-xs font-semibold px-3 py-1.5 rounded transition-all flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-white focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                                isHighContrast 
                                ? 'bg-white text-black border border-white hover:bg-yellow-200' 
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                            aria-label="Analyze transcript buffer manually"
                        >
                            {isProcessingNotes ? (
                                <>
                                    <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Processing
                                </>
                            ) : (
                                <>
                                    <Sparkles size={12} aria-hidden="true" /> Analyze Buffer
                                </>
                            )}
                        </button>
                     </div>
                 </div>
            </div>
        </section>

        {/* Organized Notes Panel */}
        <aside className={`w-full md:w-[450px] flex flex-col border-l ${theme.border}`} aria-label="Intelligent Notes">
             <header className={`h-16 border-b ${theme.border} flex items-center px-6 bg-opacity-90 backdrop-blur-md sticky top-0 z-10 justify-between ${theme.bg}`}>
                <span className={`text-sm font-bold flex items-center gap-2 ${theme.text}`}>
                    <Settings size={18} aria-hidden="true" /> Intelligent Notes
                </span>
                <span className={`text-xs px-2 py-1 rounded-full border font-bold ${isHighContrast ? 'bg-white text-black border-black' : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'}`}>
                    Auto-Organizer
                </span>
            </header>

            <div className={`flex-1 overflow-y-auto p-4 ${isHighContrast ? 'bg-black' : 'bg-grid-zinc-900/50'}`}>
                {notes.length === 0 ? (
                    <div className="mt-20 text-center px-8">
                        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${isHighContrast ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-500'}`}>
                            <Zap size={24} aria-hidden="true" />
                        </div>
                        <h3 className={`font-bold mb-2 text-lg ${theme.text}`}>No Insights Yet</h3>
                        <p className={`text-sm leading-relaxed ${theme.subText}`}>
                            Speak clearly. Transcripts will be analyzed automatically to extract action items, decisions, and summaries in real-time.
                        </p>
                    </div>
                ) : (
                    <div role="feed" aria-label="List of generated notes">
                        {notes.map((note, i) => (
                            <NoteCard key={i} note={note} highContrast={isHighContrast} />
                        ))}
                    </div>
                )}
            </div>
        </aside>

      </main>
    </div>
  );
}