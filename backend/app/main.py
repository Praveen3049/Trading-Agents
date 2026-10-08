from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .agents.top_down_agent import TopDownAgent
from .agents.crt_agent import CRTAgent

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
    timeframe: str

@app.get("/")
def read_root():
    return {"message": "Trading Agents API is running!"}

@app.post("/api/analyze")
def run_analysis(data: MarketData):
    # This will eventually pull real OHLCV data for the ticker,
    # pass it to TechnicalStructureEngine, then to TopDownAgent, then CRTAgent.
    
    top_down = TopDownAgent({}).analyze()
    crt = CRTAgent({}, top_down).validate_setup()
    
    # Returning a structured response for the dashboard
    return {
        "status": "success",
        "ticker": data.ticker,
        "analysis": {
            "top_down": top_down,
            "crt": crt,
            "structure": {
                "d1": "BULLISH",
                "h4": "BULLISH",
                "h1": "BEARISH",
                "m15": "BULLISH"
            }
        }
    }
