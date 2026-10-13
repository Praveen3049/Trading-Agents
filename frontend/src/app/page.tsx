"use client";
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

export default function Dashboard() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [ticker, setTicker] = useState("BTCUSDT");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [preferredProvider, setPreferredProvider] = useState("gemini");
  const [isSavingKeys, setIsSavingKeys] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch AI Status
  const fetchAiStatus = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/ai-status");
      if (res.ok) {
        const data = await res.json();
        setAiStatus(data);
        if (data.active_provider) {
          setPreferredProvider(data.active_provider);
        }
      }
    } catch (err) {
      console.warn("Backend not yet reachable for AI status", err);
    }
  };

  // Run or refresh analysis
  const fetchAnalysis = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("http://localhost:8000/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, timeframe: "5M" })
      });
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
        if (data.llm_status) {
          setAiStatus(data.llm_status);
        }
      }
    } catch (err) {
      console.error("Failed to fetch agent analysis", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Save Keys handler
  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingKeys(true);
    try {
      const res = await fetch("http://localhost:8000/api/update-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemini_key: geminiKeyInput || undefined,
          openai_key: openaiKeyInput || undefined,
          preferred_provider: preferredProvider
        })
      });
      if (res.ok) {
        const data = await res.json();
        setAiStatus(data.ai_status);
        setShowKeyModal(false);
        setGeminiKeyInput("");
        setOpenaiKeyInput("");
        fetchAnalysis();
      }
    } catch (err) {
      console.error("Error saving keys:", err);
    } finally {
      setIsSavingKeys(false);
    }
  };

  useEffect(() => {
    fetchAiStatus();
  }, []);

  useEffect(() => {
    // Initialize TradingView Lightweight Chart
    if (!chartContainerRef.current) return;
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0f172a' }, // slate-900
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 420,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // Mock initial data
    const mockData = [
      { time: '2026-10-01', open: 66200, high: 66900, low: 66050, close: 66800 },
      { time: '2026-10-02', open: 66800, high: 67450, low: 66700, close: 67300 },
      { time: '2026-10-03', open: 67300, high: 67800, low: 67100, close: 67500 },
      { time: '2026-10-04', open: 67500, high: 67600, low: 66800, close: 67050 },
      { time: '2026-10-05', open: 67050, high: 67900, low: 67000, close: 67650 },
    ];
    candlestickSeries.setData(mockData);

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    fetchAnalysis();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [ticker]);

  const hasActiveLLM = aiStatus?.gemini_configured || aiStatus?.openai_configured;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Navigation / Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <span className="text-emerald-400">⚡</span> AGENTIC DESK
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold uppercase tracking-wider">
                Multi-Agent System
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              Autonomous continuous analysis active on <span className="font-semibold text-white">{ticker}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* AI Status Badge */}
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/60 rounded-xl px-3 py-1.5 text-xs">
              <span className={`w-2.5 h-2.5 rounded-full ${hasActiveLLM ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
              <span className="font-medium text-slate-300">
                {hasActiveLLM ? (
                  aiStatus?.gemini_configured ? "Gemini 2.5 Active" : "OpenAI GPT-4o Active"
                ) : (
                  "Rule Engine (No API Key)"
                )}
              </span>
            </div>

            {/* API Keys Configuration Button */}
            <button
              onClick={() => setShowKeyModal(true)}
              className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition"
            >
              <span>🔑</span> API Keys
            </button>

            {/* Ticker Input */}
            <div className="relative">
              <input 
                type="text" 
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="Ticker"
                className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-1.5 text-white font-mono font-bold text-sm tracking-wider w-32 focus:outline-none focus:border-emerald-500 transition"
              />
            </div>

            {/* Refresh Button */}
            <button
              onClick={fetchAnalysis}
              disabled={isRefreshing}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
              {isRefreshing ? "Analyzing..." : "Refresh"}
            </button>
          </div>
        </header>

        {/* Master Trade Verdict Banner */}
        {analysis?.master_plan && (
          <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Master Execution Plan</span>
                <span className={`px-3 py-1 rounded-lg text-sm font-black tracking-wide ${
                  analysis.master_plan.verdict.includes('BUY') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                  analysis.master_plan.verdict.includes('SELL') ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                  'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                }`}>
                  {analysis.master_plan.verdict}
                </span>
                {analysis.master_plan.llm_powered && (
                  <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                    Deep LLM Synthesis
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">
                Risk/Reward: <span className="font-bold text-white text-sm font-mono">{analysis.master_plan.risk_reward_ratio}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-mono">
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans">Optimal Entry</span>
                <span className="font-bold text-emerald-400 text-base">{analysis.master_plan.entry_zone}</span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans">Stop Loss</span>
                <span className="font-bold text-rose-400 text-base">{analysis.master_plan.stop_loss}</span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans">Target 1 (TP1)</span>
                <span className="font-bold text-sky-400 text-base">{analysis.master_plan.take_profit_1}</span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans">Target 2 (TP2)</span>
                <span className="font-bold text-indigo-400 text-base">{analysis.master_plan.take_profit_2}</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/60 text-xs text-slate-300 flex flex-col md:flex-row justify-between gap-2">
              <p><span className="text-slate-500 font-semibold">Agent Consensus: </span>{analysis.master_plan.agent_consensus}</p>
              {analysis.master_plan.key_risk_factors?.length > 0 && (
                <div className="text-amber-400/90 flex items-center gap-1">
                  <span>⚠️</span> {analysis.master_plan.key_risk_factors.join(", ")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TradingView Chart Container */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex justify-between items-center mb-3 px-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Institutional Chart</span>
              <span className="text-xs font-mono text-slate-500">5M Candlesticks</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Live Structure
            </div>
          </div>
          <div ref={chartContainerRef} className="w-full rounded-xl overflow-hidden" />
        </div>

        {/* Specialized Agent Panels */}
        {analysis && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Top Down Agent */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"></div>
                    <h2 className="text-lg font-bold text-white">Top-Down Agent</h2>
                  </div>
                  {analysis.top_down.llm_powered ? (
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                      AI Reasoned
                    </span>
                  ) : (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                      Heuristic
                    </span>
                  )}
                </div>
                <div className="space-y-4 text-sm">
                  <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-500 text-xs block mb-1">Macro Direction</span>
                    <span className={`font-black text-lg ${analysis.top_down.bias === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {analysis.top_down.bias}
                    </span>
                    <span className="text-xs text-slate-400 ml-2">({analysis.top_down.confidence_score || 80}% Confidence)</span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-xs font-medium block">Draw on Liquidity (DOL)</span>
                    <p className="text-white text-sm mt-0.5 font-medium">{analysis.top_down.dol}</p>
                  </div>

                  {analysis.top_down.macro_narrative && (
                    <div className="bg-purple-950/20 border border-purple-800/30 p-3 rounded-xl text-xs text-purple-200/90 leading-relaxed">
                      <span className="block font-bold text-[10px] uppercase text-purple-400 mb-1">Macro Narrative</span>
                      {analysis.top_down.macro_narrative}
                    </div>
                  )}

                  <div>
                    <span className="text-slate-400 text-xs font-medium block mb-1">Key Institutional Levels</span>
                    <ul className="space-y-1 text-slate-200 text-xs">
                      {analysis.top_down.key_levels?.map((level: string, i: number) => (
                        <li key={i} className="flex items-center gap-1.5 bg-slate-950/40 px-2.5 py-1 rounded border border-slate-800/50">
                          <span className="text-purple-400">◆</span> {level}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* CRT Agent */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                    <h2 className="text-lg font-bold text-white">CRT Agent</h2>
                  </div>
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded font-mono">
                    {analysis.crt.model || "CRT Engine"}
                  </span>
                </div>
                <div className="space-y-4 text-sm">
                  <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/80 flex justify-between items-center">
                    <div>
                      <span className="text-slate-500 text-xs block">CRT Status</span>
                      <span className="font-bold text-white">{analysis.crt.crt_detected ? "Setup Validated" : "No Setup"}</span>
                    </div>
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded">
                      {analysis.crt.quality} Quality
                    </span>
                  </div>

                  {analysis.crt.crt_explanation && (
                    <div className="bg-blue-950/20 border border-blue-800/30 p-3 rounded-xl text-xs text-blue-200/90 leading-relaxed">
                      <span className="block font-bold text-[10px] uppercase text-blue-400 mb-1">Session Cycle</span>
                      {analysis.crt.crt_explanation}
                    </div>
                  )}

                  <div>
                    <span className="text-slate-400 text-xs font-medium block mb-1">CRT Confluences</span>
                    <ul className="space-y-1 text-slate-200 text-xs">
                      {analysis.crt.confluence?.map((check: string, i: number) => (
                        <li key={i} className="flex items-center gap-2 bg-slate-950/40 px-2.5 py-1 rounded border border-slate-800/50">
                          <span className="text-emerald-400 font-bold">✓</span> {check}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-2">
                    <span className="text-slate-500 text-xs block mb-1">CRT Action Trigger</span>
                    <div className="bg-blue-500/10 text-blue-400 px-3 py-2 rounded-xl border border-blue-500/20 font-bold text-xs">
                      {analysis.crt.action}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Technical Structure Engine */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    <h2 className="text-lg font-bold text-white">Structure Engine</h2>
                  </div>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono">
                    PineScript Engine
                  </span>
                </div>
                <div className="space-y-3 text-sm">
                  {Object.entries(analysis.structure)
                    .filter(([key]) => ["d1", "h4", "h1", "m15"].includes(key))
                    .map(([tf, dir]: [string, any]) => (
                      <div key={tf} className="flex justify-between items-center bg-slate-950/50 px-3 py-2 rounded-xl border border-slate-800/70">
                        <span className="text-slate-400 uppercase font-mono font-bold text-xs">{tf} Flow</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${
                          dir === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {dir}
                        </span>
                      </div>
                  ))}

                  <div className="pt-2 space-y-2 text-xs">
                    <div className="flex justify-between items-center text-slate-400 border-b border-slate-800 pb-1.5">
                      <span>Nearest Order Block</span>
                      <span className="text-slate-200 font-mono font-semibold">{analysis.structure.nearest_ob}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-400 border-b border-slate-800 pb-1.5">
                      <span>Nearest FVG Zone</span>
                      <span className="text-slate-200 font-mono font-semibold">{analysis.structure.nearest_fvg}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Modal: API Key Configuration */}
        {showKeyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <span>🔑</span> AI Integration Setup
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Configure Gemini & OpenAI keys for your trading agents.</p>
                </div>
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="text-slate-400 hover:text-white text-lg font-bold p-1"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveKeys} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Google Gemini API Key
                  </label>
                  <input
                    type="password"
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    placeholder={aiStatus?.gemini_configured ? "•••••••• (Key Configured - enter to update)" : "AIzaSy..."}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">Recommended: Gemini 2.5 Flash for high-speed macro reasoning.</span>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    OpenAI API Key
                  </label>
                  <input
                    type="password"
                    value={openaiKeyInput}
                    onChange={(e) => setOpenaiKeyInput(e.target.value)}
                    placeholder={aiStatus?.openai_configured ? "•••••••• (Key Configured - enter to update)" : "sk-proj-..."}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Primary Provider
                  </label>
                  <select
                    value={preferredProvider}
                    onChange={(e) => setPreferredProvider(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="gemini">Google Gemini (Gemini 2.5 Flash)</option>
                    <option value="openai">OpenAI (GPT-4o Mini / GPT-4o)</option>
                  </select>
                </div>

                <div className="pt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowKeyModal(false)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-xl text-xs font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingKeys}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/30 disabled:opacity-50"
                  >
                    {isSavingKeys ? "Saving..." : "Save & Activate"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
