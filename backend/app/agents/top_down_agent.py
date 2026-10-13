from ..services.llm_service import llm_service

class TopDownAgent:
    def __init__(self, data: dict, ticker: str = "BTCUSDT"):
        """
        Receives technical data structure from multiple timeframes
        and identifies the macro bias and draw on liquidity (DOL).
        """
        self.data = data
        self.ticker = ticker
        
    def analyze(self):
        # Uses LLM (Gemini / OpenAI) to reason over multi-timeframe structure
        timeframe_context = self.data if self.data else {
            "D1": {"trend": "BULLISH", "last_bos": "BOS_UP", "premium_discount": "DISCOUNT"},
            "H4": {"trend": "BULLISH", "last_bos": "BOS_UP", "fvg_present": True},
            "H1": {"trend": "BEARISH_PULLBACK", "last_bos": "INTERNAL_CHoCH_DOWN"},
            "M15": {"trend": "BULLISH_REVERSAL", "last_bos": "CHoCH_UP"}
        }
        return llm_service.analyze_top_down(self.ticker, timeframe_context)
