import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { StreamStatus, TranscriptSegment, AudioConfig } from '../types';
import { createBlob, decode, decodeAudioData, downsampleTo16k } from '../services/audioUtils';

export interface UseGeminiLiveProps {
  apiKey: string | undefined;
  /** Whether to capture and stream system audio (if supported) */
  systemAudioEnabled: boolean;
  /** Whether the AI's voice response should be played back */
  talkbackEnabled: boolean;
  /** Audio quality configuration */
  audioConfig: AudioConfig;
}

/**
 * A comprehensive hook that manages the Gemini Live API session.
 * 
 * Responsibilities:
 * 1. Manages WebSocket connection state (connect/disconnect/reconnect).
 * 2. Sets up the Web Audio API graph (Microphone -> Processing -> API).
 * 3. Applies a professional "Vocal Chain" (EQ, Compressor, Gate) to input.
 * 4. Handles real-time audio streaming and transcript buffering.
 * 5. Manages audio playback of the model's response.
 */
export const useGeminiLive = ({ apiKey, systemAudioEnabled, talkbackEnabled, audioConfig }: UseGeminiLiveProps) => {
  const [status, setStatus] = useState<StreamStatus>(StreamStatus.DISCONNECTED);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [currentTranscriptBuffer, setCurrentTranscriptBuffer] = useState("");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  
  // State to track if the system is currently trying to recover from a dropped connection
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Buffer Debounce Refs
  const bufferAccumulatorRef = useRef("");
  const bufferDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio Context & Pipeline Refs
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
  // Prevents sending data to a closed socket during race conditions.
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
  
  /**
   * Batches incoming text chunks to prevent excessive React state updates.
   * Flushes to state every 200ms.
   */
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

  /**
   * Mutes/Unmutes the microphone track without stopping the stream.
   */
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

  /**
   * Allows the user to manually send text input to the model.
   * Useful for corrections or if the microphone is unavailable.
   */
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

  /**
   * Gracefully shuts down the entire audio pipeline and WebSocket.
   * Releases all hardware resources.
   */
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

  /**
   * Manually disconnects the session (User interaction).
   * Disables auto-reconnection logic.
   */
  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false; // User explicitly stopped, do not reconnect
    isLiveRef.current = false;
    setIsReconnecting(false);
    
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

  /**
   * Main function to establish the connection and start the session.
   */
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
      // 1. Initialize AudioContext IMMEDIATELY (to satisfy browser autoplay policies)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ 
        latencyHint: configRef.current.latencyMode 
      });
      
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      audioContextRef.current = ctx;

      // 2. Setup Audio Inputs (Microphone) with Speech Optimization constraints
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
          // @ts-ignore - Experimental constraint for better voice isolation on supported devices
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
            setIsReconnecting(false); // Clear reconnecting flag on success
          },
          onmessage: async (msg: LiveServerMessage) => {
            try {
              // Handle User Transcription
              const inputTranscript = msg.serverContent?.inputTranscription;
              if (inputTranscript?.text) {
                const text = inputTranscript.text;
                setSegments(prev => {
                  const last = prev[prev.length - 1];
                  // Append to partial segment if it exists
                  if (last && last.sender === 'user' && last.isPartial) {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...last, text: last.text + text };
                    return updated;
                  }
                  // Start new segment
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
                setIsReconnecting(true);
                // Keep status as CONNECTING or transition to it to show retry UI
                setStatus(StreamStatus.CONNECTING);
                
                stopAudioPipeline();
                
                // Exponential backoff or simple delay
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
      // 1. High-Pass Filter (Low Cut) - Removes rumble/desk bumps (<85Hz)
      const highPass = ctx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 85; 

      // 2. Parametric EQ (Presence Boost) - Adds clarity for speech (~3kHz)
      const midBoost = ctx.createBiquadFilter();
      midBoost.type = 'peaking';
      midBoost.frequency.value = 3000;
      midBoost.Q.value = 1.0;
      midBoost.gain.value = 3; // +3dB

      // 3. Low-Pass Filter (High Cut) - Removes hiss/sibilance (>6kHz)
      const lowPass = ctx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 6000; 

      // 4. Dynamics Compressor (Normalization) - Evens out volume levels
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 30;
      compressor.ratio.value = 12; // High ratio for voice leveling
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // 5. Makeup Gain - Boosts the signal after compression
      const makeupGain = ctx.createGain();
      makeupGain.gain.value = 1.5;

      // Chain Connections
      micSource.connect(highPass);
      highPass.connect(midBoost);
      midBoost.connect(lowPass);
      lowPass.connect(compressor);
      compressor.connect(makeupGain);

      let finalSource: AudioNode = makeupGain; 

      // Mix in system audio if enabled
      if (sysStream && sysStream.getAudioTracks().length > 0) {
        const sysSource = ctx.createMediaStreamSource(sysStream);
        systemSourceRef.current = sysSource;
        const mixNode = ctx.createGain();
        makeupGain.connect(mixNode);
        sysSource.connect(mixNode);
        finalSource = mixNode;
      }

      // Connect to Analyser for Visualizer
      finalSource.connect(analyserNode);

      // ScriptProcessor for raw PCM access (deprecated but reliable for this use case)
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isLiveRef.current || !processorRef.current || !audioContextRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);
        
        // --- Noise Gate ---
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
           sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);
        const threshold = configRef.current.noiseGateThreshold;
        
        // If below threshold, silence the buffer
        if (rms < threshold) {
             inputData.fill(0);
        }

        // --- Downsampling ---
        const downsampledData = downsampleTo16k(inputData, effectiveSampleRate);
        const pcmBlob = createBlob(downsampledData);

        // --- Send to API ---
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
      // Processor must be connected to destination to run, even if we don't want to hear it
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
    isReconnecting,
    connect,
    disconnect,
    setCurrentTranscriptBuffer,
    isMicOn,
    toggleMic,
    setTalkbackEnabled,
    sendTextMessage
  };
};