import React, { useRef, useEffect } from 'react';

interface VisualizerProps {
  /** The Web Audio API AnalyserNode source */
  analyser: AnalyserNode | null;
  /** Whether the visualization is currently running */
  isActive: boolean;
  /** Enables accessible high-contrast color mode */
  highContrast?: boolean;
}

/**
 * Renders a real-time frequency bar graph visualization of the audio stream.
 * Uses an optimized requestAnimationFrame loop on a 2D canvas.
 */
const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, highContrast = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas if inactive
    if (!analyser || !isActive) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!canvasRef.current || !analyser) return;
      
      // Get frequency data (0-255)
      analyser.getByteFrequencyData(dataArray);

      // Clear with theme-aware background
      ctx.fillStyle = highContrast ? '#000000' : '#09090b'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // Draw bars
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 1.5;

        // Accessible Colors vs Standard Aesthetic
        if (highContrast) {
            ctx.fillStyle = '#FBbf24'; // Yellow for high contrast
        } else {
            // Dynamic gradient based on frequency index
            const r = barHeight + 25 * (i / bufferLength);
            const g = 250 * (i / bufferLength);
            const b = 50;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
        }

        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
      
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    // Cleanup animation loop on unmount or prop change
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (ctx && canvasRef.current) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [analyser, isActive, highContrast]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className={`w-full h-16 rounded-lg ${highContrast ? 'opacity-100 border-2 border-yellow-400' : 'opacity-80'}`}
      role="img"
      aria-label={isActive ? "Audio visualization showing active frequency levels" : "Audio visualizer inactive"}
    />
  );
};

export default Visualizer;