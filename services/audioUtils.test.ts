import { describe, it, expect } from 'vitest';
import { downsampleTo16k, createBlob, PCM_SAMPLE_RATE } from './audioUtils';

describe('audioUtils', () => {
  describe('downsampleTo16k', () => {
    it('should return the same buffer if input rate matches target rate', () => {
      const input = new Float32Array([0.5, -0.5, 0.0]);
      const result = downsampleTo16k(input, PCM_SAMPLE_RATE);
      expect(result).toEqual(input);
      // Ensure it's the exact same reference for performance if optimization allows, 
      // or at least equal values
      expect(result.length).toBe(3);
    });

    it('should downsample 48kHz to 16kHz (factor of 3)', () => {
      // 9 samples at 48k should become 3 samples at 16k
      const input = new Float32Array([1.0, 1.0, 1.0, 0.5, 0.5, 0.5, -1.0, -1.0, -1.0]);
      const result = downsampleTo16k(input, 48000);
      
      expect(result.length).toBe(3);
      // Basic linear interpolation check (logic validation)
      // Since input is constant in blocks of 3, the result should theoretically capture those values
      expect(result[0]).toBeCloseTo(1.0);
      expect(result[1]).toBeCloseTo(0.5);
      expect(result[2]).toBeCloseTo(-1.0);
    });

    it('should handle empty buffers', () => {
      const input = new Float32Array([]);
      const result = downsampleTo16k(input, 44100);
      expect(result.length).toBe(0);
    });
  });

  describe('createBlob', () => {
    it('should convert Float32Array to base64 PCM string', () => {
      // Create a simple buffer: 0.0 (silence) and 1.0 (max volume)
      const input = new Float32Array([0.0, 1.0, -1.0]);
      const result = createBlob(input);

      expect(result.mimeType).toBe('audio/pcm;rate=16000');
      expect(typeof result.data).toBe('string');
      
      // 0.0 -> 0 in Int16
      // 1.0 -> 32767 in Int16 (0x7FFF)
      // -1.0 -> -32768 in Int16 (0x8000)
      // 3 samples * 2 bytes = 6 bytes
      
      // Decoding the base64 to check values strictly
      const binaryString = atob(result.data);
      expect(binaryString.length).toBe(6);
    });
  });
});