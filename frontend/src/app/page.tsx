"use client";
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

const CORE_ASSETS = [
  { symbol: "XAUUSD", name: "Gold / USD", icon: "🟡", category: "Metals" },
  { symbol: "EURUSD", name: "Euro / USD", icon: "🔵", category: "Forex" },
  { symbol: "GBPUSD", name: "Pound / USD", icon: "🟣", category: "Forex" },
  { symbol: "XAGUSD", name: "Silver / USD", icon: "⚪", category: "Metals" },
  { symbol: "BTCUSD", name: "Bitcoin / USD", icon: "🟠", category: "Crypto" },
];

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default function Dashboard() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const seriesInstanceRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);

  const [ticker, setTicker] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("5m");
  const [marketInfo, setMarketInfo] = useState<any>(null);
  const [htfZones, setHtfZones] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<any>(null);

  const [showKeyModal, setShowKeyModal] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [preferredProvider, setPreferredProvider] = useState("gemini");
  const [isSavingKeys, setIsSavingKeys] = useState(false);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);

  // Backtest Lab state
  const [backtestData, setBacktestData] = useState<any>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestTf, setBacktestTf] = useState("15m");
  const [backtestPeriod, setBacktestPeriod] = useState("60d");
  const [backtestCrtFilter, setBacktestCrtFilter] = useState(true);
  const [backtestRr, setBacktestRr] = useState(2.0);
  const [backtestModel, setBacktestModel] = useState("crt_1am");

  const runBacktest = async (
    sym = ticker,
    tf = backtestTf,
    period = backtestPeriod,
    crt = backtestCrtFilter,
    rr = backtestRr,
    model = backtestModel
  ) => {
    setIsBacktesting(true);
    try {
      const res = await fetch("http://localhost:8000/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: sym,
          timeframe: tf,
          period: period,
          rr_target: rr,
          apply_crt_filter: crt,
          strategy_model: model
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBacktestData(data);
      }
    } catch (err) {
      console.error("Backtest failed:", err);
    } finally {
      setIsBacktesting(false);
    }
  };

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

  const parsePrice = (val: any): number | null => {
    if (!val) return null;
    const match = String(val).match(/([0-9]+(?:\.[0-9]+)?)/);
    return match ? parseFloat(match[1]) : null;
  };

  // Draw ONLY High-Probability HTF Order Block, FVG, DOL and Trade Plan Lines
  const renderChartOverlays = (plan: any, zones: any) => {
    if (!seriesInstanceRef.current) return;

    // Clear old price lines
    priceLinesRef.current.forEach((line) => {
      try {
        seriesInstanceRef.current.removePriceLine(line);
      } catch (e) {
        // ignore if already removed
      }
    });
    priceLinesRef.current = [];

    if (!showOverlays) return;

    // 1. Draw High-Probability HTF Draw On Liquidity (DOL) Target
    if (zones?.dol?.price) {
      const dolLine = seriesInstanceRef.current.createPriceLine({
        price: zones.dol.price,
        color: '#c084fc', // Vibrant purple
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `🎯 ${zones.dol.title}`,
      });
      priceLinesRef.current.push(dolLine);
    }

    // 2. Draw High-Probability HTF Order Block (Top & Bottom)
    if (zones?.order_block?.top && zones?.order_block?.bottom) {
      const isBear = zones.order_block.type?.includes('BEARISH');
      const obColor = isBear ? '#f43f5e' : '#10b981';
      
      const obTop = seriesInstanceRef.current.createPriceLine({
        price: zones.order_block.top,
        color: obColor,
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `📦 HTF OB TOP [${zones.order_block.top}]`,
      });
      const obBtm = seriesInstanceRef.current.createPriceLine({
        price: zones.order_block.bottom,
        color: obColor,
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `📦 HTF OB BTM [${zones.order_block.bottom}]`,
      });
      priceLinesRef.current.push(obTop, obBtm);
    }

    // 3. Draw High-Probability HTF Fair Value Gap (FVG Top & Bottom)
    if (zones?.fvg?.top && zones?.fvg?.bottom) {
      const fvgTop = seriesInstanceRef.current.createPriceLine({
        price: zones.fvg.top,
        color: '#06b6d4', // Sky/Cyan
        lineWidth: 1,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: `⚡ HTF FVG TOP [${zones.fvg.top}]`,
      });
      const fvgBtm = seriesInstanceRef.current.createPriceLine({
        price: zones.fvg.bottom,
        color: '#06b6d4',
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: true,
        title: `⚡ HTF FVG BTM [${zones.fvg.bottom}]`,
      });
      priceLinesRef.current.push(fvgTop, fvgBtm);
    }

    // 4. Draw Trade Plan Lines (Entry, SL, TP)
    if (plan) {
      const entryPrice = parsePrice(plan.entry_zone);
      if (entryPrice) {
        const entryLine = seriesInstanceRef.current.createPriceLine({
          price: entryPrice,
          color: '#34d399',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `ENTRY [${entryPrice}]`,
        });
        priceLinesRef.current.push(entryLine);
      }

      const slPrice = parsePrice(plan.stop_loss);
      if (slPrice) {
        const slLine = seriesInstanceRef.current.createPriceLine({
          price: slPrice,
          color: '#fb7185',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `STOP LOSS [${slPrice}]`,
        });
        priceLinesRef.current.push(slLine);
      }

      const tp1Price = parsePrice(plan.take_profit_1);
      if (tp1Price) {
        const tp1Line = seriesInstanceRef.current.createPriceLine({
          price: tp1Price,
          color: '#38bdf8',
          lineWidth: 2,
          lineStyle: 1,
          axisLabelVisible: true,
          title: `TP1 [${tp1Price}]`,
        });
        priceLinesRef.current.push(tp1Line);
      }
    }
  };

  // Fetch real market candles & feed to TradingView
  const fetchMarketCandles = async (sym: string, tf: string) => {
    setIsLoadingChart(true);
    try {
      const res = await fetch("http://localhost:8000/api/market-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: sym, timeframe: tf })
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data;
        setMarketInfo(data);
        if (data.high_probability_zones) {
          setHtfZones(data.high_probability_zones);
        }

        if (seriesInstanceRef.current && data.candles && data.candles.length > 0) {
          seriesInstanceRef.current.setData(data.candles);
          if (chartInstanceRef.current) {
            chartInstanceRef.current.timeScale().fitContent();
          }
        }

        renderChartOverlays(analysis?.master_plan, data.high_probability_zones);
      }
    } catch (err) {
      console.error("Failed to load real market candles:", err);
    } finally {
      setIsLoadingChart(false);
    }
  };

  // Run or refresh analysis
  const fetchAnalysis = async (sym: string) => {
    setIsRefreshing(true);
    try {
      const res = await fetch("http://localhost:8000/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: sym, timeframe })
      });
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
        if (data.llm_status) {
          setAiStatus(data.llm_status);
        }
        if (data.analysis?.structure?.high_probability_zones) {
          setHtfZones(data.analysis.structure.high_probability_zones);
          renderChartOverlays(data.analysis.master_plan, data.analysis.structure.high_probability_zones);
        } else {
          renderChartOverlays(data.analysis?.master_plan, htfZones);
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
        fetchAnalysis(ticker);
      }
    } catch (err) {
      console.error("Error saving keys:", err);
    } finally {
      setIsSavingKeys(false);
    }
  };

  // Initialize TradingView Chart Once
  useEffect(() => {
    fetchAiStatus();

    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#090d16' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#131b2e' },
        horzLines: { color: '#131b2e' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 460,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      }
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    chartInstanceRef.current = chart;
    seriesInstanceRef.current = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Whenever ticker or timeframe changes, pull real market candles and rerun analysis
  useEffect(() => {
    fetchMarketCandles(ticker, timeframe);
    fetchAnalysis(ticker);
    runBacktest(ticker);
  }, [ticker, timeframe]);

  // Re-render overlays when showOverlays toggle changes
  useEffect(() => {
    renderChartOverlays(analysis?.master_plan, htfZones);
  }, [showOverlays]);

  const hasActiveLLM = aiStatus?.gemini_configured || aiStatus?.openai_configured;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-5">
        
        {/* Navigation / Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/90 border border-slate-800/80 p-5 rounded-2xl shadow-xl backdrop-blur-md">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <span className="text-emerald-400">⚡</span> AGENTIC TRADING DESK
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold uppercase tracking-wider">
                Multi-Agent System
              </span>
            </div>
            <p className="text-slate-400 text-xs md:text-sm mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              Live market intelligence & autonomous reasoning on <span className="font-bold text-white">{ticker}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Feed Source Indicator */}
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
              <span className={`w-2.5 h-2.5 rounded-full ${marketInfo?.source === 'mt5' ? 'bg-emerald-400' : 'bg-blue-400 animate-pulse'}`}></span>
              <span className="font-mono text-slate-300">
                {marketInfo?.source === 'mt5' ? "MT5 Broker Feed" : "Live Market Feed"}
              </span>
            </div>

            {/* AI Status Badge */}
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
              <span className={`w-2.5 h-2.5 rounded-full ${hasActiveLLM ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
              <span className="font-medium text-slate-300">
                {hasActiveLLM ? (
                  aiStatus?.gemini_configured ? "Gemini 3.5 AI" : "GPT-4o Mini AI"
                ) : (
                  "Rule Engine"
                )}
              </span>
            </div>

            {/* API Keys Configuration Button */}
            <button
              onClick={() => setShowKeyModal(true)}
              className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold transition"
            >
              <span>🔑</span> Keys
            </button>

            {/* Refresh Button */}
            <button
              onClick={() => {
                fetchMarketCandles(ticker, timeframe);
                fetchAnalysis(ticker);
              }}
              disabled={isRefreshing || isLoadingChart}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
              {isRefreshing ? "Analyzing..." : "Refresh"}
            </button>
          </div>
        </header>

        {/* 5 Core Assets Quick-Switch Bar */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase font-extrabold text-slate-500 px-2 tracking-wider">Traded Pairs:</span>
            {CORE_ASSETS.map((asset) => {
              const isActive = ticker === asset.symbol;
              return (
                <button
                  key={asset.symbol}
                  onClick={() => setTicker(asset.symbol)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    isActive 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md shadow-emerald-950/50 scale-[1.02]' 
                      : 'bg-slate-950/60 hover:bg-slate-800 text-slate-300 border border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <span className="text-sm">{asset.icon}</span>
                  <span>{asset.symbol}</span>
                  <span className="text-[10px] text-slate-500 hidden sm:inline font-normal">({asset.name})</span>
                </button>
              );
            })}
          </div>

          {/* Current Live Price Banner */}
          {marketInfo && (
            <div className="flex items-center gap-3 px-3 py-1 bg-slate-950/80 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-400 font-medium">{ticker}:</span>
              <span className="text-base font-black font-mono text-white">
                {marketInfo.current_price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
              </span>
              <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                (marketInfo.change_percent ?? 0) >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
              }`}>
                {(marketInfo.change_percent ?? 0) >= 0 ? '+' : ''}{marketInfo.change_percent}%
              </span>
            </div>
          )}
        </div>

        {/* Master Trade Verdict Banner */}
        {analysis?.master_plan && (
          <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4 mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Master Execution Plan</span>
                <span className={`px-3.5 py-1 rounded-xl text-sm font-black tracking-wide ${
                  analysis.master_plan.verdict.includes('BUY') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-950' :
                  analysis.master_plan.verdict.includes('SELL') ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-sm shadow-rose-950' :
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
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans mb-1">Optimal Entry Zone</span>
                <span className="font-bold text-emerald-400 text-base">{analysis.master_plan.entry_zone}</span>
              </div>
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans mb-1">Stop Loss</span>
                <span className="font-bold text-rose-400 text-base">{analysis.master_plan.stop_loss}</span>
              </div>
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans mb-1">Target 1 (TP1)</span>
                <span className="font-bold text-sky-400 text-base">{analysis.master_plan.take_profit_1}</span>
              </div>
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 text-xs block font-sans mb-1">Target 2 (TP2)</span>
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

        {/* High-Probability Institutional Structure HUD Bar */}
        {htfZones && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-1.5">
                  <span className="text-purple-400">💎</span> High-Probability HTF Key Levels
                </span>
                <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                  Filtered (D1 / H4 Priority)
                </span>
              </div>
              
              <button
                onClick={() => setShowOverlays(!showOverlays)}
                className={`text-xs px-3 py-1 rounded-xl font-bold transition flex items-center gap-1.5 ${
                  showOverlays 
                    ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40' 
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <span>{showOverlays ? '👁️' : '🙈'}</span>
                <span>{showOverlays ? 'Chart Overlays: ON' : 'Chart Overlays: OFF'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
              {/* DOL Target Card */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-purple-500/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 font-sans text-[11px] flex items-center gap-1">
                    <span>🎯</span> Draw On Liquidity (DOL)
                  </span>
                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 rounded">
                    {htfZones.dol?.type || "Target"}
                  </span>
                </div>
                <div className="text-purple-300 font-bold text-sm">
                  {htfZones.dol?.price?.toLocaleString() || "Evaluating..."}
                </div>
                <span className="text-[10px] text-slate-500 truncate block mt-0.5 font-sans">
                  {htfZones.dol?.title || "HTF Target Target"}
                </span>
              </div>

              {/* High Probability Order Block Card */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 font-sans text-[11px] flex items-center gap-1">
                    <span>📦</span> HTF Order Block
                  </span>
                  <span className={`text-[10px] px-1.5 rounded font-bold ${
                    htfZones.order_block?.type?.includes('BEARISH') ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {htfZones.order_block?.status || "FRESH"}
                  </span>
                </div>
                <div className="text-white font-bold text-sm">
                  {htfZones.order_block ? `${htfZones.order_block.bottom} - ${htfZones.order_block.top}` : "None in range"}
                </div>
                <span className="text-[10px] text-slate-500 truncate block mt-0.5 font-sans">
                  {htfZones.order_block?.title || "Filtered for HTF confluence"}
                </span>
              </div>

              {/* High Probability FVG Card */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 font-sans text-[11px] flex items-center gap-1">
                    <span>⚡</span> HTF Fair Value Gap
                  </span>
                  <span className="text-[10px] bg-sky-500/20 text-sky-400 px-1.5 rounded font-bold">
                    UNMITIGATED
                  </span>
                </div>
                <div className="text-sky-300 font-bold text-sm">
                  {htfZones.fvg ? `${htfZones.fvg.bottom} - ${htfZones.fvg.top}` : "None in range"}
                </div>
                <span className="text-[10px] text-slate-500 truncate block mt-0.5 font-sans">
                  {htfZones.fvg?.title || "Fresh institutional imbalance"}
                </span>
              </div>

              {/* Market Regime Card */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 font-sans text-[11px] flex items-center gap-1">
                    <span>⚖️</span> HTF Market Regime
                  </span>
                  <span className={`text-[10px] px-1.5 rounded font-bold ${
                    htfZones.regime === 'DISCOUNT' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  }`}>
                    {htfZones.regime}
                  </span>
                </div>
                <div className="text-white font-bold text-sm">
                  {htfZones.regime === 'DISCOUNT' ? "Discount Accumulation" : "Premium Distribution"}
                </div>
                <span className="text-[10px] text-slate-500 truncate block mt-0.5 font-sans">
                  Relative to Equilibrium (50%)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* TradingView Chart Container with Timeframe Controls */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex flex-wrap justify-between items-center mb-3 px-2 gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>{ticker}</span>
                <span className="text-xs text-slate-400 font-normal">Real Market Candlestick Chart</span>
              </span>
              {isLoadingChart && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping"></span> Loading live data...
                </span>
              )}
            </div>

            {/* Timeframe Buttons */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold uppercase transition ${
                    timeframe === tf 
                      ? 'bg-blue-600 text-white shadow-sm' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-850'
                  }`}
                >
                  {tf}
                </button>
              ))}
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
                    <span className="text-xs text-slate-400 ml-2">({analysis.top_down.confidence_score || 85}% Confidence)</span>
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
                    <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"></div>
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

        {/* Institutional Backtest Lab */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-white flex items-center gap-2">
                  <span>📊</span> Institutional Quantitative Backtest Lab
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-semibold uppercase tracking-wider">
                  CRT Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Bar-by-bar historical verification of Asian sweep setups, London/NY manipulation windows, and trailing breakeven management.
              </p>
            </div>

            {/* Backtest Control Toolbar */}
            <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
              {/* Strategy Model Selector */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
                {[
                  { id: "crt_1am", label: "01:00 AM CRT (Ep 8)", icon: "🎯" },
                  { id: "crt_9am", label: "09:00 AM CRT (Ep 11)", icon: "🗽" },
                  { id: "london_ny", label: "London/NY CRT", icon: "🏛️" },
                  { id: "combined", label: "Combined Suite", icon: "⚡" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setBacktestModel(m.id);
                      runBacktest(ticker, backtestTf, backtestPeriod, backtestCrtFilter, backtestRr, m.id);
                    }}
                    className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1 ${
                      backtestModel === m.id ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>

              {/* Timeframe selector */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
                {["5m", "15m", "1h"].map((tf) => (
                  <button
                    key={tf}
                    onClick={() => {
                      setBacktestTf(tf);
                      runBacktest(ticker, tf, backtestPeriod, backtestCrtFilter, backtestRr, backtestModel);
                    }}
                    className={`px-2.5 py-1 rounded-lg uppercase font-bold transition ${
                      backtestTf === tf ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              {/* Period selector */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
                {["30d", "60d"].map((prd) => (
                  <button
                    key={prd}
                    onClick={() => {
                      setBacktestPeriod(prd);
                      runBacktest(ticker, backtestTf, prd, backtestCrtFilter, backtestRr, backtestModel);
                    }}
                    className={`px-2.5 py-1 rounded-lg uppercase font-bold transition ${
                      backtestPeriod === prd ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {prd}
                  </button>
                ))}
              </div>

              {/* CRT Filter Toggle */}
              <button
                onClick={() => {
                  const nextFilter = !backtestCrtFilter;
                  setBacktestCrtFilter(nextFilter);
                  runBacktest(ticker, backtestTf, backtestPeriod, nextFilter, backtestRr, backtestModel);
                }}
                className={`text-xs px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 border ${
                  backtestCrtFilter
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                }`}
              >
                <span>{backtestCrtFilter ? "🛡️" : "⚡"}</span>
                <span>{backtestCrtFilter ? "CRT Filter: ON" : "24/7 Unfiltered"}</span>
              </button>

              {/* Run button */}
              <button
                onClick={() => runBacktest(ticker, backtestTf, backtestPeriod, backtestCrtFilter, backtestRr, backtestModel)}
                disabled={isBacktesting}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-md shadow-blue-900/40 disabled:opacity-50"
              >
                <span className={isBacktesting ? "animate-spin" : ""}>🔄</span>
                <span>{isBacktesting ? "Simulating..." : "Run Backtest"}</span>
              </button>
            </div>
          </div>

          {/* Backtest KPI Cards */}
          {backtestData ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {/* Win Rate */}
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 font-sans block mb-1">Win Rate</span>
                  <div className="text-xl font-black font-mono text-emerald-400">
                    {backtestData.win_rate}%
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    {backtestData.wins}W / {backtestData.losses}L / {backtestData.breakevens}BE
                  </span>
                </div>

                {/* Net Return */}
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 font-sans block mb-1">Net Return</span>
                  <div className={`text-xl font-black font-mono ${
                    (backtestData.net_return_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {(backtestData.net_return_pct ?? 0) >= 0 ? '+' : ''}{backtestData.net_return_pct}%
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    ${backtestData.net_profit?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Profit Factor */}
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 font-sans block mb-1">Profit Factor</span>
                  <div className={`text-xl font-black font-mono ${
                    (backtestData.profit_factor ?? 0) >= 1.0 ? 'text-blue-400' : 'text-amber-400'
                  }`}>
                    {backtestData.profit_factor}
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Gross Win / Loss
                  </span>
                </div>

                {/* Max Drawdown */}
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 font-sans block mb-1">Max Drawdown</span>
                  <div className="text-xl font-black font-mono text-rose-400">
                    -{backtestData.max_drawdown_pct}%
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Peak to Valley
                  </span>
                </div>

                {/* Total Executions */}
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 font-sans block mb-1">Total Executed</span>
                  <div className="text-xl font-black font-mono text-white">
                    {backtestData.total_trades}
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    {backtestData.period} simulation
                  </span>
                </div>

                {/* Target R:R */}
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 font-sans block mb-1">Risk Profile</span>
                  <div className="text-xl font-black font-mono text-purple-400">
                    1:{backtestData.risk_reward_ratio}
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    BE Trailed @ 1.0R
                  </span>
                </div>
              </div>

              {/* Recent Backtest Trades Table */}
              {backtestData.recent_trades && backtestData.recent_trades.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Recent Simulated Trades ({backtestData.symbol})
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Showing last {backtestData.recent_trades.length} entries
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-900/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Date / Time (UTC)</th>
                          <th className="py-2.5 px-3">Direction</th>
                          <th className="py-2.5 px-3">Setup Model</th>
                          <th className="py-2.5 px-3">Entry</th>
                          <th className="py-2.5 px-3">Stop Loss</th>
                          <th className="py-2.5 px-3">Take Profit</th>
                          <th className="py-2.5 px-3">Exit</th>
                          <th className="py-2.5 px-3">Result</th>
                          <th className="py-2.5 px-3 text-right">R-Multiple</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-slate-300">
                        {backtestData.recent_trades.map((trade: any, idx: number) => {
                          const isWin = trade.outcome === 'WIN';
                          const isLoss = trade.outcome === 'LOSS';
                          const isBe = trade.outcome === 'BREAKEVEN';
                          return (
                            <tr key={idx} className="hover:bg-slate-900/50 transition">
                              <td className="py-2 px-3 text-slate-500">{trade.trade_num}</td>
                              <td className="py-2 px-3 text-slate-400">
                                {trade.entry_time?.replace('+00:00', '')}
                              </td>
                              <td className="py-2 px-3 font-bold">
                                <span className={`px-2 py-0.5 rounded text-[10px] ${
                                  trade.direction === 'BUY'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  {trade.direction}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-400 font-sans text-[11px] truncate max-w-[180px]">
                                {trade.setup_type}
                              </td>
                              <td className="py-2 px-3 font-semibold text-white">
                                {trade.entry_price?.toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-rose-400/90">
                                {trade.stop_loss?.toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-sky-400/90">
                                {trade.take_profit?.toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-slate-300">
                                {trade.exit_price?.toLocaleString()}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                                  isWin ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                  isLoss ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                                  'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                }`}>
                                  {trade.outcome} {trade.breakeven_activated && !isWin ? '(BE)' : ''}
                                </span>
                              </td>
                              <td className={`py-2 px-3 text-right font-bold ${
                                trade.r_multiple > 0 ? 'text-emerald-400' :
                                trade.r_multiple < 0 ? 'text-rose-400' : 'text-amber-400'
                              }`}>
                                {trade.r_multiple > 0 ? '+' : ''}{trade.r_multiple}R
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center bg-slate-950/40 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-sm">
                Click <span className="text-blue-400 font-bold">Run Backtest</span> above to simulate institutional CRT signals on {ticker}.
              </span>
            </div>
          )}
        </div>

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
                  <span className="text-[10px] text-slate-500 mt-0.5 block">Recommended: Gemini 3.5 Flash for high-speed macro reasoning.</span>
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
                    <option value="gemini">Google Gemini (Gemini 3.5 Flash)</option>
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
