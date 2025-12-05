import { GoogleGenAI, Type } from "@google/genai";
import { OrganizedNote } from "../types";

// Schema definition for the organizer
// This enforces the Gemini model to return a strictly structured JSON object.
const noteSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "A concise title for the conversation segment" },
    summary: { type: Type.STRING, description: "A brief summary of what was discussed" },
    topics: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Key topics or tags identified" 
    },
    actionItems: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Specific tasks or to-dos assigned or mentioned"
    },
    decisions: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Key decisions made during the discussion"
    },
    sentiment: {
      type: Type.STRING,
      enum: ["positive", "neutral", "negative"],
      description: "The general sentiment of the conversation"
    }
  },
  required: ["title", "summary", "topics", "actionItems", "decisions", "sentiment"]
};

/**
 * Analyzes a raw text transcript using Gemini Flash 2.5 and extracts structured business insights.
 * 
 * @param transcript - The raw text accumulated from the live session.
 * @param apiKey - The Google Generative AI API Key.
 * @returns A promise resolving to an OrganizedNote object or null if failed.
 */
export const organizeTranscript = async (transcript: string, apiKey: string): Promise<OrganizedNote | null> => {
  if (!apiKey || !transcript.trim()) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // We use the standard Flash model for this distinct cognitive task
    // It is cheaper and faster for pure text processing than the multimodal live session model
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Analyze the following transcript and extract structured notes:\n\n${transcript}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: noteSchema,
        systemInstruction: "You are an expert executive assistant. Your job is to listen to transcripts and organize them into clear, actionable business notes.",
      }
    });

    const jsonText = response.text;
    if (!jsonText) return null;

    const data = JSON.parse(jsonText);
    
    return {
      ...data,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error("Error organizing notes:", error);
    return null;
  }
};