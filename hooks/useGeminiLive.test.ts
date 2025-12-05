import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGeminiLive } from './useGeminiLive';
import { AudioConfig } from '../types';

// Mock Browser APIs
const mockGetAudioTracks = vi.fn().mockReturnValue([{ enabled: true }]);
const mockGetTracks = vi.fn().mockReturnValue([{ stop: vi.fn() }]);

const mockMediaStream = {
  getAudioTracks: mockGetAudioTracks,
  getTracks: mockGetTracks,
} as unknown as MediaStream;

// Setup global mocks
vi.stubGlobal('MediaStream', vi.fn().mockImplementation(() => mockMediaStream));

// Robust AudioContext Mock supporting the new processing chain
vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => ({
  createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
  createAnalyser: vi.fn().mockReturnValue({ connect: vi.fn(), fftSize: 2048 }),
  createScriptProcessor: vi.fn().mockReturnValue({ connect: vi.fn(), onaudioprocess: null, disconnect: vi.fn() }),
  createBiquadFilter: vi.fn().mockReturnValue({ connect: vi.fn(), frequency: { value: 0 }, type: '', Q: { value: 0 }, gain: { value: 0 } }),
  createDynamicsCompressor: vi.fn().mockReturnValue({ connect: vi.fn(), threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } }),
  createGain: vi.fn().mockReturnValue({ connect: vi.fn(), gain: { value: 1 } }),
  state: 'suspended',
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  destination: {},
})));

const defaultAudioConfig: AudioConfig = {
  latencyMode: 'interactive',
  noiseGateThreshold: 0.01
};

describe('useGeminiLive Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with disconnected status', () => {
    const { result } = renderHook(() => useGeminiLive({ 
      apiKey: 'test', 
      systemAudioEnabled: false, 
      talkbackEnabled: true,
      audioConfig: defaultAudioConfig
    }));
    expect(result.current.status).toBe('DISCONNECTED');
    expect(result.current.isMicOn).toBe(true);
  });

  it('should toggle microphone state', () => {
    const { result } = renderHook(() => useGeminiLive({ 
      apiKey: 'test', 
      systemAudioEnabled: false, 
      talkbackEnabled: true,
      audioConfig: defaultAudioConfig
    }));
    
    // Simulate connection having a stream ref (internal detail mocked via closure if we could, 
    // but here we test the state update primarily)
    
    act(() => {
      result.current.toggleMic();
    });

    expect(result.current.isMicOn).toBe(false);

    act(() => {
      result.current.toggleMic();
    });

    expect(result.current.isMicOn).toBe(true);
  });

  it('should set error if API key is missing on connect', async () => {
    const { result } = renderHook(() => useGeminiLive({ 
      apiKey: undefined, 
      systemAudioEnabled: false, 
      talkbackEnabled: true,
      audioConfig: defaultAudioConfig
    }));
    
    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.errorMessage).toBe("API Key is missing.");
  });
});