"use client";
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

export default function Dashboard() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [ticker, setTicker] = useState("XAUUSD");

  useEffect(() => {
    // Initialize TradingView Lightweight Chart
    if (!chartContainerRef.current) return;
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#111827' }, // gray-900
        textColor: '#9ca3af', // gray-400
      },
      grid: {
        vertLines: { color: '#1f2937' }, // gray-800
        horzLines: { color: '#1f2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // Mock initial data (we'll replace this with real historical data from Python)
    const mockData = [
      { time: '2026-10-01', open: 1900, high: 1910, low: 1895, close: 1905 },
      { time: '2026-10-02', open: 1905, high: 1920, low: 1900, close: 1915 },
      { time: '2026-10-03', open: 1915, high: 1925, low: 1910, close: 1920 },
      { time: '2026-10-04', open: 1920, high: 1922, low: 1890, close: 1895 },
      { time: '2026-10-05', open: 1895, high: 1905, low: 1885, close: 1900 },
    ];
    candlestickSeries.setData(mockData);

    // Auto-fetch Agent Analysis
    const fetchAnalysis = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker, timeframe: "5M" })
        });
        const data = await res.json();
        setAnalysis(data.analysis);

        // Later, we will use the agent data here to draw OBs and FVGs on the chart!
      } catch (err) {
        console.error("Failed to fetch agent analysis", err);
      }
    };

    fetchAnalysis();

    // Cleanup chart on unmount
    return () => {
      chart.remove();
    };
  }, [ticker]); // Re-run if ticker changes

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        <header className="flex justify-between items-center border-b border-gray-800 pb-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Agentic Trading Dashboard</h1>
            <p className="text-gray-400 mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Agents running continuously on {ticker}
            </p>
          </div>
          <div>
            <input 
              type="text" 
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white font-semibold focus:outline-none focus:border-blue-500"
            />
          </div>
        </header>

        {/* TradingView Chart Container */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div ref={chartContainerRef} className="w-full" />
        </div>

        {/* Agent Analysis */}
        {analysis && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Top Down Agent */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                <h2 className="text-xl font-semibold text-white">Top-Down Agent</h2>
              </div>
              <div className="space-y-4 text-sm">
                <div>
                  <span className="text-gray-500 block">Macro Bias</span>
                  <span className={`font-medium ${analysis.top_down.bias === 'BULLISH' ? 'text-green-400' : 'text-red-400'}`}>
                    {analysis.top_down.bias}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block">Draw on Liquidity (DOL)</span>
                  <span className="text-white">{analysis.top_down.dol}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Key Levels</span>
                  <ul className="list-disc pl-5 mt-1 text-white">
                    {analysis.top_down.key_levels.map((level: string, i: number) => (
                      <li key={i}>{level}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* CRT Agent */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <h2 className="text-xl font-semibold text-white">CRT Agent</h2>
              </div>
              <div className="space-y-4 text-sm">
                <div>
                  <span className="text-gray-500 block">CRT Detected</span>
                  <span className="text-white">{analysis.crt.crt_detected ? "YES" : "NO"}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Direction</span>
                  <span className={`font-medium ${analysis.crt.direction === 'BULLISH' ? 'text-green-400' : 'text-red-400'}`}>
                    {analysis.crt.direction}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block">Confluence Checks</span>
                  <ul className="space-y-1 mt-1 text-white">
                    {analysis.crt.confluence.map((check: string, i: number) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-green-400">✓</span> {check}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Technical Structure Engine */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <h2 className="text-xl font-semibold text-white">MTF Structure</h2>
              </div>
              <div className="space-y-4 text-sm">
                {Object.entries(analysis.structure).map(([tf, dir]: [string, any]) => (
                  <div key={tf} className="flex justify-between items-center border-b border-gray-800 pb-2 last:border-0">
                    <span className="text-gray-400 uppercase font-medium">{tf}</span>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${dir === 'BULLISH' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      {dir}
                    </span>
                  </div>
                ))}
                
                <div className="mt-6 pt-4 border-t border-gray-800">
                  <span className="text-gray-500 block mb-1">Recommended Action</span>
                  <div className="bg-blue-500/10 text-blue-400 px-3 py-2 rounded border border-blue-500/20 font-medium">
                    {analysis.crt.action}
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
