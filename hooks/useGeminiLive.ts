import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { StreamStatus, TranscriptSegment, AudioConfig } from '../types';
import { createBlob, decode, decodeAudioData, downsampleTo16k } from '../services/audioUtils';

export interface UseGeminiLiveProps {
  apiKey: string | undefined;
  systemAudioEnabled: boolean;
  talkbackEnabled: boolean;
  audioConfig: AudioConfig;
}

export const useGeminiLive = ({ apiKey, systemAudioEnabled, talkbackEnabled, audioConfig }: UseGeminiLiveProps) => {
  const [status, setStatus] = useState<StreamStatus>(StreamStatus.DISCONNECTED);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [currentTranscriptBuffer, setCurrentTranscriptBuffer] = useState("");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);

  // Buffer Debounce Refs
  const bufferAccumulatorRef = useRef("");
  const bufferDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const systemSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Ref to hold latest config without triggering re-connects
  const configRef = useRef<AudioConfig>(audioConfig);
  // Ref to hold latest talkback setting to avoid stale closures in callbacks
  const talkbackRef = useRef(talkbackEnabled);
  
  // Strict flag to control data flow. 
  const isLiveRef = useRef(false);
  // Flag to track if we should auto-reconnect on error/close
  const shouldReconnectRef = useRef(false);

  // Update refs when props change
  useEffect(() => {
    configRef.current = audioConfig;
  }, [audioConfig]);

  useEffect(() => {
    talkbackRef.current = talkbackEnabled;
  }, [talkbackEnabled]);
  
  // Debounced update function for transcript buffer
  const queueTranscriptUpdate = useCallback((text: string) => {
    bufferAccumulatorRef.current += " " + text;

    if (!bufferDebounceTimerRef.current) {
      bufferDebounceTimerRef.current = setTimeout(() => {
        const textToFlush = bufferAccumulatorRef.current;
        if (textToFlush) {
           setCurrentTranscriptBuffer((prev) => prev + textToFlush);
           bufferAccumulatorRef.current = "";
        }
        bufferDebounceTimerRef.current = null;
      }, 200); // 200ms debounce
    }
  }, []);

  const toggleMic = useCallback(() => {
    setIsMicOn(prev => {
      const newState = !prev;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(track => {
          track.enabled = newState;
        });
      }
      return newState;
    });
  }, []);
  
  const setTalkbackEnabled = useCallback((enabled: boolean) => {
      // Logic handled via ref in onmessage
  }, []);

  const sendTextMessage = useCallback((text: string) => {
     if (!text.trim()) return;
     
     // Optimistically update UI
     setSegments(prev => [...prev, { 
         id: Date.now().toString(), 
         sender: 'user', 
         text: text, 
         timestamp: new Date(), 
         isPartial: false 
     }]);
     queueTranscriptUpdate(text);

     // Send to API if connected
     if (sessionRef.current && isLiveRef.current) {
         sessionRef.current.sendRealtimeInput({
             text: text
         });
     }
  }, [queueTranscriptUpdate]);

  const stopAudioPipeline = useCallback(() => {
    isLiveRef.current = false; // Immediately stop sending data

    // Clear debounce timer and pending buffer
    if (bufferDebounceTimerRef.current) {
      clearTimeout(bufferDebounceTimerRef.current);
      bufferDebounceTimerRef.current = null;
    }
    bufferAccumulatorRef.current = "";

    // Stop all currently playing audio sources
    if (audioSourcesRef.current) {
      audioSourcesRef.current.forEach(source => {
        try {
          source.stop();
        } catch (e) { /* ignore */ }
      });
      audioSourcesRef.current.clear();
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (systemSourceRef.current) {
      systemSourceRef.current.disconnect();
      systemSourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach(t => t.stop());
      systemStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(e => console.warn("Context close error", e));
      audioContextRef.current = null;
    }
    setAnalyser(null);
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false; // User explicitly stopped, do not reconnect
    isLiveRef.current = false;
    
    if (sessionRef.current) {
      try {
        if (typeof sessionRef.current.close === 'function') {
           sessionRef.current.close();
        }
      } catch (e) {
        console.warn("Could not close session explicitly", e);
      }
      sessionRef.current = null;
    }
    stopAudioPipeline();
    setStatus(StreamStatus.DISCONNECTED);
  }, [stopAudioPipeline]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isLiveRef.current = false;
      shouldReconnectRef.current = false;
      if (bufferDebounceTimerRef.current) {
        clearTimeout(bufferDebounceTimerRef.current);
      }
      disconnect();
    };
  }, [disconnect]);

  const connect = useCallback(async () => {
    if (!apiKey) {
      setErrorMessage("API Key is missing.");
      return;
    }
    
    // Reset flags
    isLiveRef.current = true;
    shouldReconnectRef.current = false;
    
    setErrorMessage(null);
    setStatus(StreamStatus.CONNECTING);

    try {
      // 1. Initialize AudioContext IMMEDIATELY
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ 
        latencyHint: configRef.current.latencyMode 
      });
      
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      audioContextRef.current = ctx;

      // 2. Setup Audio Inputs (Microphone) with Speech Optimization
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
          // @ts-ignore - Experimental constraint for better voice isolation
          voiceIsolation: true 
        }
      });
      streamRef.current = micStream;
      
      micStream.getAudioTracks().forEach(track => {
        track.enabled = isMicOn;
      });

      // 3. Setup System Audio (Optional)
      let sysStream: MediaStream | null = null;
      if (systemAudioEnabled) {
        try {
          sysStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true, 
            audio: true 
          });
          systemStreamRef.current = sysStream;
        } catch (err) {
          console.warn("System audio selection cancelled or failed", err);
        }
      }

      // 4. Connect to Gemini Live API
      const ai = new GoogleGenAI({ apiKey });
      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: "You are a helpful, concise assistant participating in a meeting or brainstorming session. You understand English, Telugu, and Hindi. Listen carefully. When you speak, be brief and professional.",
        },
        callbacks: {
          onopen: () => {
             // If user disconnected while connecting, abort
            if (!isLiveRef.current) {
                 console.log("Connection opened but user cancelled. Closing.");
                 return;
            }
            console.log("Gemini Live Connected");
            setStatus(StreamStatus.CONNECTED);
          },
          onmessage: async (msg: LiveServerMessage) => {
            try {
              // Handle User Transcription
              const inputTranscript = msg.serverContent?.inputTranscription;
              if (inputTranscript?.text) {
                const text = inputTranscript.text;
                setSegments(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.sender === 'user' && last.isPartial) {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...last, text: last.text + text };
                    return updated;
                  }
                  return [...prev, { id: Date.now().toString(), sender: 'user', text, timestamp: new Date(), isPartial: true }];
                });
                queueTranscriptUpdate(text);
              }

              // Handle Model Transcription
              const outputTranscript = msg.serverContent?.outputTranscription;
              if (outputTranscript?.text) {
                const text = outputTranscript.text;
                setSegments(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.sender === 'model' && last.isPartial) {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...last, text: last.text + text };
                    return updated;
                  }
                  return [...prev, { id: Date.now().toString(), sender: 'model', text, timestamp: new Date(), isPartial: true }];
                });
                queueTranscriptUpdate(text);
              }

              // Handle Turn Completion
              if (msg.serverContent?.turnComplete) {
                setSegments(prev => prev.map(s => ({ ...s, isPartial: false })));
              }

              // Handle Audio Output
              const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audioData && audioContextRef.current && talkbackRef.current) {
                try {
                  const audioBuffer = await decodeAudioData(decode(audioData), audioContextRef.current);
                  const source = audioContextRef.current.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(audioContextRef.current.destination);
                  
                  source.onended = () => {
                    audioSourcesRef.current.delete(source);
                  };
                  audioSourcesRef.current.add(source);
                  
                  source.start();
                } catch (decodeErr) {
                  console.error("Audio decode error:", decodeErr);
                }
              }
            } catch (err) {
              console.error("Error processing message:", err);
            }
          },
          onclose: () => {
            console.log("Gemini Live Closed");
            if (shouldReconnectRef.current) {
                console.log("Reconnecting flag set, skipping disconnect status update.");
                return;
            }
            setStatus(StreamStatus.DISCONNECTED);
            stopAudioPipeline();
          },
          onerror: (err: any) => {
            console.error("Gemini Live Error", err);
            
            if (isLiveRef.current) {
                // Auto-retry logic: don't show error UI, just try to reconnect
                console.log("Connection dropped while active. Initiating auto-reconnect...");
                shouldReconnectRef.current = true;
                setStatus(StreamStatus.CONNECTING);
                
                stopAudioPipeline();
                
                setTimeout(() => {
                    console.log("Reconnecting now...");
                    connect();
                }, 1500); 
            } else {
                 stopAudioPipeline();
            }
          }
        }
      };

      const sessionPromise = ai.live.connect(config);
      sessionRef.current = await sessionPromise;

      // 5. Audio Pipeline Setup
      const effectiveSampleRate = ctx.sampleRate;
      
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.5;
      setAnalyser(analyserNode);

      // Create Microphone Source
      const micSource = ctx.createMediaStreamSource(micStream);
      sourceRef.current = micSource;

      // --- Professional Vocal Chain ---
      // 1. High-Pass Filter (Low Cut)
      const highPass = ctx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 85; 

      // 2. Parametric EQ (Presence Boost)
      const midBoost = ctx.createBiquadFilter();
      midBoost.type = 'peaking';
      midBoost.frequency.value = 3000;
      midBoost.Q.value = 1.0;
      midBoost.gain.value = 3; // +3dB

      // 3. Low-Pass Filter (High Cut)
      const lowPass = ctx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 6000; 

      // 4. Dynamics Compressor (Normalization)
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // 5. Makeup Gain
      const makeupGain = ctx.createGain();
      makeupGain.gain.value = 1.5;

      micSource.connect(highPass);
      highPass.connect(midBoost);
      midBoost.connect(lowPass);
      lowPass.connect(compressor);
      compressor.connect(makeupGain);

      let finalSource: AudioNode = makeupGain; 

      if (sysStream && sysStream.getAudioTracks().length > 0) {
        const sysSource = ctx.createMediaStreamSource(sysStream);
        systemSourceRef.current = sysSource;
        const mixNode = ctx.createGain();
        makeupGain.connect(mixNode);
        sysSource.connect(mixNode);
        finalSource = mixNode;
      }

      finalSource.connect(analyserNode);

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isLiveRef.current || !processorRef.current || !audioContextRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
           sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);
        const threshold = configRef.current.noiseGateThreshold;
        
        if (rms < threshold) {
             inputData.fill(0);
        }

        const downsampledData = downsampleTo16k(inputData, effectiveSampleRate);
        const pcmBlob = createBlob(downsampledData);

        sessionPromise.then((session) => {
          if (!isLiveRef.current) return;
          try {
            session.sendRealtimeInput({ media: pcmBlob });
          } catch (e) {
            console.debug("Send error (ignoring):", e);
          }
        }).catch(() => {
           // Ignore promise rejection
        });
      };

      finalSource.connect(processor);
      processor.connect(ctx.destination);

    } catch (e) {
      console.error(e);
      let msg = "Failed to start session.";
      if (e instanceof Error && e.name === 'NotAllowedError') {
        msg = "Microphone permission denied.";
      }
      setErrorMessage(msg);
      setStatus(StreamStatus.ERROR);
      stopAudioPipeline();
    }
  }, [apiKey, systemAudioEnabled, stopAudioPipeline, isMicOn, queueTranscriptUpdate]);

  return {
    status,
    segments,
    currentTranscriptBuffer,
    analyser,
    errorMessage,
    connect,
    disconnect,
    setCurrentTranscriptBuffer,
    isMicOn,
    toggleMic,
    setTalkbackEnabled,
    sendTextMessage
  };
};
