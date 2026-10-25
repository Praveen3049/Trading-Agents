from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import pandas as pd
from .agents.top_down_agent import TopDownAgent
from .agents.crt_agent import CRTAgent
from .agents.technical_engine import TechnicalStructureEngine
from .services.llm_service import llm_service
from .services.market_data_service import market_data_service
from .services.backtest_engine import backtest_engine
from .core.config import settings

app = FastAPI(title="Trading Agents API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MarketData(BaseModel):
    ticker: str
    timeframe: str = "5m"

class BacktestRequest(BaseModel):
    ticker: str
    timeframe: str = "15m"
    period: str = "60d"
    rr_target: float = 2.0
    apply_crt_filter: bool = True
    strategy_model: Optional[str] = "crt_1am"

class APIKeysUpdate(BaseModel):
    gemini_key: Optional[str] = None
    openai_key: Optional[str] = None
    preferred_provider: Optional[str] = None

@app.get("/")
def read_root():
    return {"message": "Trading Agents API is running!"}

@app.post("/api/backtest")
def run_backtest_endpoint(req: BacktestRequest):
    """Executes institutional backtest with CRT session filtering."""
    return backtest_engine.run_backtest(
        symbol=req.ticker,
        timeframe=req.timeframe,
        period=req.period,
        rr_target=req.rr_target,
        apply_crt_filter=req.apply_crt_filter,
        strategy_model=req.strategy_model or "crt_1am"
    )

@app.get("/api/assets")
def get_assets():
    """Returns the 5 core traded instruments."""
    return {
        "assets": market_data_service.get_supported_assets(),
        "mt5_status": market_data_service.mt5_connected
    }

@app.post("/api/market-data")
def get_market_data(payload: MarketData):
    """Pulls live/historical OHLCV candle records and extracts High-Probability HTF Order Block, FVG, and DOL."""
    candles_data = market_data_service.get_candles(
        symbol=payload.ticker,
        timeframe=payload.timeframe,
        count=120
    )

    # Extract High-Probability HTF structures (H1 & D1 prioritized)
    h1_candles = market_data_service.get_candles(symbol=payload.ticker, timeframe="1h", count=60).get("candles", [])
    d1_candles = market_data_service.get_candles(symbol=payload.ticker, timeframe="1d", count=15).get("candles", [])
    htf_zones = TechnicalStructureEngine.extract_htf_high_probability_zones(h1_candles, d1_candles)

    candles_data["high_probability_zones"] = htf_zones

    return {
        "status": "success",
        "data": candles_data
    }

@app.get("/api/ai-status")
def get_ai_status():
    return {
        "gemini_configured": bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip()),
        "openai_configured": bool(settings.OPENAI_API_KEY and settings.OPENAI_API_KEY.strip()),
        "active_provider": settings.LLM_PROVIDER,
        "gemini_model": settings.GEMINI_MODEL,
        "openai_model": settings.OPENAI_MODEL
    }

@app.post("/api/update-keys")
def update_api_keys(payload: APIKeysUpdate):
    """Allows setting or updating API keys at runtime and persists to backend/.env."""
    from pathlib import Path
    
    if payload.gemini_key is not None and payload.gemini_key.strip():
        settings.GEMINI_API_KEY = payload.gemini_key.strip()
    if payload.openai_key is not None and payload.openai_key.strip():
        settings.OPENAI_API_KEY = payload.openai_key.strip()
    if payload.preferred_provider:
        settings.LLM_PROVIDER = payload.preferred_provider.lower()

    # Re-initialize LLM clients
    llm_service.__init__()
    
    # Persist to backend/.env
    env_file = Path(__file__).resolve().parent.parent / ".env"
    lines = [
        f"GEMINI_API_KEY={settings.GEMINI_API_KEY}\n",
        f"OPENAI_API_KEY={settings.OPENAI_API_KEY}\n",
        f"LLM_PROVIDER={settings.LLM_PROVIDER}\n"
    ]
    with open(env_file, "w") as f:
        f.writelines(lines)

    return {
        "status": "success",
        "message": "API keys updated and saved.",
        "ai_status": get_ai_status()
    }

@app.post("/api/analyze")
def run_analysis(data: MarketData):
    # Fetch real multi-timeframe statistics for the selected instrument
    mtf_context = market_data_service.get_multi_timeframe_context(data.ticker)
    
    # Run GUARDEER PineScript Technical Structure Engine on active candles
    candles_res = market_data_service.get_candles(data.ticker, data.timeframe, 150)
    candles = candles_res.get("candles", [])
    
    if candles:
        engine = TechnicalStructureEngine(pd.DataFrame(candles))
        guardeer_analysis = engine.analyze_full_structure(internal_len=5, swing_len=20)
    else:
        guardeer_analysis = TechnicalStructureEngine(pd.DataFrame())._empty_structure()

    # Pass ticker and real technical structure to agents
    top_down = TopDownAgent(mtf_context, ticker=data.ticker).analyze()
    crt = CRTAgent(guardeer_analysis, top_down, ticker=data.ticker).validate_setup()
    
    # High-probability HTF zones
    h1_candles = market_data_service.get_candles(symbol=data.ticker, timeframe="1h", count=60).get("candles", [])
    d1_candles = market_data_service.get_candles(symbol=data.ticker, timeframe="1d", count=15).get("candles", [])
    htf_zones = TechnicalStructureEngine.extract_htf_high_probability_zones(h1_candles, d1_candles)

    technical_structure = {
        "current_price": guardeer_analysis.get("current_price") or mtf_context.get("current_price"),
        "trend": guardeer_analysis.get("trend"),
        "last_event": guardeer_analysis.get("last_event"),
        "d1": mtf_context.get("D1", {}).get("trend", "BULLISH"),
        "h4": mtf_context.get("H4", {}).get("trend", "BULLISH"),
        "h1": mtf_context.get("H1", {}).get("trend", "BEARISH"),
        "m15": mtf_context.get("M15", {}).get("trend", "BULLISH"),
        "nearest_ob": guardeer_analysis.get("nearest_ob"),
        "nearest_fvg": guardeer_analysis.get("nearest_fvg"),
        "strong_level": guardeer_analysis.get("strong_level"),
        "weak_level": guardeer_analysis.get("weak_level"),
        "regime": guardeer_analysis.get("premium_discount", {}).get("regime"),
        "high_probability_zones": htf_zones
    }
    
    master_plan = llm_service.synthesize_master_plan(
        ticker=data.ticker,
        top_down=top_down,
        crt=crt,
        technicals=technical_structure
    )
    
    return {
        "status": "success",
        "ticker": data.ticker,
        "llm_status": get_ai_status(),
        "market_info": {
            "current_price": technical_structure["current_price"],
            "pdh": mtf_context.get("D1", {}).get("pdh"),
            "pdl": mtf_context.get("D1", {}).get("pdl"),
            "regime": technical_structure["regime"],
        },
        "analysis": {
            "master_plan": master_plan,
            "top_down": top_down,
            "crt": crt,
            "structure": technical_structure
        }
    }
