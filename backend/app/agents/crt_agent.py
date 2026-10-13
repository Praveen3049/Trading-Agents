from ..services.llm_service import llm_service

class CRTAgent:
    def __init__(self, technical_context: dict, top_down_context: dict, ticker: str = "BTCUSDT"):
        self.technical = technical_context
        self.top_down = top_down_context
        self.ticker = ticker
        
    def validate_setup(self):
        # Build context combining technical indicator signals and top-down bias
        crt_context = {
            "top_down_bias": self.top_down.get("bias", "BULLISH"),
            "dol": self.top_down.get("dol", "Previous Day High"),
            "session": "London Open (9AM CRT Model)",
            "technical_indicators": self.technical if self.technical else {
                "asian_range_swept": True,
                "sweep_direction": "LOW_SWEPT",
                "displacement_candle": True,
                "fvgs_formed": ["M15 Bullish FVG"],
                "volumetric_ob": "Tapped at 67,420"
            }
        }
        return llm_service.analyze_crt(self.ticker, crt_context)
