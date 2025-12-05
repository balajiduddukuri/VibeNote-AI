import { describe, it, expect, vi, beforeEach } from 'vitest';
import { organizeTranscript } from './organizerService';

// Mock the GoogleGenAI library
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      ARRAY: 'ARRAY',
    },
  };
});

describe('organizerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null if transcript is empty', async () => {
    const result = await organizeTranscript('', 'fake-key');
    expect(result).toBeNull();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('should return null if apiKey is missing', async () => {
    const result = await organizeTranscript('some text', '');
    expect(result).toBeNull();
  });

  it('should parse valid JSON response correctly', async () => {
    const mockResponse = {
      title: "Test Note",
      summary: "Summary text",
      topics: ["Tag1"],
      actionItems: ["Do this"],
      decisions: ["Decided that"],
      sentiment: "positive"
    };

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const result = await organizeTranscript('some transcript text', 'fake-key');

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Test Note");
    expect(result?.topics).toHaveLength(1);
    expect(result?.timestamp).toBeDefined(); // Service adds timestamp
  });

  it('should handle API errors gracefully', async () => {
    mockGenerateContent.mockRejectedValue(new Error("API Error"));
    
    // Should not throw, but return null (and log error)
    const result = await organizeTranscript('text', 'key');
    expect(result).toBeNull();
  });
});