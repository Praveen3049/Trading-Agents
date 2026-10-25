from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from .agents.top_down_agent import TopDownAgent
from .agents.crt_agent import CRTAgent
from .services.llm_service import llm_service
from .services.market_data_service import market_data_service
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

class APIKeysUpdate(BaseModel):
    gemini_key: Optional[str] = None
    openai_key: Optional[str] = None
    preferred_provider: Optional[str] = None

@app.get("/")
def read_root():
    return {"message": "Trading Agents API is running!"}

@app.get("/api/assets")
def get_assets():
    """Returns the 5 core traded instruments."""
    return {
        "assets": market_data_service.get_supported_assets(),
        "mt5_status": market_data_service.mt5_connected
    }

@app.post("/api/market-data")
def get_market_data(payload: MarketData):
    """Pulls live/historical OHLCV candle records from MT5 or live feed."""
    data = market_data_service.get_candles(
        symbol=payload.ticker,
        timeframe=payload.timeframe,
        count=120
    )
    return {
        "status": "success",
        "data": data
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
    
    # Pass ticker and real technical structure to agents
    top_down = TopDownAgent(mtf_context, ticker=data.ticker).analyze()
    crt = CRTAgent(mtf_context.get("M15", {}), top_down, ticker=data.ticker).validate_setup()
    
    technical_structure = {
        "current_price": mtf_context.get("current_price"),
        "d1": mtf_context.get("D1", {}).get("trend", "BULLISH"),
        "h4": mtf_context.get("H4", {}).get("trend", "BULLISH"),
        "h1": mtf_context.get("H1", {}).get("trend", "BEARISH"),
        "m15": mtf_context.get("M15", {}).get("trend", "BULLISH"),
        "nearest_ob": mtf_context.get("M15", {}).get("nearest_ob", "N/A"),
        "nearest_fvg": mtf_context.get("M15", {}).get("nearest_fvg", "N/A")
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
            "current_price": mtf_context.get("current_price"),
            "pdh": mtf_context.get("D1", {}).get("pdh"),
            "pdl": mtf_context.get("D1", {}).get("pdl"),
        },
        "analysis": {
            "master_plan": master_plan,
            "top_down": top_down,
            "crt": crt,
            "structure": technical_structure
        }
    }
